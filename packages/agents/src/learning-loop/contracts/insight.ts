/**
 * Insight Schema
 *
 * Defines schemas for extracted insights, stored insights,
 * and insight lifecycle states.
 *
 * Implements: FR-001 through FR-010, FR-016 through FR-021
 *
 * @module learning-loop/contracts/insight
 */

import { z } from 'zod';

// ===========================================
// Insight Categories (FR-003)
// ===========================================

export const InsightCategorySchema = z.enum([
  'buying_process',
  'pain_point',
  'objection',
  'competitive_intel',
  'messaging_effectiveness',
  'icp_signal',
]);

export type InsightCategory = z.infer<typeof InsightCategorySchema>;

// ===========================================
// Importance Levels (FR-008)
// ===========================================

export const InsightImportanceSchema = z.enum(['low', 'medium', 'high']);

export type InsightImportance = z.infer<typeof InsightImportanceSchema>;

// ===========================================
// Source Types (FR-001, FR-002)
// ===========================================

export const InsightSourceTypeSchema = z.enum(['email_reply', 'call_transcript']);

export type InsightSourceType = z.infer<typeof InsightSourceTypeSchema>;

// ===========================================
// Insight Source (FR-018)
// ===========================================

export const InsightSourceSchema = z.object({
  type: InsightSourceTypeSchema.describe('Source type: email reply or call transcript'),
  source_id: z.string().min(1).describe('ID of the source document'),
  lead_id: z.string().min(1).describe('Lead ID from Attio/Airtable'),
  company_id: z.string().nullable().describe('Company ID if available'),
  company_name: z.string().nullable().describe('Company name for display'),
  conversation_context: z.string().max(2000).describe('Context around the extraction'),
  extracted_quote: z.string().max(500).nullable().describe('Direct quote from source (FR-004)'),
});

export type InsightSource = z.infer<typeof InsightSourceSchema>;

// ===========================================
// Quality Gate Results (FR-006, FR-007, FR-008)
// ===========================================

export const ConfidenceGateResultSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
});

export const DuplicateGateResultSchema = z.object({
  passed: z.boolean(),
  is_duplicate: z.boolean(),
  similar_insight_id: z.string().nullable(),
  similarity_score: z.number().min(0).max(1).nullable(),
});

export const ImportanceGateResultSchema = z.object({
  importance: InsightImportanceSchema,
  requires_validation: z.boolean(),
  reason: z.string(),
});

export const QualityGateResultsSchema = z.object({
  confidence_gate: ConfidenceGateResultSchema.describe('FR-006: Confidence score check'),
  duplicate_gate: DuplicateGateResultSchema.describe('FR-007: Semantic duplicate detection'),
  importance_gate: ImportanceGateResultSchema.describe('FR-008: Importance classification'),
});

export type ConfidenceGateResult = z.infer<typeof ConfidenceGateResultSchema>;
export type DuplicateGateResult = z.infer<typeof DuplicateGateResultSchema>;
export type ImportanceGateResult = z.infer<typeof ImportanceGateResultSchema>;
export type QualityGateResults = z.infer<typeof QualityGateResultsSchema>;

// ===========================================
// Extracted Insight (before KB storage)
// ===========================================

export const ExtractedInsightSchema = z.object({
  id: z.string().min(1).describe('Unique extraction ID'),
  brain_id: z.string().min(1).describe('Brain context'),
  category: InsightCategorySchema,
  content: z.string().min(10).max(2000).describe('Insight content'),
  extracted_quote: z.string().max(500).nullable().describe('Direct quote (FR-004)'),
  importance: InsightImportanceSchema,
  actionable: z.boolean(),
  action_suggestion: z.string().max(500).nullable(),
  source: InsightSourceSchema,
  initial_confidence: z.number().min(0).max(1).describe('Confidence from extraction (FR-005)'),
  final_confidence: z.number().min(0).max(1).nullable().describe('Confidence after gates (FR-006)'),
  quality_gates: QualityGateResultsSchema.nullable(),
  extracted_at: z.string().datetime({ offset: true }),
});

export type ExtractedInsight = z.infer<typeof ExtractedInsightSchema>;

// ===========================================
// Insight Validation Status
// ===========================================

export const InsightValidationStatusSchema = z.enum([
  'validated',
  'auto_approved',
]);

export const InsightValidationSchema = z.object({
  status: InsightValidationStatusSchema,
  validated_by: z.string().nullable().describe('Slack user ID (null for auto_approved)'),
  validation_date: z.string().datetime({ offset: true }),
  validation_note: z.string().max(500).nullable().describe('FR-014: Validation notes'),
});

export type InsightValidationStatus = z.infer<typeof InsightValidationStatusSchema>;
export type InsightValidation = z.infer<typeof InsightValidationSchema>;

// ===========================================
// Application Stats (for tracking usefulness)
// ===========================================

export const ApplicationStatsSchema = z.object({
  times_applied: z.number().int().min(0),
  positive_outcomes: z.number().int().min(0),
  was_useful: z.boolean().nullable(),
  last_applied_at: z.string().datetime({ offset: true }).nullable(),
});

export type ApplicationStats = z.infer<typeof ApplicationStatsSchema>;

// ===========================================
// Stored Insight Payload (Qdrant)
// ===========================================

export const StoredInsightPayloadSchema = z.object({
  brain_id: z.string().min(1),
  vertical: z.string().min(1),
  sub_vertical: z.string().nullable(),
  content: z.string().min(10).max(2000),
  category: InsightCategorySchema,
  importance: InsightImportanceSchema,
  actionable: z.boolean(),
  action_suggestion: z.string().nullable(),
  source: InsightSourceSchema,
  quality_score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  validation: InsightValidationSchema,
  application_stats: ApplicationStatsSchema,
  similar_insights: z.array(z.string()).describe('IDs of similar insights'),
  supersedes: z.string().nullable().describe('FR-020: ID of superseded insight'),
  archived: z.boolean().describe('FR-021: Archived status'),
  archived_at: z.string().datetime({ offset: true }).nullable(),
  extracted_at: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export type StoredInsightPayload = z.infer<typeof StoredInsightPayloadSchema>;

// ===========================================
// Insight Creation Helper
// ===========================================

export function createExtractedInsight(params: {
  brainId: string;
  category: InsightCategory;
  content: string;
  extractedQuote: string | null;
  importance: InsightImportance;
  actionable: boolean;
  actionSuggestion: string | null;
  source: InsightSource;
  initialConfidence: number;
}): ExtractedInsight {
  const now = new Date().toISOString();

  return {
    id: `insight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    brain_id: params.brainId,
    category: params.category,
    content: params.content,
    extracted_quote: params.extractedQuote,
    importance: params.importance,
    actionable: params.actionable,
    action_suggestion: params.actionSuggestion,
    source: params.source,
    initial_confidence: params.initialConfidence,
    final_confidence: null,
    quality_gates: null,
    extracted_at: now,
  };
}

// ===========================================
// Insight Storage Preparation
// ===========================================

export function prepareInsightForStorage(
  insight: ExtractedInsight,
  validation: InsightValidation,
  vertical: string
): Omit<StoredInsightPayload, 'created_at' | 'updated_at'> {
  return {
    brain_id: insight.brain_id,
    vertical,
    sub_vertical: null,
    content: insight.content,
    category: insight.category,
    importance: insight.importance,
    actionable: insight.actionable,
    action_suggestion: insight.action_suggestion,
    source: insight.source,
    quality_score: insight.final_confidence ?? insight.initial_confidence,
    confidence: insight.final_confidence ?? insight.initial_confidence,
    validation,
    application_stats: {
      times_applied: 0,
      positive_outcomes: 0,
      was_useful: null,
      last_applied_at: null,
    },
    similar_insights: [],
    supersedes: null,
    archived: false,
    archived_at: null,
    extracted_at: insight.extracted_at,
  };
}
