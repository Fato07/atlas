/**
 * Brief Generator
 *
 * Generates pre-call briefs using Claude with structured outputs.
 * Implements FR-005 (structured outputs via betaTool) and FR-012 (token budget).
 *
 * @module meeting-prep/brief-generator
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlock, Message } from '@anthropic-ai/sdk/resources/messages';
import { buildTool, extractToolResult, forceToolChoice } from '@atlas-gtm/lib';
import type { BrainId } from '@atlas-gtm/lib';

import { BriefContentSchema, type BriefContent } from './contracts/brief';
import type { GatheredContext } from './types';
import type { MeetingPrepLogger } from './logger';
import type { ParsedMeeting } from './contracts/meeting-input';

// ===========================================
// Types
// ===========================================

export interface BriefGeneratorConfig {
  /** Claude model to use */
  model: string;

  /** Maximum tokens for response */
  maxTokens: number;

  /** Context budget in tokens (FR-012) */
  contextBudgetTokens: number;

  /** Threshold for compaction trigger (FR-012: 80%) */
  compactionThreshold: number;

  /** Temperature for generation */
  temperature: number;
}

export const DEFAULT_BRIEF_GENERATOR_CONFIG: BriefGeneratorConfig = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  contextBudgetTokens: 100000, // FR-012
  compactionThreshold: 0.8, // 80%
  temperature: 0.3,
};

export interface BriefGeneratorDependencies {
  client: Anthropic;
  logger: MeetingPrepLogger;
}

export interface GenerateBriefRequest {
  brainId: BrainId;
  briefId: string;
  meeting: ParsedMeeting;
  context: GatheredContext;
}

export interface GenerateBriefResult {
  success: true;
  content: BriefContent;
  tokens_used: number;
  duration_ms: number;
}

export interface GenerateBriefError {
  success: false;
  error: string;
  code: 'GENERATION_ERROR' | 'PARSING_ERROR' | 'CONTEXT_OVERFLOW' | 'TIMEOUT';
}

export type GenerateBriefOutput = GenerateBriefResult | GenerateBriefError;

// ===========================================
// Brief Tool Definition
// ===========================================

const BRIEF_TOOL = buildTool({
  name: 'generate_brief',
  description:
    'Generate a comprehensive pre-call brief with context, talking points, and objection handlers',
  schema: BriefContentSchema,
});

// ===========================================
// Brief Generator Class
// ===========================================

export class BriefGenerator {
  private readonly config: BriefGeneratorConfig;
  private readonly deps: BriefGeneratorDependencies;

  constructor(
    deps: BriefGeneratorDependencies,
    config?: Partial<BriefGeneratorConfig>
  ) {
    this.config = { ...DEFAULT_BRIEF_GENERATOR_CONFIG, ...config };
    this.deps = deps;
  }

  /**
   * Generate a pre-call brief from gathered context.
   * Uses Claude with structured outputs (FR-005).
   */
  async generate(request: GenerateBriefRequest): Promise<GenerateBriefOutput> {
    const startTime = performance.now();
    const { brainId, briefId, meeting, context } = request;

    this.deps.logger.debug('Starting brief generation', {
      meeting_id: meeting.meeting_id,
      brief_id: briefId,
    });

    try {
      // Build the messages for Claude
      const messages = this.buildMessages(meeting, context);

      // Estimate token usage and check budget (FR-012)
      const estimatedTokens = this.estimateTokens(messages);
      if (estimatedTokens > this.config.contextBudgetTokens * this.config.compactionThreshold) {
        this.deps.logger.warn('Context approaching budget, applying compaction', {
          estimated_tokens: estimatedTokens,
          budget: this.config.contextBudgetTokens,
          threshold: this.config.compactionThreshold,
        });
        // Apply compaction by summarizing context
        const compactedMessages = this.compactMessages(messages, context);
        messages.length = 0;
        messages.push(...compactedMessages);
      }

      // Call Claude with structured output (non-streaming)
      const response = await this.deps.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        tools: [BRIEF_TOOL.tool],
        tool_choice: forceToolChoice(BRIEF_TOOL.name),
        messages,
        stream: false,
      }) as Message;

      // Extract tool result
      const toolResult = extractToolResult(
        response.content as ContentBlock[],
        BRIEF_TOOL.name
      );

      if (!toolResult) {
        return {
          success: false,
          error: 'No tool result returned from Claude',
          code: 'GENERATION_ERROR',
        };
      }

      // Parse and validate the result
      const content = BRIEF_TOOL.parse(toolResult);
      const durationMs = Math.round(performance.now() - startTime);
      const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

      // Log brief_generated event (FR-015)
      this.deps.logger.briefGenerated({
        meeting_id: meeting.meeting_id,
        brain_id: brainId,
        brief_id: briefId,
        sections_generated: this.getSectionsGenerated(content),
        tokens_used: tokensUsed,
        duration_ms: durationMs,
      });

      return {
        success: true,
        content,
        tokens_used: tokensUsed,
        duration_ms: durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for specific error types
      if (errorMessage.includes('context_length_exceeded')) {
        return {
          success: false,
          error: 'Context exceeded maximum length',
          code: 'CONTEXT_OVERFLOW',
        };
      }

      if (errorMessage.includes('timeout')) {
        return {
          success: false,
          error: 'Brief generation timed out',
          code: 'TIMEOUT',
        };
      }

      if (error instanceof Anthropic.APIError) {
        return {
          success: false,
          error: `API error: ${errorMessage}`,
          code: 'GENERATION_ERROR',
        };
      }

      // Check for Zod parsing errors
      if (errorMessage.includes('ZodError') || errorMessage.includes('validation')) {
        return {
          success: false,
          error: `Response parsing failed: ${errorMessage}`,
          code: 'PARSING_ERROR',
        };
      }

      return {
        success: false,
        error: errorMessage,
        code: 'GENERATION_ERROR',
      };
    }
  }

  /**
   * Build messages for Claude with context.
   */
  private buildMessages(
    meeting: ParsedMeeting,
    context: GatheredContext
  ): MessageParam[] {
    const systemContext = this.buildSystemContext(meeting, context);
    const userPrompt = this.buildUserPrompt(meeting, context);

    return [
      {
        role: 'user',
        content: `${systemContext}\n\n---\n\n${userPrompt}`,
      },
    ];
  }

  /**
   * Build system context section.
   */
  private buildSystemContext(
    meeting: ParsedMeeting,
    context: GatheredContext
  ): string {
    const sections: string[] = [];

    // Lead information
    sections.push('## Lead Information');
    sections.push(`- **Email**: ${context.lead.email}`);
    if (context.lead.name) sections.push(`- **Name**: ${context.lead.name}`);
    if (context.lead.company) sections.push(`- **Company**: ${context.lead.company}`);
    if (context.lead.title) sections.push(`- **Title**: ${context.lead.title}`);
    if (context.lead.industry) sections.push(`- **Industry**: ${context.lead.industry}`);
    if (context.lead.icp_score !== null) {
      sections.push(`- **ICP Score**: ${context.lead.icp_score}/100`);
    }
    if (context.lead.vertical) sections.push(`- **Vertical**: ${context.lead.vertical}`);

    // Meeting details
    const durationMinutes = this.calculateDurationMinutes(meeting.start_time, meeting.end_time);
    sections.push('\n## Meeting Details');
    sections.push(`- **Title**: ${meeting.title}`);
    sections.push(`- **Start Time**: ${meeting.start_time}`);
    sections.push(`- **Duration**: ${durationMinutes} minutes`);
    if (meeting.meeting_link) {
      sections.push(`- **Meeting Link**: ${meeting.meeting_link}`);
    }
    if (meeting.other_attendees.length > 0) {
      const otherAttendees = meeting.other_attendees
        .map((a) => a.name || a.email)
        .join(', ');
      sections.push(`- **Other Attendees**: ${otherAttendees}`);
    }

    // Conversation history
    if (context.conversation_history.length > 0) {
      sections.push('\n## Conversation History');
      for (const entry of context.conversation_history) {
        const date = new Date(entry.date).toLocaleDateString();
        sections.push(`- **${date}** (${entry.channel}): ${entry.summary} [${entry.sentiment}]`);
      }
    }

    // Company intel
    if (context.company_intel) {
      sections.push('\n## Company Intelligence');
      sections.push(`- **Industry**: ${context.company_intel.industry}`);
      sections.push(`- **Size**: ${context.company_intel.size}`);
      if (context.company_intel.funding_stage) {
        sections.push(`- **Funding Stage**: ${context.company_intel.funding_stage}`);
      }
      if (context.company_intel.tech_stack.length > 0) {
        sections.push(`- **Tech Stack**: ${context.company_intel.tech_stack.join(', ')}`);
      }
      if (context.company_intel.recent_news.length > 0) {
        sections.push('- **Recent News**:');
        for (const news of context.company_intel.recent_news) {
          sections.push(`  - ${news}`);
        }
      }
      if (context.company_intel.key_people.length > 0) {
        sections.push('- **Key People**:');
        for (const person of context.company_intel.key_people) {
          sections.push(`  - ${person.name} (${person.title}) - ${person.relevance}`);
        }
      }
    }

    // KB context (objection handlers)
    if (context.kb_context.objection_handlers.length > 0) {
      sections.push('\n## Known Objection Handlers');
      for (const handler of context.kb_context.objection_handlers) {
        sections.push(`### ${handler.objection}`);
        sections.push(`**Response**: ${handler.response}`);
        sections.push(`**Confidence**: ${Math.round(handler.confidence * 100)}%`);
        sections.push('');
      }
    }

    // KB context (similar deals)
    if (context.kb_context.similar_deals.length > 0) {
      sections.push('\n## Similar Won Deals');
      for (const deal of context.kb_context.similar_deals) {
        sections.push(`### ${deal.company} (${deal.industry})`);
        sections.push(`**Why Won**: ${deal.why_won}`);
        sections.push(`**Relevance**: ${Math.round(deal.relevance_score * 100)}%`);
        sections.push('');
      }
    }

    // ICP rules
    if (context.kb_context.icp_rules.length > 0) {
      sections.push('\n## ICP Evaluation Criteria');
      for (const rule of context.kb_context.icp_rules) {
        sections.push(`- **${rule.dimension}**: ${rule.rule}`);
      }
    }

    return sections.join('\n');
  }

  /**
   * Build user prompt for brief generation.
   */
  private buildUserPrompt(
    meeting: ParsedMeeting,
    context: GatheredContext
  ): string {
    const isNewLead = context.lead.icp_score === null;
    const leadContext = isNewLead
      ? 'This is a NEW LEAD with no prior CRM record. Focus on discovery and qualification.'
      : `This lead has an ICP score of ${context.lead.icp_score}/100.`;

    return `Generate a comprehensive pre-call brief for an upcoming meeting.

**Meeting Context**:
- Meeting with: ${context.lead.name || context.lead.email}
- Company: ${context.lead.company || 'Unknown'}
- Scheduled: ${meeting.start_time}
- ${leadContext}

**Instructions**:
1. Create a quick_context paragraph summarizing who this person is, their current stage, and the key context for this meeting
2. Include the conversation_timeline showing recent interactions across all channels
3. Provide company_intel with industry research, size, funding, and key people
4. Generate 3-7 tailored talking_points specific to this lead and meeting
5. Suggest 2-5 discovery questions to ask during the meeting
6. Include likely objection_handlers based on the known objections and similar deals
7. Reference similar_won_deals that can be used as social proof

Focus on actionable insights that will help the sales rep have a productive meeting.
${isNewLead ? 'Since this is a new lead, prioritize discovery questions and qualification criteria.' : ''}`;
  }

  /**
   * Calculate meeting duration in minutes from start and end times.
   */
  private calculateDurationMinutes(startTime: string, endTime: string): number {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    return Math.round((end - start) / (1000 * 60));
  }

  /**
   * Estimate token count for messages.
   * Uses a rough estimate of 4 characters per token.
   */
  private estimateTokens(messages: MessageParam[]): number {
    let totalChars = 0;
    for (const message of messages) {
      if (typeof message.content === 'string') {
        totalChars += message.content.length;
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if ('text' in block && typeof block.text === 'string') {
            totalChars += block.text.length;
          }
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }

  /**
   * Compact messages to reduce token usage (FR-012).
   * Summarizes verbose sections while preserving key information.
   */
  private compactMessages(
    messages: MessageParam[],
    context: GatheredContext
  ): MessageParam[] {
    // Create a more concise version of the context
    const compactContext = this.buildCompactContext(context);

    // Rebuild messages with compact context
    return [
      {
        role: 'user',
        content: compactContext,
      },
    ];
  }

  /**
   * Build a compact version of the context.
   */
  private buildCompactContext(context: GatheredContext): string {
    const sections: string[] = [];

    // Compact lead info
    sections.push(`Lead: ${context.lead.name || context.lead.email}`);
    if (context.lead.company) sections.push(`Company: ${context.lead.company}`);
    if (context.lead.title) sections.push(`Title: ${context.lead.title}`);
    if (context.lead.icp_score !== null) {
      sections.push(`ICP: ${context.lead.icp_score}/100`);
    }

    // Compact conversation history (most recent 3)
    if (context.conversation_history.length > 0) {
      sections.push('\nRecent Activity:');
      for (const entry of context.conversation_history.slice(0, 3)) {
        sections.push(`- ${entry.channel}: ${entry.summary.substring(0, 100)}...`);
      }
    }

    // Compact company intel
    if (context.company_intel) {
      sections.push(`\nCompany: ${context.company_intel.industry}, ${context.company_intel.size}`);
    }

    // Compact KB context (top objection and deal only)
    if (context.kb_context.objection_handlers.length > 0) {
      const top = context.kb_context.objection_handlers[0];
      sections.push(`\nTop Objection: ${top.objection} → ${top.response.substring(0, 100)}...`);
    }

    if (context.kb_context.similar_deals.length > 0) {
      const top = context.kb_context.similar_deals[0];
      sections.push(`Similar Win: ${top.company} - ${top.why_won.substring(0, 100)}...`);
    }

    sections.push('\n---\nGenerate a concise pre-call brief with all required sections.');

    return sections.join('\n');
  }

  /**
   * Get list of sections that were generated.
   */
  private getSectionsGenerated(content: BriefContent): string[] {
    const sections: string[] = [];

    if (content.quick_context) sections.push('quick_context');
    if (content.conversation_timeline.length > 0) sections.push('conversation_timeline');
    if (content.company_intel) sections.push('company_intel');
    if (content.talking_points.length > 0) sections.push('talking_points');
    if (content.suggested_questions.length > 0) sections.push('suggested_questions');
    if (content.objection_handlers.length > 0) sections.push('objection_handlers');
    if (content.similar_won_deals.length > 0) sections.push('similar_won_deals');

    return sections;
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a brief generator instance.
 */
export function createBriefGenerator(
  deps: BriefGeneratorDependencies,
  config?: Partial<BriefGeneratorConfig>
): BriefGenerator {
  return new BriefGenerator(deps, config);
}
