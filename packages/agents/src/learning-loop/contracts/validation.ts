/**
 * Validation Schema
 *
 * Defines schemas for the human validation queue,
 * Slack interaction handling, and validation lifecycle.
 *
 * Implements: FR-011 through FR-015
 *
 * @module learning-loop/contracts/validation
 */

import { z } from 'zod';
import { InsightCategorySchema, InsightImportanceSchema } from './insight';

// ===========================================
// Validation Status (FR-011 through FR-013)
// ===========================================

export const ValidationStatusSchema = z.enum([
  'pending', // Awaiting human decision
  'approved', // User clicked Approve
  'rejected', // User clicked Reject
  'expired', // No decision after max reminders
]);

export type ValidationStatus = z.infer<typeof ValidationStatusSchema>;

// ===========================================
// Validation Decision (FR-012, FR-013, FR-014)
// ===========================================

export const ValidationDecisionSchema = z.object({
  action: z.enum(['approved', 'rejected']).describe('FR-012: Approve/Reject actions'),
  validated_by: z.string().min(1).describe('FR-013: Slack user ID'),
  validator_name: z.string().min(1).describe('Display name of validator'),
  decided_at: z.string().datetime({ offset: true }).describe('FR-013: Decision timestamp'),
  note: z.string().max(500).nullable().describe('FR-014: Validation notes'),
});

export type ValidationDecision = z.infer<typeof ValidationDecisionSchema>;

// ===========================================
// Slack Message Info
// ===========================================

export const ValidationSlackInfoSchema = z.object({
  channel_id: z.string().min(1).describe('Slack channel ID'),
  message_ts: z.string().min(1).describe('Slack message timestamp'),
  sent_at: z.string().datetime({ offset: true }),
});

export type ValidationSlackInfo = z.infer<typeof ValidationSlackInfoSchema>;

// ===========================================
// Reminder Tracking (FR-015)
// ===========================================

export const ReminderTrackingSchema = z.object({
  count: z.number().int().min(0).describe('Number of reminders sent'),
  last_sent_at: z.string().datetime({ offset: true }).nullable(),
  next_due_at: z.string().datetime({ offset: true }).describe('When next reminder is due'),
});

export type ReminderTracking = z.infer<typeof ReminderTrackingSchema>;

// ===========================================
// Insight Summary (for validation message)
// ===========================================

export const InsightSummarySchema = z.object({
  id: z.string().min(1),
  category: InsightCategorySchema,
  content: z.string().max(2000),
  importance: InsightImportanceSchema,
  confidence: z.number().min(0).max(1),
  source_type: z.enum(['email_reply', 'call_transcript']),
  company_name: z.string().nullable(),
  extracted_quote: z.string().nullable(),
});

export type InsightSummary = z.infer<typeof InsightSummarySchema>;

// ===========================================
// Validation Item (Queue Entry)
// ===========================================

export const ValidationItemSchema = z.object({
  id: z.string().min(1).describe('Unique validation item ID'),
  insight_id: z.string().min(1).describe('Reference to extracted insight'),
  brain_id: z.string().min(1).describe('Brain context'),
  status: ValidationStatusSchema,
  insight_summary: InsightSummarySchema.describe('Snapshot of insight for display'),
  slack: ValidationSlackInfoSchema.describe('Slack message details'),
  reminders: ReminderTrackingSchema.describe('FR-015: Reminder tracking'),
  decision: ValidationDecisionSchema.nullable().describe('Null while pending'),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export type ValidationItem = z.infer<typeof ValidationItemSchema>;

// ===========================================
// Validation Queue Stats
// ===========================================

export const ValidationQueueStatsSchema = z.object({
  brain_id: z.string().min(1),
  pending_count: z.number().int().min(0),
  approved_today: z.number().int().min(0),
  rejected_today: z.number().int().min(0),
  avg_decision_time_ms: z.number().min(0).nullable(),
  oldest_pending_at: z.string().datetime({ offset: true }).nullable(),
});

export type ValidationQueueStats = z.infer<typeof ValidationQueueStatsSchema>;

// ===========================================
// Slack Interaction Payload (from Slack)
// ===========================================

export const SlackInteractionUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  name: z.string().min(1),
});

export const SlackInteractionActionSchema = z.object({
  action_id: z.enum(['insight_approve', 'insight_reject']),
  value: z.string().describe('JSON: { insight_id, brain_id, validation_id }'),
  block_id: z.string().optional(),
});

export const SlackInteractionPayloadSchema = z.object({
  type: z.literal('block_actions'),
  user: SlackInteractionUserSchema,
  actions: z.array(SlackInteractionActionSchema).min(1),
  response_url: z.string().url(),
  message: z.object({
    ts: z.string(),
  }),
  channel: z.object({
    id: z.string(),
  }),
  trigger_id: z.string().optional(),
});

export type SlackInteractionUser = z.infer<typeof SlackInteractionUserSchema>;
export type SlackInteractionAction = z.infer<typeof SlackInteractionActionSchema>;
export type SlackInteractionPayload = z.infer<typeof SlackInteractionPayloadSchema>;

// ===========================================
// Parsed Action Value
// ===========================================

export const ActionValueSchema = z.object({
  insight_id: z.string().min(1),
  brain_id: z.string().min(1),
  validation_id: z.string().min(1),
});

export type ActionValue = z.infer<typeof ActionValueSchema>;

// ===========================================
// Validation Item Creation Helper
// ===========================================

export function createValidationItem(params: {
  insightId: string;
  brainId: string;
  insightSummary: InsightSummary;
  slackChannelId: string;
  slackMessageTs: string;
}): ValidationItem {
  const now = new Date().toISOString();
  const fortyEightHoursLater = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  return {
    id: `val_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    insight_id: params.insightId,
    brain_id: params.brainId,
    status: 'pending',
    insight_summary: params.insightSummary,
    slack: {
      channel_id: params.slackChannelId,
      message_ts: params.slackMessageTs,
      sent_at: now,
    },
    reminders: {
      count: 0,
      last_sent_at: null,
      next_due_at: fortyEightHoursLater, // FR-015: 48 hour reminder
    },
    decision: null,
    created_at: now,
    updated_at: now,
  };
}

// ===========================================
// Validation Decision Helper
// ===========================================

export function applyValidationDecision(
  item: ValidationItem,
  decision: 'approved' | 'rejected',
  userId: string,
  userName: string,
  note?: string
): ValidationItem {
  const now = new Date().toISOString();

  return {
    ...item,
    status: decision,
    decision: {
      action: decision,
      validated_by: userId,
      validator_name: userName,
      decided_at: now,
      note: note ?? null,
    },
    updated_at: now,
  };
}

// ===========================================
// Reminder Scheduling
// ===========================================

const REMINDER_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48 hours
const MAX_REMINDERS = 2;

export function shouldSendReminder(item: ValidationItem): boolean {
  if (item.status !== 'pending') return false;
  if (item.reminders.count >= MAX_REMINDERS) return false;

  const now = Date.now();
  const nextDue = new Date(item.reminders.next_due_at).getTime();

  return now >= nextDue;
}

export function recordReminderSent(item: ValidationItem): ValidationItem {
  const now = new Date().toISOString();
  const nextDue = new Date(Date.now() + REMINDER_INTERVAL_MS).toISOString();

  return {
    ...item,
    reminders: {
      count: item.reminders.count + 1,
      last_sent_at: now,
      next_due_at: nextDue,
    },
    updated_at: now,
  };
}

export function shouldExpire(item: ValidationItem): boolean {
  return item.status === 'pending' && item.reminders.count >= MAX_REMINDERS;
}

export function expireValidationItem(item: ValidationItem): ValidationItem {
  return {
    ...item,
    status: 'expired',
    updated_at: new Date().toISOString(),
  };
}

// ===========================================
// Redis Key Helpers
// ===========================================

export function validationItemKey(validationId: string): string {
  return `validation:item:${validationId}`;
}

export function pendingValidationsKey(brainId: string): string {
  return `validation:pending:${brainId}`;
}

export function validationReminderKey(validationId: string): string {
  return `validation:reminder:${validationId}`;
}
