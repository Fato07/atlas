/**
 * Slack Brief Delivery
 *
 * Delivers pre-call briefs to Slack using Block Kit formatting.
 * Implements FR-006 (Block Kit formatting) and FR-016 (retry with exponential backoff).
 *
 * @module meeting-prep/slack-delivery
 */

import { WebClient, type ChatPostMessageResponse } from '@slack/web-api';
import type { BriefContent } from './contracts/brief';
import type { ParsedMeeting } from './contracts/meeting-input';
import type { MeetingPrepLogger } from './logger';
import type { BrainId } from '@atlas-gtm/lib';

// ===========================================
// Types
// ===========================================

export interface SlackDeliveryConfig {
  /** Retry configuration (FR-016) */
  maxRetries: number;

  /** Backoff delays in ms [1s, 2s, 4s] */
  backoffDelaysMs: number[];

  /** Base URL for Attio record links */
  attioBaseUrl: string;
}

export const DEFAULT_SLACK_DELIVERY_CONFIG: SlackDeliveryConfig = {
  maxRetries: 3,
  backoffDelaysMs: [1000, 2000, 4000], // FR-016: exponential backoff
  attioBaseUrl: 'https://app.attio.com/records',
};

// ===========================================
// Block Kit Character Limits (T043)
// ===========================================

/** Maximum characters for header block text */
const HEADER_MAX_CHARS = 150;

/** Maximum characters for section block text */
const SECTION_MAX_CHARS = 3000;

/** Maximum characters for field text */
const FIELD_MAX_CHARS = 2000;

/** Maximum characters for button text */
const BUTTON_TEXT_MAX_CHARS = 75;

/** Maximum characters for context block element */
const CONTEXT_MAX_CHARS = 2000;

/** Truncation indicator */
const TRUNCATION_ELLIPSIS = '...';

export interface SlackDeliveryDependencies {
  /** Slack Web API client */
  client: WebClient;

  /** Logger instance */
  logger: MeetingPrepLogger;
}

export interface DeliverBriefRequest {
  brainId: BrainId;
  briefId: string;
  meeting: ParsedMeeting;
  content: BriefContent;
  channel: string;

  /** Lead's Attio record ID for "Full Record" button */
  attioRecordId?: string;

  /** Total processing time including context gathering and generation */
  totalProcessingMs: number;
}

export interface DeliverBriefResult {
  success: true;
  channel: string;
  messageTs: string;
  deliveredAt: string;
}

export interface DeliverBriefError {
  success: false;
  error: string;
  code: 'DELIVERY_ERROR' | 'CHANNEL_NOT_FOUND' | 'RATE_LIMITED' | 'MAX_RETRIES_EXCEEDED';
  retryCount: number;
}

export type DeliverBriefOutput = DeliverBriefResult | DeliverBriefError;

// ===========================================
// Block Kit Types
// ===========================================

type SlackBlock =
  | HeaderBlock
  | SectionBlock
  | DividerBlock
  | ActionsBlock
  | ContextBlock;

interface HeaderBlock {
  type: 'header';
  text: {
    type: 'plain_text';
    text: string;
    emoji?: boolean;
  };
}

interface SectionBlock {
  type: 'section';
  text?: {
    type: 'mrkdwn' | 'plain_text';
    text: string;
  };
  fields?: Array<{
    type: 'mrkdwn' | 'plain_text';
    text: string;
  }>;
  accessory?: ButtonElement;
}

interface DividerBlock {
  type: 'divider';
}

interface ActionsBlock {
  type: 'actions';
  elements: ButtonElement[];
}

interface ContextBlock {
  type: 'context';
  elements: Array<{
    type: 'mrkdwn' | 'plain_text';
    text: string;
  }>;
}

interface ButtonElement {
  type: 'button';
  text: {
    type: 'plain_text';
    text: string;
    emoji?: boolean;
  };
  url?: string;
  action_id?: string;
  style?: 'primary' | 'danger';
}

// ===========================================
// Truncation Utilities (T043)
// ===========================================

/**
 * Truncate text to a maximum length with ellipsis indicator.
 * Respects word boundaries when possible.
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length including ellipsis
 * @returns Truncated text with ellipsis if needed
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Account for ellipsis length
  const targetLength = maxLength - TRUNCATION_ELLIPSIS.length;

  // Try to break at a word boundary
  const truncated = text.substring(0, targetLength);
  const lastSpace = truncated.lastIndexOf(' ');

  // Only break at word boundary if we're not cutting off too much
  if (lastSpace > targetLength * 0.7) {
    return truncated.substring(0, lastSpace).trimEnd() + TRUNCATION_ELLIPSIS;
  }

  return truncated.trimEnd() + TRUNCATION_ELLIPSIS;
}

/**
 * Truncate header text to Slack Block Kit limit.
 */
function truncateHeader(text: string): string {
  return truncateText(text, HEADER_MAX_CHARS);
}

/**
 * Truncate section text to Slack Block Kit limit.
 */
function truncateSection(text: string): string {
  return truncateText(text, SECTION_MAX_CHARS);
}

/**
 * Truncate field text to Slack Block Kit limit.
 */
function truncateField(text: string): string {
  return truncateText(text, FIELD_MAX_CHARS);
}

/**
 * Truncate button text to Slack Block Kit limit.
 */
function truncateButtonText(text: string): string {
  return truncateText(text, BUTTON_TEXT_MAX_CHARS);
}

/**
 * Truncate context element text to Slack Block Kit limit.
 */
function truncateContext(text: string): string {
  return truncateText(text, CONTEXT_MAX_CHARS);
}

// ===========================================
// Slack Brief Delivery Class
// ===========================================

export class SlackBriefDelivery {
  private readonly config: SlackDeliveryConfig;
  private readonly deps: SlackDeliveryDependencies;

  constructor(
    deps: SlackDeliveryDependencies,
    config?: Partial<SlackDeliveryConfig>
  ) {
    this.config = { ...DEFAULT_SLACK_DELIVERY_CONFIG, ...config };
    this.deps = deps;
  }

  /**
   * Deliver brief to Slack channel with Block Kit formatting.
   * Implements retry with exponential backoff per FR-016.
   */
  async deliver(request: DeliverBriefRequest): Promise<DeliverBriefOutput> {
    const { brainId, briefId, meeting, content, channel, totalProcessingMs } = request;

    this.deps.logger.debug('Starting brief delivery', {
      brief_id: briefId,
      channel,
    });

    // Build Block Kit message
    const blocks = this.buildBriefBlocks(request);
    const fallbackText = this.buildFallbackText(meeting, content);

    // Retry loop with exponential backoff (FR-016)
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.deps.client.chat.postMessage({
          channel,
          blocks,
          text: fallbackText,
          unfurl_links: false,
          unfurl_media: false,
        });

        if (!response.ok || !response.ts) {
          throw new Error(response.error ?? 'Unknown Slack error');
        }

        const deliveredAt = new Date().toISOString();

        // Log brief_delivered event (FR-015)
        this.deps.logger.briefDelivered({
          meeting_id: meeting.meeting_id,
          brain_id: brainId,
          brief_id: briefId,
          slack_channel: channel,
          slack_message_ts: response.ts,
          total_processing_ms: totalProcessingMs,
        });

        return {
          success: true,
          channel,
          messageTs: response.ts,
          deliveredAt,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check for non-retryable errors
        const errorCode = this.categorizeError(lastError);
        if (errorCode === 'CHANNEL_NOT_FOUND') {
          return {
            success: false,
            error: lastError.message,
            code: 'CHANNEL_NOT_FOUND',
            retryCount: attempt,
          };
        }

        // Apply backoff delay before retry
        if (attempt < this.config.maxRetries) {
          const delay = this.config.backoffDelaysMs[attempt] ?? 4000;
          this.deps.logger.debug('Retrying brief delivery after delay', {
            attempt: attempt + 1,
            delay_ms: delay,
            error: lastError.message,
          });
          await this.sleep(delay);
        }
      }
    }

    // Max retries exceeded
    this.deps.logger.briefFailed({
      meeting_id: meeting.meeting_id,
      brain_id: brainId,
      brief_id: briefId,
      error_code: 'MAX_RETRIES_EXCEEDED',
      error_message: lastError?.message ?? 'Unknown error',
      retry_count: this.config.maxRetries,
      recoverable: false,
    });

    return {
      success: false,
      error: lastError?.message ?? 'Unknown delivery error',
      code: 'MAX_RETRIES_EXCEEDED',
      retryCount: this.config.maxRetries,
    };
  }

  /**
   * Build Block Kit blocks for brief message.
   * Implements FR-006 Block Kit formatting.
   */
  private buildBriefBlocks(request: DeliverBriefRequest): SlackBlock[] {
    const { meeting, content, attioRecordId } = request;
    const blocks: SlackBlock[] = [];

    // Header with meeting info
    const meetingDate = new Date(meeting.start_time);
    const formattedDate = meetingDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const formattedTime = meetingDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });

    // T043: Apply character limits to header
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: truncateHeader(`📋 Pre-Call Brief: ${meeting.title}`),
        emoji: true,
      },
    });

    // Meeting details context (T043: truncate)
    const contextText = `📅 *${formattedDate}* at *${formattedTime}* | ${meeting.primary_attendee.name || meeting.primary_attendee.email}`;
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: truncateContext(contextText),
        },
      ],
    });

    blocks.push({ type: 'divider' });

    // Quick Context section (T043: truncate)
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateSection(`*Quick Context*\n${content.quick_context}`),
      },
    });

    blocks.push({ type: 'divider' });

    // Company Intel section (if available) - T043: truncate all fields
    if (content.company_intel) {
      const intel = content.company_intel;
      const fields: Array<{ type: 'mrkdwn'; text: string }> = [
        { type: 'mrkdwn', text: truncateField(`*Industry*\n${intel.industry}`) },
        { type: 'mrkdwn', text: truncateField(`*Size*\n${intel.size}`) },
      ];

      if (intel.funding_stage) {
        fields.push({ type: 'mrkdwn', text: truncateField(`*Funding*\n${intel.funding_stage}`) });
      }

      if (intel.tech_stack.length > 0) {
        fields.push({
          type: 'mrkdwn',
          text: truncateField(`*Tech Stack*\n${intel.tech_stack.slice(0, 5).join(', ')}`),
        });
      }

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🏢 Company Intel*',
        },
      });

      blocks.push({
        type: 'section',
        fields: fields.slice(0, 4), // Slack max 4 fields per section
      });

      // Recent news (if any) - T043: truncate
      if (intel.recent_news.length > 0) {
        const newsItems = intel.recent_news
          .slice(0, 3)
          .map((news) => `• ${news}`)
          .join('\n');
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: truncateSection(`*Recent News*\n${newsItems}`),
          },
        });
      }

      blocks.push({ type: 'divider' });
    }

    // Talking Points section (T043: truncate)
    if (content.talking_points.length > 0) {
      const pointsList = content.talking_points
        .map((point, idx) => `${idx + 1}. ${point}`)
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateSection(`*💬 Talking Points*\n${pointsList}`),
        },
      });

      blocks.push({ type: 'divider' });
    }

    // Suggested Questions section (T043: truncate)
    if (content.suggested_questions.length > 0) {
      const questionsList = content.suggested_questions
        .map((q) => `• ${q}`)
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateSection(`*❓ Discovery Questions*\n${questionsList}`),
        },
      });

      blocks.push({ type: 'divider' });
    }

    // Objection Handlers section (T043: truncate)
    if (content.objection_handlers.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*⚡ Likely Objections*',
        },
      });

      for (const handler of content.objection_handlers.slice(0, 3)) {
        const confidencePercent = Math.round(handler.confidence * 100);
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: truncateSection(`*"${handler.objection}"* _(${confidencePercent}% confidence)_\n→ ${handler.response}`),
          },
        });
      }

      blocks.push({ type: 'divider' });
    }

    // Similar Won Deals section (T043: truncate)
    if (content.similar_won_deals.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🏆 Similar Won Deals*',
        },
      });

      for (const deal of content.similar_won_deals.slice(0, 2)) {
        const relevancePercent = Math.round(deal.relevance_score * 100);
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: truncateSection(`*${deal.company}* (${deal.industry}) - ${relevancePercent}% relevant\n_Why won:_ ${deal.why_won}\n_Key lesson:_ ${deal.key_lesson}`),
          },
        });
      }

      blocks.push({ type: 'divider' });
    }

    // Conversation Timeline (if any) (T043: truncate)
    if (content.conversation_timeline.length > 0) {
      const timeline = content.conversation_timeline
        .slice(0, 5)
        .map((entry) => {
          const date = new Date(entry.date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          });
          const sentimentEmoji = this.getSentimentEmoji(entry.sentiment);
          return `• *${date}* (${entry.channel}) ${sentimentEmoji} ${entry.summary}`;
        })
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateSection(`*📜 Recent Activity*\n${timeline}`),
        },
      });

      blocks.push({ type: 'divider' });
    }

    // Action buttons (FR-006) (T043: truncate button text)
    const actionButtons: ButtonElement[] = [];

    // "Join Call" button if meeting has a link
    if (meeting.meeting_link) {
      actionButtons.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: truncateButtonText('📹 Join Call'),
          emoji: true,
        },
        url: meeting.meeting_link,
        style: 'primary',
      });
    }

    // "Full Record" button if Attio record ID provided
    if (attioRecordId) {
      actionButtons.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: truncateButtonText('📋 Full Record'),
          emoji: true,
        },
        url: `${this.config.attioBaseUrl}/${attioRecordId}`,
      });
    }

    if (actionButtons.length > 0) {
      blocks.push({
        type: 'actions',
        elements: actionButtons,
      });
    }

    return blocks;
  }

  /**
   * Build fallback text for notifications.
   * T043: Truncate to ensure it fits in notification limits.
   */
  private buildFallbackText(meeting: ParsedMeeting, content: BriefContent): string {
    const attendeeName = meeting.primary_attendee.name || meeting.primary_attendee.email;
    const fullText = `Pre-Call Brief for ${meeting.title} with ${attendeeName}: ${content.quick_context}`;
    // Slack fallback text typically displays ~200 chars in notifications
    return truncateText(fullText, 250);
  }

  /**
   * Get emoji for sentiment.
   */
  private getSentimentEmoji(sentiment: string): string {
    switch (sentiment) {
      case 'positive':
        return '✅';
      case 'negative':
        return '⚠️';
      case 'neutral':
        return '➖';
      default:
        return '❓';
    }
  }

  /**
   * Categorize Slack error for retry logic.
   */
  private categorizeError(error: Error): DeliverBriefError['code'] {
    const message = error.message.toLowerCase();

    if (message.includes('channel_not_found') || message.includes('not_in_channel')) {
      return 'CHANNEL_NOT_FOUND';
    }

    if (message.includes('rate_limited') || message.includes('ratelimit')) {
      return 'RATE_LIMITED';
    }

    return 'DELIVERY_ERROR';
  }

  /**
   * Sleep helper for backoff delays.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Slack brief delivery instance.
 */
export function createSlackBriefDelivery(
  deps: SlackDeliveryDependencies,
  config?: Partial<SlackDeliveryConfig>
): SlackBriefDelivery {
  return new SlackBriefDelivery(deps, config);
}
