/**
 * Reply Handler - Category Workflow Contracts
 *
 * Defines input/output schemas for Category A, B, C workflows.
 *
 * Implements:
 * - FR-005 to FR-008: Category A (Interested) workflow
 * - FR-009 to FR-012: Category B (Not Interested) workflow
 * - FR-013 to FR-016: Category C (Manual Review) workflow
 *
 * @module reply-handler/contracts/category-workflows
 */

import { z } from 'zod';
import {
  ClassificationCategorySchema,
  ClassificationResultSchema,
} from './classification-result';

// ===========================================
// Shared Types
// ===========================================

/**
 * Channel types for reply sources
 */
export const ChannelSchema = z.enum(['email', 'linkedin']);
export type Channel = z.infer<typeof ChannelSchema>;

/**
 * Notification record
 */
export const NotificationSchema = z.object({
  channel: z.enum(['slack']),
  message_id: z.string(),
  sent_at: z.string().datetime(),
});

export type Notification = z.infer<typeof NotificationSchema>;

/**
 * Lead reference for workflows
 */
export const LeadReferenceSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  linkedin_url: z.string().url().optional(),
});

export type LeadReference = z.infer<typeof LeadReferenceSchema>;

/**
 * Reply reference for workflows
 */
export const ReplyReferenceSchema = z.object({
  id: z.string(),
  channel: ChannelSchema,
  reply_text: z.string(),
  timestamp: z.string().datetime(),
  campaign_id: z.string().optional(),
});

export type ReplyReference = z.infer<typeof ReplyReferenceSchema>;

// ===========================================
// Category A (Interested) Workflow
// ===========================================

/**
 * Category A workflow input
 *
 * FR-005: Create CRM record with "New Reply" stage
 * FR-005a: Send calendar booking link within 60s
 * FR-006: Trigger profile enrichment
 * FR-007: Add email respondents to LinkedIn
 * FR-008: Notify sales team via Slack
 */
export const CategoryAInputSchema = z.object({
  reply: ReplyReferenceSchema,
  lead: LeadReferenceSchema,
  brain_id: z.string(),
  classification: z.object({
    category: z.literal('A'),
    confidence: z.number(),
    reasoning: z.string(),
  }),
});

export type CategoryAInput = z.infer<typeof CategoryAInputSchema>;

/**
 * Category A workflow output
 */
export const CategoryAOutputSchema = z.object({
  success: z.boolean(),

  // FR-005: CRM record creation
  crm_record_id: z.string().uuid().optional(),
  crm_record_created: z.boolean(),

  // FR-005a: Calendar link
  calendar_link_sent: z.boolean(),
  calendar_link_sent_at: z.string().datetime().optional(),

  // FR-006: Enrichment triggered
  enrichment_triggered: z.boolean(),

  // FR-007: LinkedIn addition (only for email replies)
  linkedin_added: z.boolean().optional(),
  linkedin_skip_reason: z.string().optional(),

  // FR-008: Slack notification
  notifications: z.array(NotificationSchema),

  // Airtable status update
  airtable_updated: z.boolean(),

  // Error tracking
  errors: z.array(z.string()).optional(),
});

export type CategoryAOutput = z.infer<typeof CategoryAOutputSchema>;

// ===========================================
// Category B (Not Interested) Workflow
// ===========================================

/**
 * Referral evaluation result (FR-010)
 */
export const ReferralEvaluationSchema = z.object({
  /**
   * Is the lead VP+ level?
   */
  is_vp_plus: z.boolean(),

  /**
   * Tone of the decline
   */
  decline_tone: z.enum(['polite', 'neutral', 'hostile']),

  /**
   * Network fit assessment
   */
  network_fit: z.enum(['aligned', 'partial', 'misaligned']),

  /**
   * Should we request a referral?
   */
  referral_potential: z.boolean(),

  /**
   * Auto-send referral? (VP+ + polite + aligned = auto-send per FR-012)
   */
  auto_send_referral: z.boolean(),
});

export type ReferralEvaluation = z.infer<typeof ReferralEvaluationSchema>;

/**
 * Category B workflow input
 *
 * FR-009: Generate summary for future reference
 * FR-010: Evaluate referral potential
 * FR-011: Update lead status to "Not Interested"
 * FR-012: Auto-send referral to VP+ polite decliners with aligned network
 */
export const CategoryBInputSchema = z.object({
  reply: ReplyReferenceSchema,
  lead: LeadReferenceSchema,
  brain_id: z.string(),
  classification: z.object({
    category: z.literal('B'),
    confidence: z.number(),
    reasoning: z.string(),
  }),
});

export type CategoryBInput = z.infer<typeof CategoryBInputSchema>;

/**
 * Category B workflow output
 */
export const CategoryBOutputSchema = z.object({
  success: z.boolean(),

  // FR-011: Lead status update
  lead_status_updated: z.boolean(),
  new_status: z.literal('not_interested'),

  // FR-009: Profile summary
  profile_summary_generated: z.boolean(),
  profile_summary: z.string().optional(),

  // FR-010: Referral evaluation
  referral_evaluation: ReferralEvaluationSchema,

  // FR-012: Referral action
  referral_sent: z.boolean(),
  referral_sent_at: z.string().datetime().optional(),

  // Airtable status update
  airtable_updated: z.boolean(),

  // Error tracking
  errors: z.array(z.string()).optional(),
});

export type CategoryBOutput = z.infer<typeof CategoryBOutputSchema>;

// ===========================================
// Category C (Manual Review) Workflow
// ===========================================

/**
 * Similar pattern result from KB search
 */
export const SimilarPatternSchema = z.object({
  id: z.string().uuid(),
  similarity: z.number().min(0).max(1),
  reply_text: z.string().optional(),
  label: z.string().optional(),
  handling_notes: z.string().optional(),
  outcome: z.enum(['converted', 'not_converted', 'referral', 'nurture']).optional(),
});

export type SimilarPattern = z.infer<typeof SimilarPatternSchema>;

/**
 * Category C workflow input
 *
 * FR-013: Store reply with full context in KB
 * FR-014: Notify sales team via Slack
 * FR-015: Update lead status to "Pending Review"
 * FR-016: Support adding labels/notes after handling
 */
export const CategoryCInputSchema = z.object({
  reply: ReplyReferenceSchema,
  lead: LeadReferenceSchema,
  brain_id: z.string(),
  classification: z.object({
    category: z.literal('C'),
    confidence: z.number(),
    reasoning: z.string(),
  }),
  // Conversation history for context
  conversation_history: z
    .array(
      z.object({
        role: z.enum(['outbound', 'reply']),
        content: z.string(),
        timestamp: z.string().datetime(),
      })
    )
    .optional(),
});

export type CategoryCInput = z.infer<typeof CategoryCInputSchema>;

/**
 * Category C workflow output
 */
export const CategoryCOutputSchema = z.object({
  success: z.boolean(),

  // FR-013: Pattern storage
  pattern_id: z.string().uuid(),
  pattern_stored: z.boolean(),

  // Similar patterns from KB (FR-027)
  similar_patterns: z.array(SimilarPatternSchema).optional(),
  similar_patterns_count: z.number().int().nonnegative(),

  // FR-014: Slack notification
  notification_sent: z.boolean(),
  notifications: z.array(NotificationSchema).optional(),

  // FR-015: Lead status update
  lead_status_updated: z.boolean(),
  new_status: z.literal('pending_review'),

  // Airtable status update
  airtable_updated: z.boolean(),

  // Error tracking
  errors: z.array(z.string()).optional(),
});

export type CategoryCOutput = z.infer<typeof CategoryCOutputSchema>;

// ===========================================
// Helper Functions
// ===========================================

/**
 * Create Category A input from classification result
 */
export function createCategoryAInput(
  reply: ReplyReference,
  lead: LeadReference,
  brainId: string,
  classification: { confidence: number; reasoning: string }
): CategoryAInput {
  return {
    reply,
    lead,
    brain_id: brainId,
    classification: {
      category: 'A',
      ...classification,
    },
  };
}

/**
 * Create Category B input from classification result
 */
export function createCategoryBInput(
  reply: ReplyReference,
  lead: LeadReference,
  brainId: string,
  classification: { confidence: number; reasoning: string }
): CategoryBInput {
  return {
    reply,
    lead,
    brain_id: brainId,
    classification: {
      category: 'B',
      ...classification,
    },
  };
}

/**
 * Create Category C input from classification result
 */
export function createCategoryCInput(
  reply: ReplyReference,
  lead: LeadReference,
  brainId: string,
  classification: { confidence: number; reasoning: string },
  conversationHistory?: CategoryCInput['conversation_history']
): CategoryCInput {
  return {
    reply,
    lead,
    brain_id: brainId,
    classification: {
      category: 'C',
      ...classification,
    },
    conversation_history: conversationHistory,
  };
}

/**
 * Check if referral should be auto-sent (FR-012)
 * VP+ + polite + aligned network = auto-send
 */
export function shouldAutoSendReferral(evaluation: ReferralEvaluation): boolean {
  return (
    evaluation.is_vp_plus &&
    evaluation.decline_tone === 'polite' &&
    evaluation.network_fit === 'aligned'
  );
}

/**
 * Check if lead is VP+ level
 */
export function isVpPlusLevel(title: string | undefined): boolean {
  if (!title) return false;
  const titleLower = title.toLowerCase();
  const vpPlusTitles = [
    'ceo',
    'cto',
    'cfo',
    'coo',
    'cmo',
    'cio',
    'cso',
    'founder',
    'co-founder',
    'cofounder',
    'president',
    'vp',
    'vice president',
    'director',
    'head of',
    'chief',
    'partner',
    'managing director',
  ];
  return vpPlusTitles.some((t) => titleLower.includes(t));
}
