/**
 * Brief Contract
 *
 * Defines the schema for pre-call briefs including all sections
 * and lifecycle states. Used for brief generation and Slack delivery.
 *
 * @module meeting-prep/contracts/brief
 */

import { z } from 'zod';
import type { BrainId } from '@atlas-gtm/lib'; // Used for function signatures

// ===========================================
// Brief Status (FR-015)
// ===========================================

export const BriefStatusSchema = z.enum([
  'pending',     // Context gathering in progress
  'generating',  // Claude processing
  'delivered',   // Sent to Slack
  'failed',      // Error occurred
]);

export type BriefStatus = z.infer<typeof BriefStatusSchema>;

// ===========================================
// Content Components
// ===========================================

export const ConversationEntrySchema = z.object({
  date: z.string().datetime({ offset: true }),
  channel: z.enum(['email', 'linkedin', 'call', 'meeting', 'slack']),
  summary: z.string().max(500),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'unknown']),
});

export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;

export const CompanyIntelSchema = z.object({
  industry: z.string(),
  size: z.string(),
  funding_stage: z.string().nullable(),
  recent_news: z.array(z.string()).max(5),
  tech_stack: z.array(z.string()).max(10),
  key_people: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      relevance: z.string(),
    })
  ).max(5),
});

export type CompanyIntel = z.infer<typeof CompanyIntelSchema>;

export const ObjectionHandlerSchema = z.object({
  objection: z.string(),
  response: z.string(),
  source: z.enum(['kb_handler', 'similar_deal', 'ai_generated']),
  confidence: z.number().min(0).max(1),
});

export type ObjectionHandler = z.infer<typeof ObjectionHandlerSchema>;

export const SimilarDealSchema = z.object({
  company: z.string(),
  industry: z.string(),
  why_won: z.string(),
  relevance_score: z.number().min(0).max(1),
  key_lesson: z.string(),
});

export type SimilarDeal = z.infer<typeof SimilarDealSchema>;

// ===========================================
// Brief Content Schema (for Claude structured output)
// ===========================================

export const BriefContentSchema = z.object({
  quick_context: z.string().max(1000).describe(
    'One-paragraph summary of the lead: who they are, what stage they are in, and the key context for this meeting'
  ),

  conversation_timeline: z.array(ConversationEntrySchema).max(10).describe(
    'Recent conversation history across all channels, most recent first'
  ),

  company_intel: CompanyIntelSchema.describe(
    'Company research including industry, size, funding, news, and key people'
  ),

  talking_points: z.array(z.string()).min(3).max(7).describe(
    'Suggested talking points tailored to this specific lead and meeting context'
  ),

  suggested_questions: z.array(z.string()).min(2).max(5).describe(
    'Discovery questions to ask during the meeting'
  ),

  objection_handlers: z.array(ObjectionHandlerSchema).max(5).describe(
    'Likely objections and suggested responses based on KB and similar deals'
  ),

  similar_won_deals: z.array(SimilarDealSchema).max(3).describe(
    'Similar won deals from the same vertical that can be referenced'
  ),
});

export type BriefContent = z.infer<typeof BriefContentSchema>;

// ===========================================
// Status History Entry
// ===========================================

export const StatusHistoryEntrySchema = z.object({
  status: BriefStatusSchema,
  timestamp: z.string().datetime({ offset: true }),
  reason: z.string().optional(),
});

export type StatusHistoryEntry = z.infer<typeof StatusHistoryEntrySchema>;

// ===========================================
// Brief Error Schema
// ===========================================

export const BriefErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retry_count: z.number().int().min(0),
  last_retry_at: z.string().datetime({ offset: true }).nullable(),
});

export type BriefError = z.infer<typeof BriefErrorSchema>;

// ===========================================
// Full Brief Schema
// ===========================================

export const BriefSchema = z.object({
  // Identity
  brief_id: z.string().uuid(),
  meeting_id: z.string(),
  brain_id: z.string().min(1),

  // Lifecycle
  status: BriefStatusSchema,
  status_history: z.array(StatusHistoryEntrySchema),

  // Content
  content: BriefContentSchema.nullable(), // null until generation complete

  // Delivery
  slack_message_ts: z.string().nullable(),
  slack_channel_id: z.string().nullable(),
  delivered_at: z.string().datetime({ offset: true }).nullable(),

  // Performance
  context_gathering_ms: z.number().int().min(0),
  generation_ms: z.number().int().min(0),
  total_processing_ms: z.number().int().min(0),

  // Error
  error: BriefErrorSchema.nullable(),

  // Metadata
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export type Brief = z.infer<typeof BriefSchema>;

// ===========================================
// Brief Creation Helper
// ===========================================

export function createPendingBrief(
  meetingId: string,
  brainId: BrainId,
): Brief {
  const now = new Date().toISOString();

  return {
    brief_id: crypto.randomUUID(),
    meeting_id: meetingId,
    brain_id: brainId,
    status: 'pending',
    status_history: [
      {
        status: 'pending',
        timestamp: now,
      },
    ],
    content: null,
    slack_message_ts: null,
    slack_channel_id: null,
    delivered_at: null,
    context_gathering_ms: 0,
    generation_ms: 0,
    total_processing_ms: 0,
    error: null,
    created_at: now,
    updated_at: now,
  };
}

// ===========================================
// Status Transition Helper
// ===========================================

export function transitionBriefStatus(
  brief: Brief,
  newStatus: BriefStatus,
  reason?: string,
): Brief {
  const now = new Date().toISOString();

  return {
    ...brief,
    status: newStatus,
    status_history: [
      ...brief.status_history,
      {
        status: newStatus,
        timestamp: now,
        reason,
      },
    ],
    updated_at: now,
  };
}

// ===========================================
// Slack Block Kit Schema (for delivery)
// ===========================================

export const SlackBlockSchema = z.object({
  type: z.string(),
  text: z.any().optional(),
  accessory: z.any().optional(),
  elements: z.array(z.any()).optional(),
  block_id: z.string().optional(),
});

export const SlackMessageSchema = z.object({
  channel: z.string(),
  blocks: z.array(SlackBlockSchema),
  text: z.string(), // Fallback text
});

export type SlackMessage = z.infer<typeof SlackMessageSchema>;
