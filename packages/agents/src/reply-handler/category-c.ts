/**
 * Reply Handler - Category C (Manual Review) Workflow
 *
 * Handles ambiguous replies that require human judgment.
 * Implements: FR-013, FR-014, FR-015, FR-016
 *
 * Actions:
 * 1. Update Airtable status to "pending_review" (FR-015)
 * 2. Store pattern in KB for learning (FR-013)
 * 3. Search for similar patterns (FR-027)
 * 4. Notify sales team via Slack with similar patterns (FR-014)
 * 5. Support post-handling labeling (FR-016)
 *
 * @module reply-handler/category-c
 */

import type { McpToolFunction } from './mcp-bridge';
import type { ReplyHandlerLogger } from './logger';
import {
  type CategoryCInput,
  type CategoryCOutput,
  type SimilarPattern,
  type Notification,
  type LeadReference,
  type ReplyReference,
  createAirtableUpdateInput,
  createStorePatternInput,
  createSearchPatternsInput,
} from './contracts';

// ===========================================
// Configuration
// ===========================================

export interface CategoryCConfig {
  /** MCP client function for tool calls */
  callMcpTool: McpToolFunction;

  /** Logger instance */
  logger: ReplyHandlerLogger;

  /** Slack channel for notifications */
  slackChannel: string;

  /** Number of similar patterns to fetch */
  similarPatternLimit?: number;

  /** Minimum similarity score for patterns */
  minSimilarityScore?: number;
}

const DEFAULT_SIMILAR_PATTERN_LIMIT = 5;
const DEFAULT_MIN_SIMILARITY_SCORE = 0.7;

// ===========================================
// Category C Workflow
// ===========================================

/**
 * Execute Category C (Manual Review) workflow.
 *
 * This workflow handles ambiguous replies that need human judgment.
 * It stores the pattern for learning, finds similar historical patterns,
 * and notifies the sales team with context for decision-making.
 *
 * @example
 * ```typescript
 * const result = await executeCategoryCWorkflow(input, config);
 * console.log(`Pattern stored: ${result.pattern_id}`);
 * console.log(`Similar patterns found: ${result.similar_patterns_count}`);
 * ```
 */
export async function executeCategoryCWorkflow(
  input: CategoryCInput,
  config: CategoryCConfig
): Promise<CategoryCOutput> {
  const { reply, lead, brain_id, classification, conversation_history } = input;
  const { callMcpTool, logger, slackChannel } = config;

  const errors: string[] = [];
  const notifications: Notification[] = [];

  logger.info('Starting Category C workflow', {
    reply_id: reply.id,
    lead_id: lead.id,
    brain_id,
    confidence: classification.confidence,
  });

  // ===========================================
  // Step 1: Update Airtable status (FR-015)
  // ===========================================
  let airtableUpdated = false;
  try {
    const airtableInput = createAirtableUpdateInput(lead.id, 'C');
    await callMcpTool('airtable_update_lead', {
      lead_id: airtableInput.lead_id,
      status: airtableInput.status,
      classification: airtableInput.classification,
      last_reply_at: airtableInput.last_reply_at,
    });
    airtableUpdated = true;
    logger.info('Airtable lead status updated to pending_review', {
      reply_id: reply.id,
      lead_id: lead.id,
    });
  } catch (error) {
    const errorMsg = `Airtable update failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMsg);
    logger.error('Airtable update failed', error as Error, {
      reply_id: reply.id,
      lead_id: lead.id,
    });
  }

  // ===========================================
  // Step 2: Store pattern in KB (FR-013)
  // ===========================================
  let patternId: string = crypto.randomUUID();
  let patternStored = false;

  try {
    // Build conversation history strings
    const conversationStrings =
      conversation_history?.map(
        (msg) => `[${msg.role}] ${msg.content.slice(0, 500)}${msg.content.length > 500 ? '...' : ''}`
      ) ?? [];

    const patternInput = createStorePatternInput({
      brainId: brain_id,
      replyText: reply.reply_text,
      leadId: lead.id,
      channel: reply.channel,
      conversationHistory: conversationStrings,
      leadContext: {
        company: lead.company,
        role: lead.title,
        priorEngagement: conversationStrings.length > 0 ? ['has_conversation_history'] : [],
      },
    });

    const storeResult = await callMcpTool<{
      pattern_id: string;
      stored: boolean;
      embedding_generated: boolean;
    }>('qdrant_upsert_point', {
      collection: 'bucket_c_patterns',
      id: patternId,
      payload: {
        brain_id: patternInput.brain_id,
        reply_text: patternInput.reply_text,
        lead_id: patternInput.lead_id,
        channel: patternInput.channel,
        timestamp: patternInput.timestamp,
        conversation_history: patternInput.conversation_history,
        lead_context: patternInput.lead_context,
        created_at: new Date().toISOString(),
      },
      // Text to embed for similarity search
      text_to_embed: reply.reply_text,
    });

    patternId = storeResult.pattern_id || patternId;
    patternStored = storeResult.stored;

    logger.info('Pattern stored in KB', {
      reply_id: reply.id,
      lead_id: lead.id,
      pattern_id: patternId,
      embedding_generated: storeResult.embedding_generated,
    });
  } catch (error) {
    const errorMsg = `Pattern storage failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMsg);
    logger.error('Pattern storage failed', error as Error, {
      reply_id: reply.id,
      lead_id: lead.id,
      pattern_id: patternId,
    });
  }

  // ===========================================
  // Step 3: Search for similar patterns (FR-027)
  // ===========================================
  let similarPatterns: SimilarPattern[] = [];
  let similarPatternsCount = 0;

  try {
    const searchInput = createSearchPatternsInput(brain_id, reply.reply_text, {
      limit: config.similarPatternLimit ?? DEFAULT_SIMILAR_PATTERN_LIMIT,
      filterLabeled: false, // Include all patterns, not just labeled ones
    });

    const searchResult = await callMcpTool<{
      patterns: Array<{
        id: string;
        reply_text: string;
        similarity: number;
        channel: 'email' | 'linkedin';
        timestamp: string;
        label?: string;
        handling_notes?: string;
        outcome?: 'converted' | 'not_converted' | 'referral' | 'nurture';
      }>;
      total_found: number;
    }>('qdrant_search_similar', {
      collection: 'bucket_c_patterns',
      query_text: searchInput.query_text,
      filter: {
        brain_id: searchInput.brain_id,
      },
      limit: searchInput.limit,
      min_score: config.minSimilarityScore ?? DEFAULT_MIN_SIMILARITY_SCORE,
    });

    // Filter out the current pattern from results (it may have been just stored)
    similarPatterns = searchResult.patterns
      .filter((p) => p.id !== patternId)
      .map((p) => ({
        id: p.id,
        similarity: p.similarity,
        reply_text: p.reply_text,
        label: p.label,
        handling_notes: p.handling_notes,
        outcome: p.outcome,
      }));

    similarPatternsCount = similarPatterns.length;

    logger.info('Similar patterns found', {
      reply_id: reply.id,
      lead_id: lead.id,
      pattern_count: similarPatternsCount,
      total_in_kb: searchResult.total_found,
    });
  } catch (error) {
    logger.warn('Similar pattern search failed', {
      reply_id: reply.id,
      lead_id: lead.id,
      error: error instanceof Error ? error.message : String(error),
    });
    // Non-blocking - continue with empty similar patterns
  }

  // ===========================================
  // Step 4: Notify sales team via Slack (FR-014)
  // ===========================================
  let notificationSent = false;

  try {
    const slackMessage = buildSlackNotification({
      lead,
      reply,
      classification,
      patternId,
      similarPatterns,
    });

    const slackResult = await callMcpTool<{ ok: boolean; ts: string }>('slack_post_message', {
      channel: slackChannel,
      text: slackMessage.text,
      blocks: slackMessage.blocks,
    });

    notifications.push({
      channel: 'slack',
      message_id: slackResult.ts,
      sent_at: new Date().toISOString(),
    });

    notificationSent = true;

    logger.info('Slack notification sent', {
      reply_id: reply.id,
      lead_id: lead.id,
      pattern_id: patternId,
      message_ts: slackResult.ts,
    });
  } catch (error) {
    const errorMsg = `Slack notification failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMsg);
    logger.error('Slack notification failed', error as Error, {
      reply_id: reply.id,
      lead_id: lead.id,
    });
  }

  // ===========================================
  // Build Result
  // ===========================================
  const success = airtableUpdated && patternStored && notificationSent;

  logger.info('Category C workflow completed', {
    reply_id: reply.id,
    lead_id: lead.id,
    success,
    pattern_stored: patternStored,
    similar_patterns_count: similarPatternsCount,
    notification_sent: notificationSent,
    error_count: errors.length,
  });

  return {
    success,
    pattern_id: patternId,
    pattern_stored: patternStored,
    similar_patterns: similarPatterns.length > 0 ? similarPatterns : undefined,
    similar_patterns_count: similarPatternsCount,
    notification_sent: notificationSent,
    notifications: notifications.length > 0 ? notifications : undefined,
    lead_status_updated: airtableUpdated,
    new_status: 'pending_review',
    airtable_updated: airtableUpdated,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ===========================================
// Slack Notification Builder
// ===========================================

/**
 * Build Slack notification for Category C with similar patterns
 */
function buildSlackNotification(params: {
  lead: LeadReference;
  reply: ReplyReference;
  classification: CategoryCInput['classification'];
  patternId: string;
  similarPatterns: SimilarPattern[];
}): { text: string; blocks: unknown[] } {
  const { lead, reply, classification, patternId, similarPatterns } = params;
  const leadName = lead.name || 'Unknown';
  const leadCompany = lead.company || 'Unknown Company';

  const text = `🤔 Manual review needed: ${leadName} from ${leadCompany}`;

  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🤔 Category C: Manual Review Required',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Lead:*\n${leadName}`,
        },
        {
          type: 'mrkdwn',
          text: `*Company:*\n${leadCompany}`,
        },
        {
          type: 'mrkdwn',
          text: `*Title:*\n${lead.title || 'N/A'}`,
        },
        {
          type: 'mrkdwn',
          text: `*Channel:*\n${reply.channel === 'email' ? '📧 Email' : '💼 LinkedIn'}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reply:*\n>${reply.reply_text.slice(0, 300)}${reply.reply_text.length > 300 ? '...' : ''}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Why Manual Review:*\n${classification.reasoning}\n\n*Confidence:* ${Math.round(classification.confidence * 100)}%`,
      },
    },
    {
      type: 'divider',
    },
  ];

  // Add similar patterns section if available
  if (similarPatterns.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📚 Similar Historical Patterns (${similarPatterns.length}):*`,
      },
    });

    // Add up to 3 similar patterns
    for (const pattern of similarPatterns.slice(0, 3)) {
      const outcomeEmoji = getOutcomeEmoji(pattern.outcome);
      const similarityPct = Math.round(pattern.similarity * 100);

      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: [
              `*${similarityPct}% similar* ${outcomeEmoji}`,
              pattern.label ? `Label: \`${pattern.label}\`` : '',
              pattern.handling_notes ? `Notes: ${pattern.handling_notes.slice(0, 100)}` : '',
              `"${pattern.reply_text?.slice(0, 100)}..."`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      });
    }

    if (similarPatterns.length > 3) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_...and ${similarPatterns.length - 3} more similar patterns_`,
          },
        ],
      });
    }

    blocks.push({
      type: 'divider',
    });
  } else {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '_No similar historical patterns found. This may be a new type of response._',
        },
      ],
    });

    blocks.push({
      type: 'divider',
    });
  }

  // Action buttons
  blocks.push({
    type: 'actions',
    block_id: `category_c_actions_${patternId}`,
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '✅ Mark Interested',
          emoji: true,
        },
        style: 'primary',
        value: JSON.stringify({ pattern_id: patternId, lead_id: lead.id, action: 'interested' }),
        action_id: 'category_c_interested',
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '❌ Mark Not Interested',
          emoji: true,
        },
        style: 'danger',
        value: JSON.stringify({
          pattern_id: patternId,
          lead_id: lead.id,
          action: 'not_interested',
        }),
        action_id: 'category_c_not_interested',
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🏷️ Add Label',
          emoji: true,
        },
        value: JSON.stringify({ pattern_id: patternId, lead_id: lead.id, action: 'label' }),
        action_id: 'category_c_label',
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '💬 Reply Manually',
          emoji: true,
        },
        value: JSON.stringify({ pattern_id: patternId, lead_id: lead.id, action: 'reply' }),
        action_id: 'category_c_reply',
      },
    ],
  });

  // Footer with pattern ID
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Pattern ID: \`${patternId}\` | Lead ID: \`${lead.id}\``,
      },
    ],
  });

  return { text, blocks };
}

/**
 * Get emoji for pattern outcome
 */
function getOutcomeEmoji(outcome?: string): string {
  switch (outcome) {
    case 'converted':
      return '✅';
    case 'not_converted':
      return '❌';
    case 'referral':
      return '🔄';
    case 'nurture':
      return '🌱';
    default:
      return '❓';
  }
}

// ===========================================
// Pattern Labeling (FR-016)
// ===========================================

/**
 * Label a Category C pattern after human handling.
 *
 * Called via webhook when a human marks the pattern with a label,
 * handling notes, and outcome.
 *
 * @example
 * ```typescript
 * await labelPattern({
 *   patternId: 'uuid-...',
 *   label: 'pricing_question',
 *   handlingNotes: 'Lead wanted pricing info, sent pricing PDF',
 *   outcome: 'converted',
 *   handledBy: 'user@company.com',
 * }, config);
 * ```
 */
export async function labelPattern(
  params: {
    patternId: string;
    label: string;
    handlingNotes?: string;
    outcome: 'converted' | 'not_converted' | 'referral' | 'nurture';
    handledBy: string;
  },
  config: Pick<CategoryCConfig, 'callMcpTool' | 'logger'>
): Promise<{
  success: boolean;
  labeled_at: string;
}> {
  const { patternId, label, handlingNotes, outcome, handledBy } = params;
  const { callMcpTool, logger } = config;

  const labeledAt = new Date().toISOString();

  try {
    await callMcpTool('qdrant_update_payload', {
      collection: 'bucket_c_patterns',
      id: patternId,
      payload: {
        label,
        handling_notes: handlingNotes,
        outcome,
        handled_at: labeledAt,
        handled_by: handledBy,
      },
    });

    logger.info('Pattern labeled', {
      pattern_id: patternId,
      label,
      outcome,
      handled_by: handledBy,
    });

    return {
      success: true,
      labeled_at: labeledAt,
    };
  } catch (error) {
    logger.error('Pattern labeling failed', error as Error, {
      pattern_id: patternId,
      label,
    });

    throw error;
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Category C workflow executor with configuration
 */
export function createCategoryCExecutor(config: CategoryCConfig) {
  return (input: CategoryCInput) => executeCategoryCWorkflow(input, config);
}
