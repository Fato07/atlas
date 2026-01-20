/**
 * Meeting Analysis Contract
 *
 * Defines the schema for post-meeting analysis including BANT qualification,
 * objection extraction, action items, and CRM update payloads.
 *
 * @module meeting-prep/contracts/meeting-analysis
 */

import { z } from 'zod';
import type { BrainId } from '@atlas-gtm/lib'; // Used for function signatures

// ===========================================
// BANT Qualification Schemas (FR-008)
// ===========================================

export const BANTStatusSchema = z.enum([
  'confirmed',   // Clear evidence of this dimension
  'partial',     // Some signals but not definitive
  'unknown',     // No relevant information gathered
  'negative',    // Clear negative signal (e.g., no budget)
]);

export type BANTStatus = z.infer<typeof BANTStatusSchema>;

export const BANTDimensionSchema = z.object({
  status: BANTStatusSchema,
  confidence: z.number().min(0).max(1).describe('Confidence score 0.0-1.0'),
  evidence: z.string().describe('Supporting quote or summary from transcript'),
  next_step: z.string().nullable().describe('Action to confirm if partial/unknown'),
});

export type BANTDimension = z.infer<typeof BANTDimensionSchema>;

export const BudgetDimensionSchema = BANTDimensionSchema.extend({
  amount: z.string().nullable().describe('Budget amount if mentioned'),
});

export const AuthorityDimensionSchema = BANTDimensionSchema.extend({
  decision_maker: z.boolean().describe('Is this person the final decision maker?'),
  stakeholders: z.array(z.string()).max(5).describe('Other people involved in decision'),
});

export const NeedDimensionSchema = BANTDimensionSchema.extend({
  pain_points: z.array(z.string()).max(5).describe('Identified pain points'),
  urgency: z.enum(['critical', 'high', 'medium', 'low', 'unknown']),
});

export const TimelineDimensionSchema = BANTDimensionSchema.extend({
  target_date: z.string().nullable().describe('Target implementation date'),
  driving_event: z.string().nullable().describe('Event driving the timeline'),
});

export const BANTOverallSchema = z.object({
  score: z.number().min(0).max(100).describe('Overall qualification score 0-100'),
  recommendation: z.enum(['hot', 'warm', 'nurture', 'disqualify']),
  summary: z.string().max(500).describe('Brief summary of qualification status'),
});

export const BANTSchema = z.object({
  budget: BudgetDimensionSchema,
  authority: AuthorityDimensionSchema,
  need: NeedDimensionSchema,
  timeline: TimelineDimensionSchema,
  overall: BANTOverallSchema,
});

export type BANT = z.infer<typeof BANTSchema>;

// ===========================================
// Objection Schema (FR-008)
// ===========================================

export const ObjectionCategorySchema = z.enum([
  'price',
  'timing',
  'competition',
  'internal_process',
  'technical',
  'trust',
  'need',
  'other',
]);

export type ObjectionCategory = z.infer<typeof ObjectionCategorySchema>;

export const ObjectionStatusSchema = z.enum([
  'resolved',     // Addressed during the meeting
  'outstanding',  // Still needs to be addressed
  'deferred',     // Agreed to address later
]);

export type ObjectionStatus = z.infer<typeof ObjectionStatusSchema>;

export const ExtractedObjectionSchema = z.object({
  text: z.string().describe('The objection as stated or paraphrased'),
  category: ObjectionCategorySchema,
  status: ObjectionStatusSchema,
  resolution: z.string().nullable().describe('How it was addressed if resolved'),
  confidence: z.number().min(0).max(1),
  recommended_follow_up: z.string().nullable().describe('Suggested next step'),
});

export type ExtractedObjection = z.infer<typeof ExtractedObjectionSchema>;

// ===========================================
// Action Item Schema (FR-008)
// ===========================================

export const ActionItemPrioritySchema = z.enum(['high', 'medium', 'low']);

export const ActionItemSchema = z.object({
  description: z.string().describe('What needs to be done'),
  assignee: z.enum(['us', 'them', 'both']).describe('Who is responsible'),
  due_date: z.string().nullable().describe('When it should be done'),
  priority: ActionItemPrioritySchema,
  created_in_crm: z.boolean().default(false),
  crm_task_id: z.string().nullable().default(null),
});

export type ActionItem = z.infer<typeof ActionItemSchema>;

// ===========================================
// Key Quote Schema
// ===========================================

export const KeyQuoteSchema = z.object({
  quote: z.string().describe('Exact or near-exact quote'),
  speaker: z.enum(['prospect', 'us']),
  significance: z.string().describe('Why this quote matters'),
});

export type KeyQuote = z.infer<typeof KeyQuoteSchema>;

// ===========================================
// Competitive Mention Schema
// ===========================================

export const CompetitiveMentionSchema = z.object({
  competitor: z.string(),
  context: z.string().describe('What was said about the competitor'),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
});

export type CompetitiveMention = z.infer<typeof CompetitiveMentionSchema>;

// ===========================================
// CRM Update Schema (FR-009, FR-010)
// ===========================================

export const AttioCRMUpdateSchema = z.object({
  pipeline_stage: z.string().nullable(),
  deal_value: z.number().nullable(),
  meeting_notes_added: z.boolean(),
  tasks_created: z.array(z.string()), // Task IDs
});

export const AirtableCRMUpdateSchema = z.object({
  status_updated: z.boolean(),
  qualification_updated: z.boolean(),
});

export const CRMUpdatesSchema = z.object({
  attio: AttioCRMUpdateSchema,
  airtable: AirtableCRMUpdateSchema,
});

export type CRMUpdates = z.infer<typeof CRMUpdatesSchema>;

// ===========================================
// Full Meeting Analysis Schema
// ===========================================

export const MeetingAnalysisSchema = z.object({
  // Identity
  analysis_id: z.string().uuid(),
  meeting_id: z.string(),
  brief_id: z.string().uuid().nullable(),
  brain_id: z.string().min(1),

  // Input
  transcript_source: z.enum(['fireflies', 'otter', 'manual', 'slack_form']),
  transcript_length: z.number().int().min(0),
  meeting_duration_minutes: z.number().int().min(0),

  // BANT Qualification
  bant: BANTSchema,

  // Objections
  objections: z.array(ExtractedObjectionSchema).max(10),

  // Action Items
  action_items: z.array(ActionItemSchema).max(10),

  // Key Quotes
  key_quotes: z.array(KeyQuoteSchema).max(10),

  // Competitive Intel
  competitive_mentions: z.array(CompetitiveMentionSchema).max(5),

  // CRM Updates Applied
  crm_updates: CRMUpdatesSchema,

  // Metadata
  analyzed_at: z.string().datetime({ offset: true }),
  analysis_duration_ms: z.number().int().min(0),
});

export type MeetingAnalysis = z.infer<typeof MeetingAnalysisSchema>;

// ===========================================
// Transcript Input Schema
// ===========================================

export const TranscriptInputSchema = z.object({
  meeting_id: z.string(),
  brain_id: z.string().min(1),
  attendee_email: z.string().email(),
  meeting_date: z.string().datetime({ offset: true }),
  source: z.enum(['fireflies', 'otter', 'manual', 'slack_form']),
  transcript_text: z.string().min(100), // At least 100 chars
  duration_minutes: z.number().int().min(1).optional(),
});

export type TranscriptInput = z.infer<typeof TranscriptInputSchema>;

// ===========================================
// Analysis Output Schema (for Claude structured output)
// ===========================================

export const AnalysisOutputSchema = z.object({
  bant: BANTSchema.describe('BANT qualification assessment'),
  objections: z.array(ExtractedObjectionSchema).describe('Objections raised during the call'),
  action_items: z.array(ActionItemSchema).describe('Action items to follow up on'),
  key_quotes: z.array(KeyQuoteSchema).describe('Important quotes from the conversation'),
  competitive_mentions: z.array(CompetitiveMentionSchema).describe('Mentions of competitors'),
  recommended_next_steps: z.array(z.string()).max(5).describe('Suggested next steps for follow-up'),
  meeting_summary: z.string().max(1000).describe('Brief summary of the meeting'),
});

export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

// ===========================================
// Helper Functions
// ===========================================

export function createEmptyAnalysis(
  meetingId: string,
  brainId: BrainId,
  transcriptInput: TranscriptInput,
): Omit<MeetingAnalysis, 'bant' | 'objections' | 'action_items' | 'key_quotes' | 'competitive_mentions' | 'analysis_duration_ms'> {
  return {
    analysis_id: crypto.randomUUID(),
    meeting_id: meetingId,
    brief_id: null,
    brain_id: brainId,
    transcript_source: transcriptInput.source,
    transcript_length: transcriptInput.transcript_text.length,
    meeting_duration_minutes: transcriptInput.duration_minutes ?? 30,
    crm_updates: {
      attio: {
        pipeline_stage: null,
        deal_value: null,
        meeting_notes_added: false,
        tasks_created: [],
      },
      airtable: {
        status_updated: false,
        qualification_updated: false,
      },
    },
    analyzed_at: new Date().toISOString(),
  };
}

/**
 * Calculate overall BANT score based on individual dimensions.
 */
export function calculateBANTScore(bant: Omit<BANT, 'overall'>): number {
  const weights = {
    budget: 30,
    authority: 25,
    need: 30,
    timeline: 15,
  };

  const statusScores: Record<BANTStatus, number> = {
    confirmed: 1.0,
    partial: 0.5,
    unknown: 0.25,
    negative: 0,
  };

  let total = 0;
  total += weights.budget * statusScores[bant.budget.status] * bant.budget.confidence;
  total += weights.authority * statusScores[bant.authority.status] * bant.authority.confidence;
  total += weights.need * statusScores[bant.need.status] * bant.need.confidence;
  total += weights.timeline * statusScores[bant.timeline.status] * bant.timeline.confidence;

  return Math.round(total);
}

/**
 * Determine recommendation based on BANT score.
 */
export function getRecommendation(score: number): 'hot' | 'warm' | 'nurture' | 'disqualify' {
  if (score >= 75) return 'hot';
  if (score >= 50) return 'warm';
  if (score >= 25) return 'nurture';
  return 'disqualify';
}
