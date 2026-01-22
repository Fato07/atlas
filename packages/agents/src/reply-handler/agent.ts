/**
 * Reply Handler Agent - Main Orchestrator
 *
 * Orchestrates the complete reply processing flow:
 * 1. Parse incoming reply (FR-001)
 * 2. Classify intent and sentiment (FR-002, FR-003)
 * 3. Match KB templates/handlers (FR-005, FR-006)
 * 4. Route to appropriate tier (FR-009, FR-010, FR-011)
 * 5. Execute tier-specific actions
 * 6. Update CRM and extract insights (FR-019-FR-023)
 * 7. Log all events (FR-029)
 *
 * @module reply-handler/agent
 */

import Anthropic from '@anthropic-ai/sdk';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { WebClient } from '@slack/web-api';

import { extractNewContent } from './email-parser';
import { ReplyClassifier, createClassifier } from './classifier';
import { KBMatcher, createMatcher } from './matcher';
import { TierRouter, createRouter } from './router';
import { ResponseGenerator, createResponder } from './responder';
import { ReplyHandlerLogger, createLogger } from './logger';
import { InsightExtractor, createInsightExtractor, type ExtractedInsight as InsightExtractorInsight } from './insight-extractor';
import { CRMUpdater, createCRMUpdater } from './crm-updater';
import { SlackFlowManager, createSlackFlowManager } from './slack-flow';

import type { ReplyInput, LeadContext } from './contracts/reply-input';
import type {
  ReplyHandlerResult,
  Classification,
  KBMatch,
  TierRouting,
  ExtractedInsight,
  CRMUpdates,
  Intent,
} from './contracts/handler-result';
import {
  createAutoRespondResult,
  createDraftResult,
  createEscalationResult,
  createErrorResult,
} from './contracts/handler-result';

import type { ReplyHandlerConfig, Draft, DraftStatus } from './types';
import { DEFAULT_CONFIG } from './types';

// ===========================================
// Agent Configuration
// ===========================================

export interface ReplyHandlerAgentConfig {
  /** Anthropic client for Claude */
  anthropicClient: Anthropic;

  /** Qdrant client for KB */
  qdrantClient: QdrantClient;

  /** Embedding function */
  embedder: (text: string) => Promise<number[]>;

  /** MCP client function for tool calls */
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;

  /** Slack Web API client (for modals) */
  slackClient?: WebClient;

  /** Slack channel configuration */
  slackChannels?: {
    approvals: string;
    escalations: string;
  };

  /** Optional configuration overrides */
  config?: Partial<ReplyHandlerConfig>;

  /** Sender name for templates */
  senderName?: string;

  /** Meeting link for templates */
  meetingLink?: string;
}

// ===========================================
// Reply Handler Agent
// ===========================================

export class ReplyHandlerAgent {
  private anthropic: Anthropic;
  private callMcpTool: ReplyHandlerAgentConfig['callMcpTool'];
  private config: ReplyHandlerConfig;
  private logger: ReplyHandlerLogger;
  private classifier: ReplyClassifier;
  private matcher: KBMatcher;
  private router: TierRouter;
  private responder: ResponseGenerator;
  private insightExtractor: InsightExtractor;
  private crmUpdater: CRMUpdater;
  private slackFlow?: SlackFlowManager;
  private senderName: string;
  private meetingLink: string;

  // Draft storage (in production, use Redis/DB)
  private drafts: Map<string, Draft> = new Map();

  constructor(agentConfig: ReplyHandlerAgentConfig) {
    this.anthropic = agentConfig.anthropicClient;
    this.callMcpTool = agentConfig.callMcpTool;
    this.config = { ...DEFAULT_CONFIG, ...agentConfig.config };
    this.senderName = agentConfig.senderName ?? 'The Team';
    this.meetingLink = agentConfig.meetingLink ?? '';

    // Initialize logger
    this.logger = createLogger({
      level: 'info',
      format: 'json',
      includeStack: true,
      metadata: { service: 'reply-handler' },
    });

    // Initialize classifier
    this.classifier = createClassifier({
      client: agentConfig.anthropicClient,
    });

    // Initialize matcher
    this.matcher = createMatcher({
      qdrantClient: agentConfig.qdrantClient,
      embedder: agentConfig.embedder,
    });

    // Initialize router
    this.router = createRouter({
      thresholds: this.config.thresholds,
    });

    // Initialize responder
    this.responder = createResponder({
      client: agentConfig.anthropicClient,
      campaign: {
        senderName: this.senderName,
        meetingLink: this.meetingLink,
      },
    });

    // Initialize insight extractor
    this.insightExtractor = createInsightExtractor({
      client: agentConfig.anthropicClient,
      callMcpTool: agentConfig.callMcpTool,
    });

    // Initialize CRM updater
    this.crmUpdater = createCRMUpdater({
      callMcpTool: agentConfig.callMcpTool,
    });

    // Initialize Slack flow manager if configured
    if (agentConfig.slackClient && agentConfig.slackChannels) {
      this.slackFlow = createSlackFlowManager({
        webClient: agentConfig.slackClient,
        callMcpTool: agentConfig.callMcpTool,
        channels: agentConfig.slackChannels,
        approval: {
          timeout: this.config.slack.draft_timeout_minutes * 60 * 1000,
        },
      });
    }
  }

  // ===========================================
  // Main Processing Entry Point
  // ===========================================

  /**
   * Process an incoming reply through the complete flow.
   *
   * Implements the 3-tier routing system:
   * - Tier 1: Auto-respond (high confidence positive interest)
   * - Tier 2: Draft for approval (moderate confidence)
   * - Tier 3: Human escalation (low confidence or complex)
   */
  async processReply(input: ReplyInput): Promise<ReplyHandlerResult> {
    // Start timing (T025)
    const getElapsedMs = this.logger.startTimer();

    // Build lead context from input
    const leadContext = this.buildLeadContext(input);

    // Log reply received (FR-029)
    this.logger.replyReceived({
      reply_id: input.reply_id,
      lead_id: input.lead_id,
      brain_id: input.brain_id,
      source: input.source,
      thread_id: input.thread_id,
    });

    try {
      // Step 1: Parse and extract new content (FR-001)
      const cleanedReplyText = extractNewContent(input.reply_text);

      // Build thread context string from thread messages
      const threadContext = input.thread_messages
        .map(m => `[${m.direction}] ${m.content}`)
        .join('\n\n');

      // Step 2: Classify the reply (FR-002, FR-003, FR-004)
      const classification = await this.classifier.classify({
        replyText: cleanedReplyText,
        leadName: input.lead_name,
        leadCompany: input.lead_company,
        lastSentTemplate: input.last_sent_template,
        threadContext: threadContext || undefined,
      });

      // Log classification (FR-029)
      this.logger.replyClassified({
        reply_id: input.reply_id,
        lead_id: input.lead_id,
        brain_id: input.brain_id,
        intent: classification.intent,
        intent_confidence: classification.intent_confidence,
        sentiment: classification.sentiment,
        complexity: classification.complexity,
        tokens_used: classification.tokens_used,
      });

      // Step 3: Match KB templates (FR-005, FR-006, FR-007, FR-008)
      const kbMatch = await this.matcher.findMatch({
        classification,
        replyText: cleanedReplyText,
        brainId: input.brain_id,
      });

      // Step 4: Route to tier (FR-009, FR-010, FR-011)
      const routing = this.router.route({
        classification,
        kbMatch,
      });

      // Log routing decision (FR-029)
      this.logger.replyRouted({
        reply_id: input.reply_id,
        lead_id: input.lead_id,
        brain_id: input.brain_id,
        tier: routing.tier,
        reason: routing.reason,
        kb_match_confidence: kbMatch?.confidence,
        override_applied: routing.override_applied,
      });

      // Step 5: Execute tier-specific flow
      let result: ReplyHandlerResult;

      switch (routing.tier) {
        case 1:
          result = await this.executeTier1(
            input,
            leadContext,
            cleanedReplyText,
            classification,
            kbMatch,
            routing,
            getElapsedMs
          );
          break;

        case 2:
          result = await this.executeTier2(
            input,
            leadContext,
            cleanedReplyText,
            classification,
            kbMatch,
            routing,
            getElapsedMs
          );
          break;

        case 3:
        default:
          result = await this.executeTier3(
            input,
            leadContext,
            cleanedReplyText,
            classification,
            kbMatch,
            routing,
            getElapsedMs
          );
          break;
      }

      return result;
    } catch (error) {
      // Log error (FR-029)
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.processingError({
        reply_id: input.reply_id,
        lead_id: input.lead_id,
        brain_id: input.brain_id,
        error_code: 'PROCESSING_FAILED',
        error_message: errorMessage,
        recoverable: false,
        retry_count: 0,
      });

      return createErrorResult({
        replyId: input.reply_id,
        error: errorMessage,
        processingTimeMs: getElapsedMs(),
      });
    }
  }

  // ===========================================
  // Tier 1: Auto-Respond (FR-009)
  // ===========================================

  /**
   * Execute Tier 1 flow: Generate and send automatic response.
   *
   * Requirements:
   * - High confidence positive interest (>= 0.85) with KB match, OR
   * - Auto-respond intent (out_of_office, bounce, unsubscribe) - no response needed
   * - Auto-send via Instantly MCP (only if KB match exists)
   */
  private async executeTier1(
    input: ReplyInput,
    leadContext: LeadContext,
    cleanedReplyText: string,
    classification: Classification,
    kbMatch: KBMatch | undefined,
    routing: TierRouting,
    getElapsedMs: () => number
  ): Promise<ReplyHandlerResult> {
    // Auto-respond intents (out_of_office, bounce, unsubscribe) don't need a response
    const autoRespondIntents: Intent[] = ['out_of_office', 'bounce', 'unsubscribe'];
    const isAutoRespondIntent = autoRespondIntents.includes(classification.intent);

    // If no KB match and it's an auto-respond intent, just update CRM and return
    if (!kbMatch && isAutoRespondIntent) {
      // Update CRM with the classification (no response sent)
      const crmResult = await this.crmUpdater.updateCRM({
        leadContext,
        classification,
        routing,
        replyText: cleanedReplyText,
        responseSent: false,
      });

      // Log CRM update
      this.logger.crmUpdated({
        reply_id: input.reply_id,
        lead_id: input.lead_id,
        brain_id: input.brain_id,
        airtable_updated: crmResult.airtable.updated,
        attio_created: crmResult.attio.created,
      });

      return createAutoRespondResult({
        replyId: input.reply_id,
        classification,
        kbMatch: undefined,
        responseText: '', // No response for auto-respond intents without template
        crmUpdates: {
          airtable_updated: crmResult.airtable.updated,
          airtable_status: crmResult.airtable.status,
          attio_created: crmResult.attio.created,
          attio_record_id: crmResult.attio.recordId,
        },
        insights: [], // No insights from OOO/bounce/unsubscribe
        processingTimeMs: getElapsedMs(),
      });
    }

    // If no KB match but not an auto-respond intent, this shouldn't happen
    // (router should have sent to Tier 3), but handle gracefully
    if (!kbMatch) {
      throw new Error('Tier 1 requires KB match for non-auto-respond intents');
    }

    // Build template variables
    const templateVariables = this.buildTemplateVariables(leadContext);

    // Generate personalized response (FR-012, FR-013, FR-014)
    const responseResult = await this.responder.generateResponse({
      kbMatch,
      leadContext,
      replyText: cleanedReplyText,
    });

    // Send response via Instantly MCP (T022)
    await this.sendViaInstantly({
      email: input.lead_email,
      campaignId: input.campaign_id ?? '',
      message: responseResult.responseText,
    });

    // Log response sent (FR-029)
    this.logger.responseSent({
      reply_id: input.reply_id,
      lead_id: input.lead_id,
      brain_id: input.brain_id,
      tier: 1,
      template_id: kbMatch.id,
      personalized: responseResult.personalized,
    });

    // Extract insights in background (FR-022, FR-023)
    const insights = await this.extractInsightsAsync(
      input.reply_id,
      cleanedReplyText,
      classification,
      leadContext,
      input.brain_id
    );

    // Update CRM (FR-019, FR-020, FR-021)
    const crmResult = await this.crmUpdater.updateCRM({
      leadContext,
      classification,
      routing,
      replyText: cleanedReplyText,
      responseSent: true,
      responseText: responseResult.responseText,
    });

    // Log CRM update (FR-029)
    this.logger.crmUpdated({
      reply_id: input.reply_id,
      lead_id: input.lead_id,
      brain_id: input.brain_id,
      airtable_updated: crmResult.airtable.updated,
      attio_created: crmResult.attio.created,
    });

    return createAutoRespondResult({
      replyId: input.reply_id,
      classification,
      kbMatch,
      responseText: responseResult.responseText,
      crmUpdates: {
        airtable_updated: crmResult.airtable.updated,
        airtable_status: crmResult.airtable.status,
        attio_created: crmResult.attio.created,
        attio_record_id: crmResult.attio.recordId,
      },
      insights,
      processingTimeMs: getElapsedMs(),
    });
  }

  // ===========================================
  // Tier 2: Draft for Approval (FR-010)
  // ===========================================

  /**
   * Execute Tier 2 flow: Generate draft and post to Slack for approval.
   *
   * Requirements:
   * - Moderate confidence (0.50-0.85)
   * - Generate draft response
   * - Post to Slack for human review
   * - Await approval/edit/reject
   */
  private async executeTier2(
    input: ReplyInput,
    leadContext: LeadContext,
    cleanedReplyText: string,
    classification: Classification,
    kbMatch: KBMatch | undefined,
    routing: TierRouting,
    getElapsedMs: () => number
  ): Promise<ReplyHandlerResult> {
    // Build template variables
    const templateVariables = this.buildTemplateVariables(leadContext);

    // Generate draft response
    let draftContent: string;

    if (kbMatch) {
      const responseResult = await this.responder.generateResponse({
        kbMatch,
        leadContext,
        replyText: cleanedReplyText,
      });
      draftContent = responseResult.responseText;
    } else {
      // Generate generic response without template using synthetic KB match
      const syntheticKbMatch: KBMatch = {
        type: 'template',
        id: 'generic_template',
        confidence: 0,
        content: `Hi {{first_name}},\n\nThank you for your reply. I wanted to follow up on your message.\n\nBest regards,\n{{sender_name}}`,
      };
      const responseResult = await this.responder.generateResponse({
        kbMatch: syntheticKbMatch,
        leadContext,
        replyText: cleanedReplyText,
      });
      draftContent = responseResult.responseText;
    }

    // Generate draft ID inline
    const draftId = `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Create draft record with snake_case properties
    const draft: Draft = {
      id: draftId,
      reply_id: input.reply_id,
      response_text: draftContent,
      original_template_id: kbMatch?.id,
      slack_channel: '',
      slack_message_ts: '',
      status: 'pending' as DraftStatus,
      expires_at: new Date(
        Date.now() + this.config.slack.draft_timeout_minutes * 60 * 1000
      ).toISOString(),
      created_at: new Date().toISOString(),
      lead_context: leadContext,
      classification,
    };

    // Store draft
    this.drafts.set(draft.id, draft);

    // Post to Slack for approval (FR-015, FR-016, FR-017)
    let slackTs: string | undefined;
    let slackChannel: string | undefined;

    if (this.slackFlow) {
      const slackResult = await this.slackFlow.postApprovalRequest({
        draft,
        leadContext,
        classification,
        routing,
        replyText: cleanedReplyText,
      });

      slackTs = slackResult.ts;
      slackChannel = slackResult.channel;

      // Update draft with Slack info
      draft.slack_message_ts = slackTs ?? '';
      draft.slack_channel = slackChannel ?? '';
      this.drafts.set(draft.id, draft);

      // Log approval requested (FR-029)
      this.logger.approvalRequested({
        reply_id: input.reply_id,
        lead_id: input.lead_id,
        brain_id: input.brain_id,
        draft_id: draft.id,
        slack_channel: slackChannel ?? '',
        slack_message_ts: slackTs ?? '',
        expires_at: draft.expires_at,
      });
    }

    // Extract insights in background
    const insights = await this.extractInsightsAsync(
      input.reply_id,
      cleanedReplyText,
      classification,
      leadContext,
      input.brain_id
    );

    return createDraftResult({
      replyId: input.reply_id,
      classification,
      kbMatch,
      draftText: draftContent,
      slackMessageTs: slackTs ?? '',
      slackChannel: slackChannel ?? '',
      processingTimeMs: getElapsedMs(),
    });
  }

  // ===========================================
  // Tier 3: Human Escalation (FR-011)
  // ===========================================

  /**
   * Execute Tier 3 flow: Escalate to human for manual handling.
   *
   * Requirements:
   * - Low confidence (< 0.50) or complex intent
   * - Post escalation to Slack
   * - Human takes over completely
   */
  private async executeTier3(
    input: ReplyInput,
    leadContext: LeadContext,
    cleanedReplyText: string,
    classification: Classification,
    kbMatch: KBMatch | undefined,
    routing: TierRouting,
    getElapsedMs: () => number
  ): Promise<ReplyHandlerResult> {
    // Post escalation to Slack
    let slackTs: string | undefined;
    let slackChannel: string | undefined;

    // Generate escalation ID
    const escalationId = `escalation_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (this.slackFlow) {
      const slackResult = await this.slackFlow.postEscalation({
        escalationId,
        leadContext,
        classification,
        routing,
        replyText: cleanedReplyText,
      });

      slackTs = slackResult.ts;
      slackChannel = slackResult.channel;
    }

    // Extract insights in background
    const insights = await this.extractInsightsAsync(
      input.reply_id,
      cleanedReplyText,
      classification,
      leadContext,
      input.brain_id
    );

    // Update CRM with escalation status
    const crmResult = await this.crmUpdater.updateCRM({
      leadContext,
      classification,
      routing,
      replyText: cleanedReplyText,
      responseSent: false,
    });

    return createEscalationResult({
      replyId: input.reply_id,
      classification,
      routingReason: routing.reason,
      slackMessageTs: slackTs,
      slackChannel,
      processingTimeMs: getElapsedMs(),
    });
  }

  // ===========================================
  // Instantly Integration (T022)
  // ===========================================

  /**
   * Send response via Instantly MCP tool.
   */
  private async sendViaInstantly(params: {
    email: string;
    campaignId: string;
    message: string;
    subject?: string;
  }): Promise<void> {
    await this.callMcpTool('send_reply', {
      email: params.email,
      campaign_id: params.campaignId,
      body: params.message,  // MCP tool expects 'body' not 'message'
      subject: params.subject,
    });
  }

  // ===========================================
  // Draft Management
  // ===========================================

  /**
   * Approve a draft and send the response.
   */
  async approveDraft(
    draftId: string,
    approvedBy: string
  ): Promise<{ success: boolean; error?: string }> {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      return { success: false, error: 'Draft not found' };
    }

    if (draft.status !== 'pending') {
      return { success: false, error: `Draft already ${draft.status}` };
    }

    try {
      // Get original reply input (in production, retrieve from storage)
      // For now, we need campaign_id from somewhere - this is a simplified version
      // In production, store full context with draft

      // Update draft status
      draft.status = 'approved';
      draft.approved_at = new Date().toISOString();
      draft.approved_by = approvedBy;
      this.drafts.set(draftId, draft);

      // Update Slack message
      if (this.slackFlow && draft.slack_channel && draft.slack_message_ts) {
        await this.slackFlow.resolveApproval({
          channel: draft.slack_channel,
          ts: draft.slack_message_ts,
          draftId: draft.id,
          status: 'approved',
          resolvedBy: approvedBy,
        });
      }

      // Log approval (FR-029)
      this.logger.approvalResolved({
        reply_id: draft.reply_id,
        lead_id: draft.lead_context.id,
        brain_id: draft.lead_context.brain_id,
        draft_id: draft.id,
        action: 'approved',
        resolved_by: approvedBy,
        wait_time_ms: Date.now() - new Date(draft.created_at).getTime(),
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Approve a draft with edits.
   */
  async approveWithEdits(
    draftId: string,
    editedContent: string,
    approvedBy: string
  ): Promise<{ success: boolean; error?: string }> {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      return { success: false, error: 'Draft not found' };
    }

    if (draft.status !== 'pending') {
      return { success: false, error: `Draft already ${draft.status}` };
    }

    try {
      // Update draft with edited content
      draft.edited_text = editedContent;
      draft.status = 'approved_edited';
      draft.approved_at = new Date().toISOString();
      draft.approved_by = approvedBy;
      this.drafts.set(draftId, draft);

      // Update Slack message
      if (this.slackFlow && draft.slack_channel && draft.slack_message_ts) {
        await this.slackFlow.resolveApproval({
          channel: draft.slack_channel,
          ts: draft.slack_message_ts,
          draftId: draft.id,
          status: 'approved_edited',
          resolvedBy: approvedBy,
        });
      }

      // Log approval (FR-029)
      this.logger.approvalResolved({
        reply_id: draft.reply_id,
        lead_id: draft.lead_context.id,
        brain_id: draft.lead_context.brain_id,
        draft_id: draft.id,
        action: 'approved_edited',
        resolved_by: approvedBy,
        wait_time_ms: Date.now() - new Date(draft.created_at).getTime(),
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Reject a draft.
   */
  async rejectDraft(
    draftId: string,
    rejectedBy: string
  ): Promise<{ success: boolean; error?: string }> {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      return { success: false, error: 'Draft not found' };
    }

    if (draft.status !== 'pending') {
      return { success: false, error: `Draft already ${draft.status}` };
    }

    draft.status = 'rejected';
    draft.approved_at = new Date().toISOString();
    draft.approved_by = rejectedBy;
    this.drafts.set(draftId, draft);

    // Update Slack message
    if (this.slackFlow && draft.slack_channel && draft.slack_message_ts) {
      await this.slackFlow.resolveApproval({
        channel: draft.slack_channel,
        ts: draft.slack_message_ts,
        draftId: draft.id,
        status: 'rejected',
        resolvedBy: rejectedBy,
      });
    }

    // Log rejection (FR-029)
    this.logger.approvalResolved({
      reply_id: draft.reply_id,
      lead_id: draft.lead_context.id,
      brain_id: draft.lead_context.brain_id,
      draft_id: draft.id,
      action: 'rejected',
      resolved_by: rejectedBy,
      wait_time_ms: Date.now() - new Date(draft.created_at).getTime(),
    });

    return { success: true };
  }

  /**
   * Get draft by ID.
   */
  getDraft(draftId: string): Draft | undefined {
    return this.drafts.get(draftId);
  }

  // ===========================================
  // Helper Methods
  // ===========================================

  /**
   * Build template variables from lead context.
   */
  private buildTemplateVariables(leadContext: LeadContext): {
    first_name: string;
    last_name: string;
    company: string;
    title: string;
    email: string;
    industry: string;
    sender_name: string;
    meeting_link: string;
  } {
    return {
      first_name: leadContext.first_name ?? '',
      last_name: leadContext.last_name ?? '',
      company: leadContext.company ?? '',
      title: leadContext.title ?? '',
      email: leadContext.email,
      industry: leadContext.industry ?? '',
      sender_name: this.senderName,
      meeting_link: this.meetingLink,
    };
  }

  /**
   * Extract insights asynchronously and convert to contract format.
   */
  private async extractInsightsAsync(
    replyId: string,
    replyText: string,
    classification: Classification,
    leadContext: LeadContext,
    brainId: string
  ): Promise<ExtractedInsight[]> {
    try {
      const result = await this.insightExtractor.extractInsights({
        replyId,
        replyText,
        classification,
        leadContext,
        brainId,
      });

      // Log insight extraction (FR-029)
      if (result.insights.length > 0) {
        for (const insight of result.insights) {
          this.logger.insightExtracted({
            reply_id: replyId,
            lead_id: leadContext.id,
            brain_id: brainId,
            category: insight.category,
            importance: insight.importance,
            actionable: insight.actionable,
          });
        }
      }

      // Convert insight-extractor's format to contract format
      return result.insights.map((insight: InsightExtractorInsight): ExtractedInsight => ({
        category: insight.category as ExtractedInsight['category'],
        content: insight.content,
        importance: insight.importance,
        actionable: insight.actionable,
        action_suggestion: insight.suggestedActions?.[0],
        source: {
          type: 'email_reply',
          reply_id: replyId,
          lead_id: leadContext.id,
          company: leadContext.company,
        },
      }));
    } catch (error) {
      // Log but don't fail main flow
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.processingError({
        reply_id: replyId,
        lead_id: leadContext.id,
        brain_id: brainId,
        error_code: 'INSIGHT_EXTRACTION_FAILED',
        error_message: errorMessage,
        recoverable: true,
        retry_count: 0,
      });
      return [];
    }
  }

  /**
   * Build LeadContext from ReplyInput fields.
   */
  private buildLeadContext(input: ReplyInput): LeadContext {
    // Parse name into first/last
    const nameParts = input.lead_name?.split(' ') ?? [];
    const firstName = nameParts[0] ?? undefined;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

    return {
      id: input.lead_id,
      email: input.lead_email,
      first_name: firstName,
      last_name: lastName,
      company: input.lead_company,
      title: input.lead_title,
      brain_id: input.brain_id,
      reply_count: input.message_count - 1, // Subtract 1 for current reply
    };
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Reply Handler Agent.
 */
export function createReplyHandlerAgent(
  config: ReplyHandlerAgentConfig
): ReplyHandlerAgent {
  return new ReplyHandlerAgent(config);
}

// ReplyHandlerAgentConfig is exported from interface declaration above
