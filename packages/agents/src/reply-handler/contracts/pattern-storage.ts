/**
 * Reply Handler - Pattern Storage Contracts
 *
 * Defines schemas for Category C pattern storage in Qdrant KB.
 * Used for pattern learning and similar pattern retrieval.
 *
 * Implements:
 * - FR-013: Store reply with full context in KB (bucket_c_patterns)
 * - FR-016: Support adding labels/notes after handling
 * - FR-027: Semantic search for similar patterns
 * - FR-028: Objection handler templates
 *
 * @module reply-handler/contracts/pattern-storage
 */

import { z } from 'zod';

// ===========================================
// Pattern Outcome
// ===========================================

/**
 * Outcome tracking for manual reviews (FR-016)
 */
export const PatternOutcomeSchema = z.enum([
  'converted', // Lead eventually converted
  'not_converted', // Lead did not convert
  'referral', // Lead provided a referral
  'nurture', // Lead moved to nurture sequence
]);

export type PatternOutcome = z.infer<typeof PatternOutcomeSchema>;

// ===========================================
// Lead Context for Patterns
// ===========================================

/**
 * Lead context stored with pattern (FR-013)
 */
export const PatternLeadContextSchema = z.object({
  company: z.string().optional(),
  role: z.string().optional(),
  industry: z.string().optional(),
  company_size: z.number().int().positive().optional(),
  prior_engagement: z.array(z.string()),
});

export type PatternLeadContext = z.infer<typeof PatternLeadContextSchema>;

// ===========================================
// Category C Pattern
// ===========================================

/**
 * Category C pattern for KB storage (FR-013)
 *
 * Stored in Qdrant `bucket_c_patterns` collection.
 * All queries MUST include brain_id filter.
 */
export const BucketCPatternSchema = z.object({
  id: z.string().uuid(),
  brain_id: z.string(), // MANDATORY for brain-scoped queries

  // Reply data (FR-013)
  reply_text: z.string(),
  lead_id: z.string(),
  channel: z.enum(['email', 'linkedin']),
  timestamp: z.string().datetime(),

  // Conversation context (FR-013 richer context)
  conversation_history: z.array(z.string()),

  // Lead context (FR-013 richer context)
  lead_context: PatternLeadContextSchema,

  // After human handling (FR-016)
  label: z.string().optional(), // e.g., "pricing_question", "timing_objection"
  handling_notes: z.string().optional(),
  outcome: PatternOutcomeSchema.optional(),
  handled_at: z.string().datetime().optional(),
  handled_by: z.string().optional(),

  // Vector embedding (for similarity search)
  embedding: z.array(z.number()).optional(),

  // Metadata
  created_at: z.string().datetime(),
  similarity_score: z.number().min(0).max(1).optional(), // For search results
});

export type BucketCPattern = z.infer<typeof BucketCPatternSchema>;

// ===========================================
// Store Pattern Input
// ===========================================

/**
 * Input for storing a new Category C pattern
 */
export const StorePatternInputSchema = z.object({
  brain_id: z.string(), // MANDATORY
  reply_text: z.string().min(1),
  lead_id: z.string(),
  channel: z.enum(['email', 'linkedin']),
  timestamp: z.string().datetime(),
  conversation_history: z.array(z.string()).optional(),
  lead_context: PatternLeadContextSchema,
});

export type StorePatternInput = z.infer<typeof StorePatternInputSchema>;

/**
 * Response from storing a pattern
 */
export const StorePatternResponseSchema = z.object({
  pattern_id: z.string().uuid(),
  stored: z.boolean(),
  embedding_generated: z.boolean(),
});

export type StorePatternResponse = z.infer<typeof StorePatternResponseSchema>;

// ===========================================
// Search Patterns Input
// ===========================================

/**
 * Input for searching similar patterns (FR-027)
 */
export const SearchPatternsInputSchema = z.object({
  brain_id: z.string(), // MANDATORY for brain-scoped search
  query_text: z.string(),
  limit: z.number().int().min(1).max(20).default(5),
  filter_labeled: z.boolean().default(false), // Only return patterns with labels
  filter_outcome: PatternOutcomeSchema.optional(),
});

export type SearchPatternsInput = z.infer<typeof SearchPatternsInputSchema>;

/**
 * Response from searching patterns
 */
export const SearchPatternsResponseSchema = z.object({
  patterns: z.array(
    z.object({
      id: z.string().uuid(),
      reply_text: z.string(),
      similarity: z.number().min(0).max(1),
      channel: z.enum(['email', 'linkedin']),
      timestamp: z.string().datetime(),
      lead_context: PatternLeadContextSchema.optional(),
      label: z.string().optional(),
      handling_notes: z.string().optional(),
      outcome: PatternOutcomeSchema.optional(),
    })
  ),
  total_found: z.number().int().nonnegative(),
});

export type SearchPatternsResponse = z.infer<typeof SearchPatternsResponseSchema>;

// ===========================================
// Label Pattern Input
// ===========================================

/**
 * Input for labeling a pattern after handling (FR-016)
 */
export const LabelPatternInputSchema = z.object({
  pattern_id: z.string().uuid(),
  label: z.string(), // e.g., "pricing_question", "timing_objection"
  handling_notes: z.string().optional(),
  outcome: PatternOutcomeSchema,
  handled_by: z.string(),
});

export type LabelPatternInput = z.infer<typeof LabelPatternInputSchema>;

/**
 * Response from labeling a pattern
 */
export const LabelPatternResponseSchema = z.object({
  pattern_id: z.string().uuid(),
  labeled: z.boolean(),
  labeled_at: z.string().datetime(),
});

export type LabelPatternResponse = z.infer<typeof LabelPatternResponseSchema>;

// ===========================================
// Objection Handler
// ===========================================

/**
 * Objection handler template (FR-028)
 *
 * Generated from 20+ labeled patterns of same type.
 * Stored in Qdrant `objection_handlers` collection.
 */
export const ObjectionHandlerSchema = z.object({
  id: z.string().uuid(),
  brain_id: z.string(), // MANDATORY

  // Objection definition
  objection_type: z.string(), // e.g., "budget", "timing", "authority", "need"
  example_phrases: z.array(z.string()), // Trigger phrases

  // Response template
  suggested_response: z.string(),
  response_variations: z.array(z.string()).optional(),

  // Success tracking
  times_used: z.number().int().nonnegative(),
  times_successful: z.number().int().nonnegative(),
  success_rate: z.number().min(0).max(1),

  // Metadata
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),

  // Vector embedding
  embedding: z.array(z.number()).optional(),
});

export type ObjectionHandler = z.infer<typeof ObjectionHandlerSchema>;

// ===========================================
// Analyze Patterns Input
// ===========================================

/**
 * Input for analyzing patterns to create objection handler (FR-028)
 */
export const AnalyzePatternsInputSchema = z.object({
  brain_id: z.string(),
  label: z.string(), // Objection type label to analyze
  min_patterns: z.number().int().min(1).default(20), // Minimum labeled patterns required
});

export type AnalyzePatternsInput = z.infer<typeof AnalyzePatternsInputSchema>;

/**
 * Response from analyzing patterns
 */
export const AnalyzePatternsResponseSchema = z.object({
  label: z.string(),
  pattern_count: z.number().int(),
  can_generate_template: z.boolean(),
  suggested_template: z
    .object({
      objection_type: z.string(),
      example_phrases: z.array(z.string()),
      suggested_response: z.string(),
      success_rate: z.number().min(0).max(1),
    })
    .optional(),
});

export type AnalyzePatternsResponse = z.infer<typeof AnalyzePatternsResponseSchema>;

// ===========================================
// Helper Functions
// ===========================================

/**
 * Create input for storing a new pattern
 */
export function createStorePatternInput(params: {
  brainId: string;
  replyText: string;
  leadId: string;
  channel: 'email' | 'linkedin';
  conversationHistory?: string[];
  leadContext: {
    company?: string;
    role?: string;
    industry?: string;
    companySize?: number;
    priorEngagement?: string[];
  };
}): StorePatternInput {
  return {
    brain_id: params.brainId,
    reply_text: params.replyText,
    lead_id: params.leadId,
    channel: params.channel,
    timestamp: new Date().toISOString(),
    conversation_history: params.conversationHistory ?? [],
    lead_context: {
      company: params.leadContext.company,
      role: params.leadContext.role,
      industry: params.leadContext.industry,
      company_size: params.leadContext.companySize,
      prior_engagement: params.leadContext.priorEngagement ?? [],
    },
  };
}

/**
 * Create input for searching similar patterns
 */
export function createSearchPatternsInput(
  brainId: string,
  queryText: string,
  options?: {
    limit?: number;
    filterLabeled?: boolean;
    filterOutcome?: PatternOutcome;
  }
): SearchPatternsInput {
  return {
    brain_id: brainId,
    query_text: queryText,
    limit: options?.limit ?? 5,
    filter_labeled: options?.filterLabeled ?? false,
    filter_outcome: options?.filterOutcome,
  };
}

/**
 * Common objection labels
 */
export const COMMON_OBJECTION_LABELS = [
  'pricing_question',
  'timing_objection',
  'budget_concern',
  'authority_question',
  'need_more_info',
  'competitor_mention',
  'wrong_person_referral',
  'feature_inquiry',
  'demo_request',
  'follow_up_later',
] as const;

export type CommonObjectionLabel = (typeof COMMON_OBJECTION_LABELS)[number];
