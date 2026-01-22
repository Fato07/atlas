/**
 * Reply Handler Agent - State Schema Contract
 *
 * Zod schemas for validating state persistence files.
 * Used when loading state from disk to ensure data integrity.
 *
 * @module reply-handler/contracts/state-schema
 */

import { z } from 'zod';
import { ClassificationSchema, ExtractedInsightSchema } from './handler-result';
import { LeadContextSchema } from './reply-input';

// ===========================================
// Draft Status Schema
// ===========================================

/**
 * Status of a pending draft
 */
export const DraftStatusSchema = z.enum([
  'pending', // Awaiting action
  'approved', // Approved and sent
  'approved_edited', // Approved with modifications
  'rejected', // Rejected by user
  'escalated', // Escalated to Tier 3
  'expired', // Timed out (30 min)
]);

export type DraftStatus = z.infer<typeof DraftStatusSchema>;

// ===========================================
// Draft Schema
// ===========================================

/**
 * A pending response awaiting approval (Tier 2)
 */
export const DraftSchema = z.object({
  // Identity
  id: z.string().min(1),
  reply_id: z.string().min(1),

  // Content
  response_text: z.string().min(1),
  original_template_id: z.string().optional(),

  // Slack Integration
  slack_channel: z.string().min(1),
  slack_message_ts: z.string().min(1),
  slack_thread_ts: z.string().optional(),

  // Approval State
  status: DraftStatusSchema,
  expires_at: z.string().datetime(),
  approved_by: z.string().optional(),
  approved_at: z.string().datetime().optional(),
  edited_text: z.string().optional(),

  // Metadata
  created_at: z.string().datetime(),
  lead_context: LeadContextSchema,
  classification: ClassificationSchema,
});

export type Draft = z.infer<typeof DraftSchema>;

// ===========================================
// Active Thread Schema
// ===========================================

/**
 * Active thread being processed
 */
export const ActiveThreadSchema = z.object({
  thread_id: z.string().min(1),
  lead_id: z.string().min(1),
  status: z.enum(['processing', 'pending_approval', 'escalated']),
  draft_id: z.string().optional(),
  started_at: z.string().datetime(),
});

export type ActiveThread = z.infer<typeof ActiveThreadSchema>;

// ===========================================
// Processed Reply Schema
// ===========================================

/**
 * Processed reply summary
 */
export const ProcessedReplySchema = z.object({
  reply_id: z.string().min(1),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  action: z.enum(['auto_responded', 'draft_created', 'escalated', 'failed']),
  processed_at: z.string().datetime(),
  processing_time_ms: z.number().nonnegative(),
});

export type ProcessedReply = z.infer<typeof ProcessedReplySchema>;

// ===========================================
// Session Error Schema
// ===========================================

/**
 * Session error record
 */
export const SessionErrorSchema = z.object({
  reply_id: z.string().min(1),
  error_code: z.string().min(1),
  error_message: z.string(),
  occurred_at: z.string().datetime(),
  recovered: z.boolean(),
});

export type SessionError = z.infer<typeof SessionErrorSchema>;

// ===========================================
// Reply Handler State Schema
// ===========================================

/**
 * Complete reply handler session state
 *
 * This is the main schema for validating state files loaded from disk.
 * Ensures data integrity after session recovery.
 */
export const ReplyHandlerStateSchema = z.object({
  // Session Identity
  session_id: z.string().min(1),
  brain_id: z.string().min(1),
  started_at: z.string().datetime(),
  checkpoint_at: z.string().datetime(),

  // Active Work
  active_threads: z.array(ActiveThreadSchema).default([]),

  // Session Progress
  processed_this_session: z.array(ProcessedReplySchema).default([]),

  // Extracted Learnings
  insights_extracted: z.array(ExtractedInsightSchema).default([]),

  // Error Tracking
  errors_this_session: z.array(SessionErrorSchema).default([]),
});

export type ReplyHandlerState = z.infer<typeof ReplyHandlerStateSchema>;

// ===========================================
// Validation Helpers
// ===========================================

/**
 * Parse and validate state data from file
 *
 * @throws {z.ZodError} if validation fails
 */
export function parseState(data: unknown): ReplyHandlerState {
  return ReplyHandlerStateSchema.parse(data);
}

/**
 * Safely parse state with error details
 */
export function safeParseState(data: unknown): {
  success: boolean;
  data?: ReplyHandlerState;
  error?: z.ZodError;
} {
  const result = ReplyHandlerStateSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validate draft data
 *
 * @throws {z.ZodError} if validation fails
 */
export function parseDraft(data: unknown): Draft {
  return DraftSchema.parse(data);
}

/**
 * Safely parse draft with error details
 */
export function safeParseDraft(data: unknown): {
  success: boolean;
  data?: Draft;
  error?: z.ZodError;
} {
  const result = DraftSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
