/**
 * Meeting Prep Agent - Main Orchestrator
 *
 * Orchestrates the complete meeting preparation flow:
 * 1. Receive calendar webhook/manual request (FR-001, FR-007)
 * 2. Gather context from multiple sources (FR-002, FR-003, FR-005)
 * 3. Generate pre-call brief using Claude (FR-004)
 * 4. Deliver brief via Slack (FR-011)
 * 5. Process post-meeting transcript (FR-006)
 * 6. Analyze meeting and extract BANT (FR-008)
 * 7. Update CRM with insights (FR-009, FR-010)
 * 8. Log all events (FR-015)
 *
 * @module meeting-prep/agent
 */

import Anthropic from '@anthropic-ai/sdk';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { WebClient } from '@slack/web-api';
import type { BrainId } from '@atlas-gtm/lib';

import { MeetingPrepLogger, createLogger } from './logger';
import { MeetingPrepStateManager, loadStateManager } from './state';
import { CalendarHandler, createCalendarHandler } from './calendar-handler';
import { ContextGatherer, createContextGatherer } from './context-gatherer';
import { BriefGenerator, createBriefGenerator } from './brief-generator';
import { SlackBriefDelivery, createSlackBriefDelivery } from './slack-delivery';
import { TranscriptAnalyzer, createTranscriptAnalyzer } from './transcript-analyzer';
import { CRMUpdater, createCRMUpdater } from './crm-updater';
import {
  ResearchCacheClient,
  createResearchCache,
  createCacheFunctions,
  type ResearchCacheConfig,
} from './research-cache';
import { createPendingBrief, transitionBriefStatus } from './contracts/brief';

import type {
  CalendarWebhookPayload,
  ManualBriefRequest,
  ParsedMeeting,
} from './contracts/meeting-input';
import type {
  Brief,
  BriefContent,
} from './contracts/brief';
import type {
  TranscriptInput,
  MeetingAnalysis,
  AnalysisOutput,
} from './contracts/meeting-analysis';
import type {
  BriefWebhookResponse,
  AnalysisWebhookResponse,
} from './contracts/webhook-api';

import type {
  MeetingPrepConfig,
  GatheredContext,
  BriefGenerationResult,
  AnalysisResult,
} from './types';
import { DEFAULT_CONFIG } from './types';

// ===========================================
// Agent Configuration
// ===========================================

export interface MeetingPrepAgentConfig {
  /** Brain ID for this agent instance */
  brainId: BrainId;

  /** Anthropic client for Claude */
  anthropicClient: Anthropic;

  /** Qdrant client for KB */
  qdrantClient: QdrantClient;

  /** Embedding function */
  embedder: (text: string) => Promise<number[]>;

  /** MCP client function for tool calls */
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;

  /** Slack Web API client */
  slackClient?: WebClient;

  /** Slack channel for briefs */
  slackBriefChannel?: string;

  /** Optional configuration overrides */
  config?: Partial<MeetingPrepConfig>;

  /** State file path override */
  statePath?: string;

  /** Research cache configuration (optional - defaults to Upstash from env) */
  cacheConfig?: Partial<ResearchCacheConfig>;
}

// ===========================================
// Meeting Prep Agent
// ===========================================

export class MeetingPrepAgent {
  private readonly brainId: BrainId;
  private readonly anthropic: Anthropic;
  private readonly qdrant: QdrantClient;
  private readonly embedder: MeetingPrepAgentConfig['embedder'];
  private readonly callMcpTool: MeetingPrepAgentConfig['callMcpTool'];
  private readonly slack: WebClient;
  private readonly slackBriefChannel: string;
  private readonly config: MeetingPrepConfig;
  private readonly logger: MeetingPrepLogger;
  private stateManager?: MeetingPrepStateManager;
  private readonly statePath?: string;

  // Sub-components for brief generation (US1)
  private readonly calendarHandler: CalendarHandler;
  private readonly contextGatherer: ContextGatherer;
  private readonly briefGenerator: BriefGenerator;
  private readonly slackDelivery: SlackBriefDelivery;

  // Sub-components for meeting analysis (US2)
  private readonly transcriptAnalyzer: TranscriptAnalyzer;
  private readonly crmUpdater: CRMUpdater;

  // US3: Research cache for context gathering optimization
  private readonly researchCache: ResearchCacheClient;

  constructor(agentConfig: MeetingPrepAgentConfig) {
    this.brainId = agentConfig.brainId;
    this.anthropic = agentConfig.anthropicClient;
    this.qdrant = agentConfig.qdrantClient;
    this.embedder = agentConfig.embedder;
    this.callMcpTool = agentConfig.callMcpTool;
    this.slack = agentConfig.slackClient ?? new WebClient(process.env.SLACK_BOT_TOKEN);
    this.slackBriefChannel = agentConfig.slackBriefChannel ?? 'meeting-briefs';
    this.config = { ...DEFAULT_CONFIG, ...agentConfig.config };
    this.statePath = agentConfig.statePath;

    // Initialize logger
    this.logger = createLogger({
      level: 'info',
      format: 'json',
      includeStack: true,
      metadata: { service: 'meeting-prep', brain_id: this.brainId },
    });

    // Initialize US3 research cache
    this.researchCache = createResearchCache(
      { logger: this.logger },
      agentConfig.cacheConfig
    );

    // Get cache functions for context gatherer
    const cacheFunctions = createCacheFunctions(this.researchCache);

    // Initialize sub-components
    this.calendarHandler = createCalendarHandler(this.logger);

    this.contextGatherer = createContextGatherer({
      embedder: this.embedder,
      callMcpTool: this.callMcpTool,
      logger: this.logger,
      getResearchCache: cacheFunctions.getResearchCache,
      setResearchCache: cacheFunctions.setResearchCache,
    });

    this.briefGenerator = createBriefGenerator({
      client: this.anthropic,
      logger: this.logger,
    });

    this.slackDelivery = createSlackBriefDelivery({
      client: this.slack,
      logger: this.logger,
    });

    // Initialize US2 components (meeting analysis)
    this.transcriptAnalyzer = createTranscriptAnalyzer({
      client: this.anthropic,
      logger: this.logger,
    });

    this.crmUpdater = createCRMUpdater({
      callMcpTool: this.callMcpTool,
      logger: this.logger,
    });
  }

  // ===========================================
  // Initialization
  // ===========================================

  /**
   * Initialize the agent (load state, connect to services)
   */
  async initialize(): Promise<void> {
    // Load or create state manager
    this.stateManager = await loadStateManager(this.brainId, this.statePath);

    // Set session context in logger
    this.logger.setSession(this.stateManager.sessionId, this.brainId);

    this.logger.info('Meeting Prep Agent initialized', {
      session_id: this.stateManager.sessionId,
      brain_id: this.brainId,
      config: {
        context_budget_tokens: this.config.context_budget_tokens,
        brief_trigger_minutes: this.config.timing.brief_trigger_minutes,
      },
    });
  }

  /**
   * Shutdown the agent (save state, cleanup)
   */
  async shutdown(): Promise<void> {
    if (this.stateManager) {
      await this.stateManager.checkpoint();
      this.logger.info('Meeting Prep Agent shutdown', {
        stats: this.stateManager.getSessionStats(),
      });
    }
  }

  // ===========================================
  // Brief Generation (US1)
  // ===========================================

  /**
   * Generate a pre-call brief from a calendar webhook.
   *
   * Flow:
   * 1. Parse calendar event
   * 2. Check if internal meeting (skip if so)
   * 3. Gather context from CRM, KB, research
   * 4. Generate brief using Claude
   * 5. Deliver via Slack
   */
  async generateBriefFromWebhook(
    payload: CalendarWebhookPayload
  ): Promise<BriefWebhookResponse> {
    const timer = this.logger.startTimer();
    let briefId: string | undefined;

    try {
      // Step 1: Parse and validate calendar event
      const handleResult = await this.calendarHandler.handle(payload);

      if (!handleResult.success) {
        // Skipped or invalid - not an error, just filtered
        return {
          success: true,
          message: handleResult.message,
          processing_time_ms: timer(),
        };
      }

      const { meeting } = handleResult;

      // Create pending brief for tracking
      const brief = createPendingBrief(meeting.meeting_id, this.brainId);
      briefId = brief.brief_id;

      // Step 2: Gather context from all sources
      const contextTimer = this.logger.startTimer();
      const contextResult = await this.contextGatherer.gather({
        brainId: this.brainId,
        briefId,
        meeting,
      });

      if (!contextResult.success) {
        const failedSourcesInfo = contextResult.failed_sources.length > 0
          ? ` (failed: ${contextResult.failed_sources.join(', ')})`
          : '';

        this.logger.briefFailed({
          meeting_id: meeting.meeting_id,
          brain_id: this.brainId,
          brief_id: briefId,
          error_code: 'CONTEXT_GATHERING_FAILED',
          error_message: contextResult.error + failedSourcesInfo,
          retry_count: 0,
          recoverable: true,
        });

        return {
          success: false,
          message: 'Context gathering failed',
          error: {
            code: 'CONTEXT_GATHERING_FAILED',
            message: contextResult.error + failedSourcesInfo,
          },
          processing_time_ms: timer(),
        };
      }

      const contextDurationMs = contextTimer();

      // Step 3: Generate brief using Claude with structured outputs
      const generationResult = await this.briefGenerator.generate({
        brainId: this.brainId,
        briefId,
        meeting,
        context: contextResult.context,
      });

      if (!generationResult.success) {
        this.logger.briefFailed({
          meeting_id: meeting.meeting_id,
          brain_id: this.brainId,
          brief_id: briefId,
          error_code: generationResult.code,
          error_message: generationResult.error,
          retry_count: 0,
          recoverable: generationResult.code !== 'PARSING_ERROR',
        });

        return {
          success: false,
          message: 'Brief generation failed',
          error: {
            code: generationResult.code,
            message: generationResult.error,
          },
          processing_time_ms: timer(),
        };
      }

      // Step 4: Deliver brief via Slack
      const totalProcessingMs = timer();
      const deliveryResult = await this.slackDelivery.deliver({
        brainId: this.brainId,
        briefId,
        meeting,
        content: generationResult.content,
        channel: this.slackBriefChannel,
        attioRecordId: contextResult.context.lead.email, // Use lead email as record lookup
        totalProcessingMs,
      });

      if (!deliveryResult.success) {
        this.logger.briefFailed({
          meeting_id: meeting.meeting_id,
          brain_id: this.brainId,
          brief_id: briefId,
          error_code: deliveryResult.code,
          error_message: deliveryResult.error,
          retry_count: deliveryResult.retryCount,
          recoverable: deliveryResult.code !== 'CHANNEL_NOT_FOUND',
        });

        return {
          success: false,
          message: 'Brief delivery failed',
          error: {
            code: deliveryResult.code,
            message: deliveryResult.error,
          },
          processing_time_ms: timer(),
        };
      }

      // Update state manager with successful brief
      if (this.stateManager) {
        this.stateManager.recordBriefDelivered({
          brief_id: briefId,
          meeting_id: meeting.meeting_id,
          delivered_at: deliveryResult.deliveredAt,
          processing_time_ms: timer(),
        });
        await this.stateManager.checkpoint();
      }

      return {
        success: true,
        message: 'Brief generated and delivered successfully',
        brief_id: briefId,
        processing_time_ms: timer(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.briefFailed({
        meeting_id: payload.event.event_id,
        brain_id: this.brainId,
        brief_id: briefId,
        error_code: 'BRIEF_GENERATION_FAILED',
        error_message: errorMessage,
        retry_count: 0,
        recoverable: true,
      });

      return {
        success: false,
        message: 'Brief generation failed',
        error: {
          code: 'BRIEF_GENERATION_FAILED',
          message: errorMessage,
        },
        processing_time_ms: timer(),
      };
    }
  }

  /**
   * Generate a pre-call brief from a manual request (T044).
   *
   * Flow:
   * 1. Find meeting by ID or upcoming meeting for attendee email
   * 2. Gather context from all sources
   * 3. Generate brief with Claude structured outputs
   * 4. Deliver via Slack
   */
  async generateBriefManual(
    request: ManualBriefRequest
  ): Promise<BriefWebhookResponse> {
    const timer = this.logger.startTimer();
    let briefId: string | undefined;

    // Log brief requested
    this.logger.briefRequested({
      meeting_id: request.meeting_id ?? `manual_${Date.now()}`,
      brain_id: this.brainId,
      source: 'manual_request',
      attendee_email: request.attendee_email ?? 'unknown',
      meeting_start: new Date().toISOString(),
    });

    try {
      // Step 1: Find the meeting
      const meetingResult = await this.findMeetingForManualRequest(request);
      if (!meetingResult.success) {
        return {
          success: false,
          message: meetingResult.message,
          error: {
            code: meetingResult.code,
            message: meetingResult.message,
          },
          processing_time_ms: timer(),
        };
      }

      const meeting = meetingResult.meeting;

      // Create pending brief for tracking
      const brief = createPendingBrief(meeting.meeting_id, this.brainId);
      briefId = brief.brief_id;

      this.logger.info('Found meeting for manual brief', {
        meeting_id: meeting.meeting_id,
        brief_id: briefId,
        attendee: meeting.primary_attendee.email,
      });

      // Step 2: Gather context from all sources
      const contextResult = await this.contextGatherer.gather({
        brainId: this.brainId,
        briefId,
        meeting,
      });

      if (!contextResult.success) {
        const failedSourcesInfo =
          contextResult.failed_sources.length > 0
            ? ` (failed: ${contextResult.failed_sources.join(', ')})`
            : '';

        this.logger.briefFailed({
          meeting_id: meeting.meeting_id,
          brain_id: this.brainId,
          brief_id: briefId,
          error_code: 'CONTEXT_GATHERING_FAILED',
          error_message: contextResult.error + failedSourcesInfo,
          retry_count: 0,
          recoverable: true,
        });

        return {
          success: false,
          message: 'Context gathering failed',
          error: {
            code: 'CONTEXT_GATHERING_FAILED',
            message: contextResult.error + failedSourcesInfo,
          },
          processing_time_ms: timer(),
        };
      }

      // Step 3: Generate brief using Claude with structured outputs
      const generationResult = await this.briefGenerator.generate({
        brainId: this.brainId,
        briefId,
        meeting,
        context: contextResult.context,
      });

      if (!generationResult.success) {
        this.logger.briefFailed({
          meeting_id: meeting.meeting_id,
          brain_id: this.brainId,
          brief_id: briefId,
          error_code: generationResult.code,
          error_message: generationResult.error,
          retry_count: 0,
          recoverable: generationResult.code !== 'PARSING_ERROR',
        });

        return {
          success: false,
          message: 'Brief generation failed',
          error: {
            code: generationResult.code,
            message: generationResult.error,
          },
          processing_time_ms: timer(),
        };
      }

      // Step 4: Deliver brief via Slack
      const totalProcessingMs = timer();
      const deliveryResult = await this.slackDelivery.deliver({
        brainId: this.brainId,
        briefId,
        meeting,
        content: generationResult.content,
        channel: this.slackBriefChannel,
        attioRecordId: contextResult.context.lead.email,
        totalProcessingMs,
      });

      if (!deliveryResult.success) {
        this.logger.briefFailed({
          meeting_id: meeting.meeting_id,
          brain_id: this.brainId,
          brief_id: briefId,
          error_code: deliveryResult.code,
          error_message: deliveryResult.error,
          retry_count: deliveryResult.retryCount,
          recoverable: deliveryResult.code !== 'CHANNEL_NOT_FOUND',
        });

        return {
          success: false,
          message: 'Brief delivery failed',
          error: {
            code: deliveryResult.code,
            message: deliveryResult.error,
          },
          processing_time_ms: timer(),
        };
      }

      // Update state manager with successful brief
      if (this.stateManager) {
        this.stateManager.recordBriefDelivered({
          brief_id: briefId,
          meeting_id: meeting.meeting_id,
          delivered_at: deliveryResult.deliveredAt,
          processing_time_ms: timer(),
        });
        await this.stateManager.checkpoint();
      }

      return {
        success: true,
        message: 'Brief generated and delivered successfully',
        brief_id: briefId,
        processing_time_ms: timer(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.briefFailed({
        meeting_id: request.meeting_id ?? 'unknown',
        brain_id: this.brainId,
        brief_id: briefId,
        error_code: 'BRIEF_GENERATION_FAILED',
        error_message: errorMessage,
        retry_count: 0,
        recoverable: true,
      });

      return {
        success: false,
        message: 'Brief generation failed',
        error: {
          code: 'BRIEF_GENERATION_FAILED',
          message: errorMessage,
        },
        processing_time_ms: timer(),
      };
    }
  }

  /**
   * Find a meeting for manual brief request.
   * Looks up by meeting_id or finds upcoming meeting for attendee email.
   */
  private async findMeetingForManualRequest(
    request: ManualBriefRequest
  ): Promise<
    | { success: true; meeting: ParsedMeeting }
    | { success: false; code: string; message: string }
  > {
    // Option 1: Look up by meeting_id
    if (request.meeting_id) {
      if (this.stateManager) {
        const state = this.stateManager.getState();
        const upcomingMeeting = state.upcoming_meetings.find(
          (m) => m.meeting_id === request.meeting_id
        );

        if (upcomingMeeting) {
          const meeting = this.buildParsedMeetingFromState(
            upcomingMeeting,
            request.brain_id
          );
          return { success: true, meeting };
        }
      }

      // If not in state, create a placeholder meeting
      // In production, we might want to re-fetch from calendar API
      return {
        success: false,
        code: 'MEETING_NOT_FOUND',
        message: `Meeting not found: ${request.meeting_id}`,
      };
    }

    // Option 2: Find upcoming meeting for attendee email
    if (request.attendee_email) {
      const email = request.attendee_email.toLowerCase();
      const now = Date.now();
      const maxHoursAhead = 48;
      const maxTime = now + maxHoursAhead * 60 * 60 * 1000;

      if (this.stateManager) {
        const state = this.stateManager.getState();

        // Find meetings with this attendee that are upcoming
        const matchingMeetings = state.upcoming_meetings
          .filter((m) => {
            const meetingTime = new Date(m.start_time).getTime();
            return (
              m.primary_attendee_email.toLowerCase() === email &&
              meetingTime >= now &&
              meetingTime <= maxTime
            );
          })
          .sort(
            (a, b) =>
              new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
          );

        if (matchingMeetings.length > 0) {
          const nextMeeting = matchingMeetings[0];
          const meeting = this.buildParsedMeetingFromState(
            nextMeeting,
            request.brain_id
          );
          return { success: true, meeting };
        }
      }

      // No meetings found for this email - create an ad-hoc meeting
      // This allows manual briefs for leads not yet in the calendar
      const adHocTime = new Date();
      const adHocMeeting: ParsedMeeting = {
        meeting_id: `manual_${Date.now()}`,
        brain_id: request.brain_id,
        title: `Call with ${request.attendee_email}`,
        description: null,
        start_time: adHocTime.toISOString(),
        end_time: new Date(adHocTime.getTime() + 30 * 60 * 1000).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        primary_attendee: {
          email: request.attendee_email,
          name: null,
          is_external: true,
        },
        other_attendees: [],
        meeting_link: null,
        meeting_type: 'unknown',
        status: 'confirmed',
        recurring_event_id: null,
        created_at: adHocTime.toISOString(),
        source: 'manual_request',
      };

      this.logger.debug('Created ad-hoc meeting for manual brief', {
        meeting_id: adHocMeeting.meeting_id,
        attendee_email: request.attendee_email,
      });

      return { success: true, meeting: adHocMeeting };
    }

    return {
      success: false,
      code: 'INVALID_REQUEST',
      message: 'Either meeting_id or attendee_email must be provided',
    };
  }

  /**
   * Build a ParsedMeeting from UpcomingMeeting state.
   */
  private buildParsedMeetingFromState(
    upcomingMeeting: { meeting_id: string; start_time: string; primary_attendee_email: string },
    brainId: string
  ): ParsedMeeting {
    const startTime = new Date(upcomingMeeting.start_time);
    return {
      meeting_id: upcomingMeeting.meeting_id,
      brain_id: brainId,
      title: `Meeting with ${upcomingMeeting.primary_attendee_email}`,
      description: null,
      start_time: upcomingMeeting.start_time,
      end_time: new Date(startTime.getTime() + 30 * 60 * 1000).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      primary_attendee: {
        email: upcomingMeeting.primary_attendee_email,
        name: null,
        is_external: true,
      },
      other_attendees: [],
      meeting_link: null,
      meeting_type: 'unknown',
      status: 'confirmed',
      recurring_event_id: null,
      created_at: new Date().toISOString(),
      source: 'manual_request',
    };
  }

  // ===========================================
  // Meeting Analysis (US2)
  // ===========================================

  /**
   * Analyze a meeting transcript.
   *
   * Flow:
   * 1. Parse and validate transcript
   * 2. Extract BANT qualification with structured outputs
   * 3. Extract objections, action items, key quotes
   * 4. Update CRM with insights (Attio + Airtable)
   * 5. Create follow-up tasks
   */
  async analyzeTranscript(
    input: TranscriptInput
  ): Promise<AnalysisWebhookResponse> {
    const timer = this.logger.startTimer();

    // Log analysis requested
    this.logger.analysisRequested({
      meeting_id: input.meeting_id,
      brain_id: this.brainId,
      transcript_source: input.source,
      transcript_length: input.transcript_text.length,
    });

    try {
      // Step 1: Analyze transcript with Claude structured outputs
      const analysisResult = await this.transcriptAnalyzer.analyze({
        brainId: this.brainId,
        input,
        // Optional: Add brief context if we have it from a prior brief
        briefContext: await this.getBriefContextForMeeting(input.meeting_id),
      });

      if (!analysisResult.success) {
        this.logger.analysisFailed({
          meeting_id: input.meeting_id,
          brain_id: this.brainId,
          error_code: analysisResult.code,
          error_message: analysisResult.error,
          retry_count: 0,
          recoverable: analysisResult.code !== 'TRANSCRIPT_TOO_SHORT',
        });

        return {
          success: false,
          message: 'Transcript analysis failed',
          error: {
            code: analysisResult.code,
            message: analysisResult.error,
          },
          processing_time_ms: timer(),
        };
      }

      const { analysis } = analysisResult;

      // Step 2: Update CRM systems with analysis results
      const crmResult = await this.crmUpdater.update({
        brainId: this.brainId,
        analysis,
        attendeeEmail: input.attendee_email ?? '',
      });

      // CRM update failures are logged but don't fail the overall analysis
      if (!crmResult.success) {
        this.logger.warn('CRM update had issues', {
          meeting_id: input.meeting_id,
          error: crmResult.error,
          code: crmResult.code,
          partial_updates: crmResult.partialUpdates,
        });
      }

      // Step 3: Update state with successful analysis
      if (this.stateManager) {
        this.stateManager.recordAnalysisCompleted({
          analysis_id: analysis.analysis_id,
          meeting_id: input.meeting_id,
          analyzed_at: analysis.analyzed_at,
          bant_score: analysis.bant.overall.score,
          recommendation: analysis.bant.overall.recommendation,
        });
        await this.stateManager.checkpoint();
      }

      // Log analysis completed
      this.logger.analysisCompleted({
        meeting_id: input.meeting_id,
        brain_id: this.brainId,
        analysis_id: analysis.analysis_id,
        duration_ms: timer(),
        bant_score: analysis.bant.overall.score,
        recommendation: analysis.bant.overall.recommendation,
        objections_count: analysis.objections.length,
        action_items_count: analysis.action_items.length,
      });

      return {
        success: true,
        message: 'Transcript analyzed successfully',
        analysis_id: analysis.analysis_id,
        bant_score: analysis.bant.overall.score,
        recommendation: analysis.bant.overall.recommendation,
        crm_updated: crmResult.success,
        processing_time_ms: timer(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.analysisFailed({
        meeting_id: input.meeting_id,
        brain_id: this.brainId,
        error_code: 'ANALYSIS_FAILED',
        error_message: errorMessage,
        retry_count: 0,
        recoverable: true,
      });

      return {
        success: false,
        message: 'Analysis failed',
        error: {
          code: 'ANALYSIS_FAILED',
          message: errorMessage,
        },
        processing_time_ms: timer(),
      };
    }
  }

  /**
   * Get brief context for a meeting if we generated a brief earlier.
   * Used to provide context to the transcript analyzer.
   */
  private async getBriefContextForMeeting(
    meetingId: string
  ): Promise<{ company_name?: string; attendee_name?: string } | undefined> {
    // Check if we have a brief for this meeting in state
    if (!this.stateManager) return undefined;

    const state = this.stateManager.getState();
    const recentBrief = state.recent_briefs.find(
      (b) => b.meeting_id === meetingId
    );

    // If we found a matching brief, we could fetch more context
    // For now, just return undefined - the analyzer can work without it
    if (recentBrief) {
      return undefined; // TODO: Retrieve stored brief content for context
    }

    return undefined;
  }

  // ===========================================
  // Context Gathering (US3)
  // ===========================================

  /**
   * Gather context for brief generation.
   * Uses sub-agent pattern for parallel data gathering.
   */
  async gatherContext(
    attendeeEmail: string,
    meetingId: string
  ): Promise<GatheredContext> {
    const timer = this.logger.startTimer();

    // TODO: Implement in Phase 5 (T036-T040)
    // 1. Fetch lead from Airtable
    // 2. Fetch company from Attio
    // 3. Query KB for objection handlers
    // 4. Query KB for similar deals
    // 5. Fetch company research (with caching)
    // 6. Compile conversation history

    // Placeholder context
    const context: GatheredContext = {
      lead: {
        email: attendeeEmail,
        name: null,
        company: null,
        title: null,
        industry: null,
        icp_score: null,
        vertical: null,
      },
      conversation_history: [],
      company_intel: null,
      kb_context: {
        objection_handlers: [],
        similar_deals: [],
        icp_rules: [],
      },
      gathered_at: new Date().toISOString(),
      gathering_duration_ms: timer(),
      missing_sources: [], // T039: No missing sources in placeholder
    };

    this.logger.contextGathered({
      meeting_id: meetingId,
      brain_id: this.brainId,
      brief_id: '',
      sources_used: [],
      duration_ms: timer(),
      cache_hit: false,
    });

    return context;
  }

  // ===========================================
  // State Access
  // ===========================================

  /**
   * Get current session statistics
   */
  getSessionStats(): ReturnType<MeetingPrepStateManager['getSessionStats']> | null {
    return this.stateManager?.getSessionStats() ?? null;
  }

  /**
   * Get state manager (for testing/debugging)
   */
  getStateManager(): MeetingPrepStateManager | undefined {
    return this.stateManager;
  }

  /**
   * Get logger (for testing/debugging)
   */
  getLogger(): MeetingPrepLogger {
    return this.logger;
  }

  // ===========================================
  // Configuration Access
  // ===========================================

  /**
   * Get agent configuration
   */
  getConfig(): Readonly<MeetingPrepConfig> {
    return this.config;
  }

  /**
   * Get brain ID
   */
  getBrainId(): BrainId {
    return this.brainId;
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Meeting Prep Agent.
 */
export function createMeetingPrepAgent(
  config: MeetingPrepAgentConfig
): MeetingPrepAgent {
  return new MeetingPrepAgent(config);
}

/**
 * Create and initialize a Meeting Prep Agent.
 */
export async function createAndInitMeetingPrepAgent(
  config: MeetingPrepAgentConfig
): Promise<MeetingPrepAgent> {
  const agent = new MeetingPrepAgent(config);
  await agent.initialize();
  return agent;
}
