/**
 * Reply Handler Agent - Input Contract
 *
 * Defines the input schema for processing inbound email replies.
 * This contract is used by the n8n webhook and agent entry point.
 *
 * @module reply-handler/contracts/reply-input
 */

import { z } from 'zod';

// ===========================================
// Branded Types
// ===========================================

export type ReplyId = string & { readonly brand: unique symbol };
export type ThreadId = string & { readonly brand: unique symbol };
export type LeadId = string & { readonly brand: unique symbol };
export type BrainId = string & { readonly brand: unique symbol };

// ===========================================
// Thread Message Schema
// ===========================================

/**
 * A message in the email conversation thread
 */
export const ThreadMessageSchema = z.object({
  id: z.string(),
  direction: z.enum(['outbound', 'inbound']),
  content: z.string(),
  sent_at: z.string().datetime(),
  sender: z.string().email(),
  subject: z.string().optional(),
});

export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

// ===========================================
// Reply Input Schema
// ===========================================

/**
 * Source of the reply
 */
export const ReplySourceSchema = z.enum(['instantly', 'linkedin', 'manual']);
export type ReplySource = z.infer<typeof ReplySourceSchema>;

/**
 * Complete input for processing a reply
 */
export const ReplyInputSchema = z.object({
  // Reply metadata
  reply_id: z.string().min(1),
  source: ReplySourceSchema,
  received_at: z.string().datetime(),

  // Reply content
  reply_text: z.string().min(1),
  subject: z.string().optional(),

  // Thread context
  thread_id: z.string().min(1),
  thread_messages: z.array(ThreadMessageSchema).default([]),
  message_count: z.number().int().nonnegative().default(1),

  // Lead context
  lead_id: z.string().min(1),
  lead_email: z.string().email(),
  lead_name: z.string().optional(),
  lead_company: z.string().optional(),
  lead_title: z.string().optional(),

  // Campaign context
  campaign_id: z.string().optional(),
  sequence_step: z.number().int().positive().optional(),
  last_sent_template: z.string().optional(),

  // Brain context (required for KB matching)
  brain_id: z.string().min(1),
});

export type ReplyInput = z.infer<typeof ReplyInputSchema>;

// ===========================================
// Lead Context Schema
// ===========================================

/**
 * Extended lead information for processing decisions
 */
export const LeadContextSchema = z.object({
  // Identity
  id: z.string().min(1),
  email: z.string().email(),

  // Profile
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  industry: z.string().optional(),

  // Engagement history
  reply_count: z.number().int().nonnegative().default(0),
  last_reply_at: z.string().datetime().optional(),
  last_reply_intent: z.string().optional(),

  // Value indicators
  deal_value: z.number().nonnegative().optional(),
  lead_score: z.number().min(0).max(100).optional(),

  // CRM references
  airtable_id: z.string().optional(),
  attio_id: z.string().optional(),

  // Vertical
  brain_id: z.string().min(1),
});

export type LeadContext = z.infer<typeof LeadContextSchema>;

// ===========================================
// Webhook Payload Schema
// ===========================================

/**
 * Instantly webhook payload structure
 */
export const InstantlyWebhookPayloadSchema = z.object({
  event: z.literal('reply_received'),
  timestamp: z.string().datetime(),

  // Reply data
  reply: z.object({
    id: z.string(),
    message_id: z.string(),
    thread_id: z.string(),
    content: z.string(),
    subject: z.string().optional(),
    received_at: z.string().datetime(),
  }),

  // Lead data
  lead: z.object({
    id: z.string(),
    email: z.string().email(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    company: z.string().optional(),
    title: z.string().optional(),
  }),

  // Campaign context
  campaign: z.object({
    id: z.string(),
    name: z.string(),
    sequence_step: z.number().int().positive(),
    last_sent_template: z.string().optional(),
  }),

  // Account context
  account_id: z.string(),
  workspace_id: z.string(),
});

export type InstantlyWebhookPayload = z.infer<typeof InstantlyWebhookPayloadSchema>;

// ===========================================
// Helper Functions
// ===========================================

/**
 * Convert Instantly webhook payload to ReplyInput
 */
export function webhookToReplyInput(
  payload: InstantlyWebhookPayload,
  brainId: string,
  threadMessages: ThreadMessage[] = []
): ReplyInput {
  return {
    reply_id: payload.reply.id,
    source: 'instantly',
    received_at: payload.reply.received_at,
    reply_text: payload.reply.content,
    subject: payload.reply.subject,
    thread_id: payload.reply.thread_id,
    thread_messages: threadMessages,
    message_count: threadMessages.length + 1,
    lead_id: payload.lead.id,
    lead_email: payload.lead.email,
    lead_name: [payload.lead.first_name, payload.lead.last_name]
      .filter(Boolean)
      .join(' ') || undefined,
    lead_company: payload.lead.company,
    lead_title: payload.lead.title,
    campaign_id: payload.campaign.id,
    sequence_step: payload.campaign.sequence_step,
    last_sent_template: payload.campaign.last_sent_template,
    brain_id: brainId,
  };
}

/**
 * Validate reply input and return typed result
 */
export function parseReplyInput(data: unknown): ReplyInput {
  return ReplyInputSchema.parse(data);
}

/**
 * Safe parse with error details
 */
export function safeParseReplyInput(data: unknown): {
  success: boolean;
  data?: ReplyInput;
  error?: z.ZodError;
} {
  const result = ReplyInputSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
