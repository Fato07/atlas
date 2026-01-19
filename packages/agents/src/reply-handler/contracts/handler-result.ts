/**
 * Reply Handler Agent - Result Contract
 *
 * Defines the output schema for reply processing results.
 * This contract is returned by the agent and consumed by n8n workflows.
 *
 * @module reply-handler/contracts/handler-result
 */

import { z } from 'zod';

// ===========================================
// Intent Types
// ===========================================

/**
 * Possible reply intents
 */
export const IntentSchema = z.enum([
  'positive_interest',  // Wants to learn more, schedule call, see demo
  'question',           // Asking about pricing, features, timeline
  'objection',          // Budget, timing, competitor, authority concerns
  'referral',           // Wrong person, suggesting someone else
  'unsubscribe',        // Wants to opt out
  'not_interested',     // Polite decline
  'out_of_office',      // Auto-reply, vacation
  'bounce',             // Delivery failure
  'unclear',            // Cannot determine
]);

export type Intent = z.infer<typeof IntentSchema>;

/**
 * Complexity levels
 */
export const ComplexitySchema = z.enum(['simple', 'medium', 'complex']);
export type Complexity = z.infer<typeof ComplexitySchema>;

/**
 * Urgency levels
 */
export const UrgencySchema = z.enum(['low', 'medium', 'high']);
export type Urgency = z.infer<typeof UrgencySchema>;

// ===========================================
// Classification Schema
// ===========================================

/**
 * Reply classification result
 */
export const ClassificationSchema = z.object({
  // Intent classification
  intent: IntentSchema,
  intent_confidence: z.number().min(0).max(1),
  intent_reasoning: z.string(),

  // Sentiment analysis
  sentiment: z.number().min(-1).max(1),

  // Complexity assessment
  complexity: ComplexitySchema,

  // Urgency (derived)
  urgency: UrgencySchema,

  // Reply type for KB matching
  reply_type: z.string(),

  // Metadata
  classified_at: z.string().datetime(),
  model_version: z.string(),
  tokens_used: z.number().int().nonnegative(),
});

export type Classification = z.infer<typeof ClassificationSchema>;

// ===========================================
// KB Match Schema
// ===========================================

/**
 * Knowledge base match result
 */
export const KBMatchSchema = z.object({
  type: z.enum(['template', 'handler']),
  id: z.string(),
  confidence: z.number().min(0).max(1),
  content: z.string(),
  strategy: z.string().optional(), // For objection handlers
  personalization_instructions: z.string().optional(),
});

export type KBMatch = z.infer<typeof KBMatchSchema>;

// ===========================================
// Tier Routing Schema
// ===========================================

/**
 * Routing factor in tier decision
 */
export const RoutingFactorSchema = z.object({
  factor: z.string(),
  value: z.union([z.string(), z.number()]),
  weight: z.number(),
  direction: z.enum(['tier_1', 'tier_2', 'tier_3', 'neutral']),
});

export type RoutingFactor = z.infer<typeof RoutingFactorSchema>;

/**
 * Tier routing decision
 */
export const TierRoutingSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  reason: z.string(),
  factors: z.array(RoutingFactorSchema),
  override_applied: z.boolean().default(false),
  override_reason: z.string().optional(),
  routed_at: z.string().datetime(),
});

export type TierRouting = z.infer<typeof TierRoutingSchema>;

// ===========================================
// Action Result Schema
// ===========================================

/**
 * Action type
 */
export const ActionTypeSchema = z.enum([
  'auto_responded',
  'draft_created',
  'escalated',
  'failed',
]);

export type ActionType = z.infer<typeof ActionTypeSchema>;

/**
 * Action taken result
 */
export const ActionResultSchema = z.object({
  type: ActionTypeSchema,
  response_text: z.string().optional(),
  slack_message_ts: z.string().optional(),
  slack_channel: z.string().optional(),
  error: z.string().optional(),
});

export type ActionResult = z.infer<typeof ActionResultSchema>;

// ===========================================
// CRM Updates Schema
// ===========================================

/**
 * CRM update results
 */
export const CRMUpdatesSchema = z.object({
  // Airtable updates
  airtable_status: z.string().optional(),
  airtable_updated: z.boolean().default(false),

  // Attio updates
  attio_created: z.boolean().default(false),
  attio_record_id: z.string().optional(),
  attio_activity_id: z.string().optional(),
  pipeline_stage: z.string().optional(),
});

export type CRMUpdates = z.infer<typeof CRMUpdatesSchema>;

// ===========================================
// Extracted Insight Schema
// ===========================================

/**
 * Insight categories
 */
export const InsightCategorySchema = z.enum([
  'buying_process',         // Who decides, timeline, budget process
  'pain_point',             // Specific problems mentioned
  'objection',              // New ways of saying no
  'competitive_intel',      // Tools they use or evaluate
  'messaging_effectiveness', // What resonated in outreach
]);

export type InsightCategory = z.infer<typeof InsightCategorySchema>;

/**
 * Extracted insight from reply
 */
export const ExtractedInsightSchema = z.object({
  category: InsightCategorySchema,
  content: z.string(),
  importance: z.enum(['low', 'medium', 'high']),
  actionable: z.boolean(),
  action_suggestion: z.string().optional(),
  source: z.object({
    type: z.literal('email_reply'),
    reply_id: z.string(),
    lead_id: z.string(),
    company: z.string().optional(),
  }),
});

export type ExtractedInsight = z.infer<typeof ExtractedInsightSchema>;

// ===========================================
// Reply Handler Result Schema
// ===========================================

/**
 * Complete result of processing a reply
 */
export const ReplyHandlerResultSchema = z.object({
  // Identity
  id: z.string(),
  reply_id: z.string(),

  // Classification
  classification: ClassificationSchema,

  // Routing
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  routing: TierRoutingSchema,

  // KB Match (optional - may not find match)
  kb_match: KBMatchSchema.optional(),

  // Action taken
  action: ActionResultSchema,

  // CRM updates
  crm_updates: CRMUpdatesSchema,

  // Insights extracted
  insights_extracted: z.array(ExtractedInsightSchema),

  // Audit trail
  processing_time_ms: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  agent_version: z.string(),
});

export type ReplyHandlerResult = z.infer<typeof ReplyHandlerResultSchema>;

// ===========================================
// Helper Functions
// ===========================================

/**
 * Create a successful auto-response result
 */
export function createAutoRespondResult(params: {
  replyId: string;
  classification: Classification;
  kbMatch?: KBMatch;
  responseText: string;
  crmUpdates: CRMUpdates;
  insights: ExtractedInsight[];
  processingTimeMs: number;
}): ReplyHandlerResult {
  const now = new Date().toISOString();

  return {
    id: `result_${params.replyId}_${Date.now()}`,
    reply_id: params.replyId,
    classification: params.classification,
    tier: 1,
    routing: {
      tier: 1,
      reason: 'High-confidence match for auto-response',
      factors: [
        {
          factor: 'intent',
          value: params.classification.intent,
          weight: 0.4,
          direction: 'tier_1',
        },
        {
          factor: 'confidence',
          value: params.kbMatch?.confidence ?? 0,
          weight: 0.3,
          direction: params.kbMatch && params.kbMatch.confidence > 0.85 ? 'tier_1' : 'tier_2',
        },
      ],
      override_applied: false,
      routed_at: now,
    },
    kb_match: params.kbMatch,
    action: {
      type: 'auto_responded',
      response_text: params.responseText,
    },
    crm_updates: params.crmUpdates,
    insights_extracted: params.insights,
    processing_time_ms: params.processingTimeMs,
    timestamp: now,
    agent_version: '1.0.0',
  };
}

/**
 * Create a draft-for-approval result (Tier 2)
 */
export function createDraftResult(params: {
  replyId: string;
  classification: Classification;
  kbMatch?: KBMatch;
  draftText: string;
  slackMessageTs: string;
  slackChannel: string;
  processingTimeMs: number;
}): ReplyHandlerResult {
  const now = new Date().toISOString();

  return {
    id: `result_${params.replyId}_${Date.now()}`,
    reply_id: params.replyId,
    classification: params.classification,
    tier: 2,
    routing: {
      tier: 2,
      reason: 'KB match requires approval',
      factors: [
        {
          factor: 'confidence',
          value: params.kbMatch?.confidence ?? 0,
          weight: 0.4,
          direction: 'tier_2',
        },
      ],
      override_applied: false,
      routed_at: now,
    },
    kb_match: params.kbMatch,
    action: {
      type: 'draft_created',
      response_text: params.draftText,
      slack_message_ts: params.slackMessageTs,
      slack_channel: params.slackChannel,
    },
    crm_updates: {
      airtable_updated: false,
      attio_created: false,
    },
    insights_extracted: [],
    processing_time_ms: params.processingTimeMs,
    timestamp: now,
    agent_version: '1.0.0',
  };
}

/**
 * Create an escalation result (Tier 3)
 */
export function createEscalationResult(params: {
  replyId: string;
  classification: Classification;
  routingReason: string;
  slackMessageTs?: string;
  slackChannel?: string;
  processingTimeMs: number;
}): ReplyHandlerResult {
  const now = new Date().toISOString();

  return {
    id: `result_${params.replyId}_${Date.now()}`,
    reply_id: params.replyId,
    classification: params.classification,
    tier: 3,
    routing: {
      tier: 3,
      reason: params.routingReason,
      factors: [],
      override_applied: true,
      override_reason: params.routingReason,
      routed_at: now,
    },
    action: {
      type: 'escalated',
      slack_message_ts: params.slackMessageTs,
      slack_channel: params.slackChannel,
    },
    crm_updates: {
      airtable_updated: true,
      airtable_status: 'Needs Attention',
      attio_created: false,
    },
    insights_extracted: [],
    processing_time_ms: params.processingTimeMs,
    timestamp: now,
    agent_version: '1.0.0',
  };
}

/**
 * Create an error result for failed processing
 */
export function createErrorResult(params: {
  replyId: string;
  error: string;
  processingTimeMs: number;
}): ReplyHandlerResult {
  const now = new Date().toISOString();

  return {
    id: `result_${params.replyId}_${Date.now()}`,
    reply_id: params.replyId,
    classification: {
      intent: 'unclear',
      intent_confidence: 0,
      intent_reasoning: `Processing failed: ${params.error}`,
      sentiment: 0,
      complexity: 'complex',
      urgency: 'high',
      reply_type: 'error',
      classified_at: now,
      model_version: 'error',
      tokens_used: 0,
    },
    tier: 3,
    routing: {
      tier: 3,
      reason: `Processing error: ${params.error}`,
      factors: [],
      override_applied: true,
      override_reason: params.error,
      routed_at: now,
    },
    action: {
      type: 'failed',
      error: params.error,
    },
    crm_updates: {
      airtable_updated: false,
      attio_created: false,
    },
    insights_extracted: [],
    processing_time_ms: params.processingTimeMs,
    timestamp: now,
    agent_version: '1.0.0',
  };
}

/**
 * Validate result and return typed result
 */
export function parseReplyHandlerResult(data: unknown): ReplyHandlerResult {
  return ReplyHandlerResultSchema.parse(data);
}
