/**
 * Webhook API Contract
 *
 * Defines the HTTP API schemas for the Meeting Prep Agent webhooks.
 * These are the external interfaces triggered by n8n workflows.
 *
 * @module meeting-prep/contracts/webhook-api
 */

import { z } from 'zod';
import { CalendarWebhookPayloadSchema, ManualBriefRequestSchema } from './meeting-input';
import { TranscriptInputSchema } from './meeting-analysis';
import { BriefStatusSchema } from './brief';

// ===========================================
// Webhook Authentication
// ===========================================

export const WebhookAuthHeaderSchema = z.object({
  'x-webhook-secret': z.string().min(32),
});

export type WebhookAuthHeader = z.infer<typeof WebhookAuthHeaderSchema>;

// ===========================================
// Brief Generation Endpoints
// ===========================================

/**
 * POST /webhook/meeting-prep/brief
 *
 * Triggered by n8n when a calendar reminder fires (30 min before meeting).
 */
export const BriefWebhookRequestSchema = CalendarWebhookPayloadSchema;
export type BriefWebhookRequest = z.infer<typeof BriefWebhookRequestSchema>;

export const BriefWebhookResponseSchema = z.object({
  success: z.boolean(),
  brief_id: z.string().uuid().optional(),
  status: BriefStatusSchema.optional(),
  message: z.string(),
  processing_time_ms: z.number().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export type BriefWebhookResponse = z.infer<typeof BriefWebhookResponseSchema>;

/**
 * POST /webhook/meeting-prep/brief/manual
 *
 * Manual brief request via Slack command or direct API call.
 */
export const ManualBriefWebhookRequestSchema = ManualBriefRequestSchema;
export type ManualBriefWebhookRequest = z.infer<typeof ManualBriefWebhookRequestSchema>;

// ===========================================
// Meeting Analysis Endpoints
// ===========================================

/**
 * POST /webhook/meeting-prep/analyze
 *
 * Triggered when a meeting transcript is received from Fireflies or manual input.
 */
export const AnalysisWebhookRequestSchema = TranscriptInputSchema;
export type AnalysisWebhookRequest = z.infer<typeof AnalysisWebhookRequestSchema>;

export const AnalysisWebhookResponseSchema = z.object({
  success: z.boolean(),
  analysis_id: z.string().uuid().optional(),
  bant_score: z.number().min(0).max(100).optional(),
  recommendation: z.enum(['hot', 'warm', 'nurture', 'disqualify']).optional(),
  action_items_created: z.number().int().min(0).optional(),
  crm_updated: z.boolean().optional(),
  message: z.string(),
  processing_time_ms: z.number().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export type AnalysisWebhookResponse = z.infer<typeof AnalysisWebhookResponseSchema>;

// ===========================================
// Status Query Endpoints
// ===========================================

/**
 * GET /webhook/meeting-prep/brief/:brief_id/status
 *
 * Check status of a brief generation request.
 */
export const BriefStatusQuerySchema = z.object({
  brief_id: z.string().uuid(),
});

export type BriefStatusQuery = z.infer<typeof BriefStatusQuerySchema>;

export const BriefStatusResponseSchema = z.object({
  brief_id: z.string().uuid(),
  meeting_id: z.string(),
  status: BriefStatusSchema,
  delivered_at: z.string().datetime({ offset: true }).nullable(),
  slack_message_ts: z.string().nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retry_count: z.number(),
    })
    .nullable(),
});

export type BriefStatusResponse = z.infer<typeof BriefStatusResponseSchema>;

// ===========================================
// Health Check Endpoint
// ===========================================

/**
 * GET /webhook/meeting-prep/health
 *
 * Health check for monitoring.
 */
export const HealthCheckResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string(),
  uptime_seconds: z.number(),
  checks: z.object({
    qdrant: z.enum(['ok', 'error']),
    slack: z.enum(['ok', 'error']),
    attio: z.enum(['ok', 'error']),
    airtable: z.enum(['ok', 'error']),
  }),
  last_brief_at: z.string().datetime({ offset: true }).nullable(),
  last_analysis_at: z.string().datetime({ offset: true }).nullable(),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

// ===========================================
// Error Response Schema
// ===========================================

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.any()).optional(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ===========================================
// Error Codes
// ===========================================

export const ErrorCodes = {
  // Authentication
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_SECRET: 'INVALID_SECRET',

  // Validation
  INVALID_REQUEST: 'INVALID_REQUEST',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',

  // Meeting/Brief errors
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  INTERNAL_MEETING: 'INTERNAL_MEETING',
  BRIEF_ALREADY_EXISTS: 'BRIEF_ALREADY_EXISTS',
  BRIEF_GENERATION_FAILED: 'BRIEF_GENERATION_FAILED',
  BRIEF_DELIVERY_FAILED: 'BRIEF_DELIVERY_FAILED',

  // Analysis errors
  TRANSCRIPT_TOO_SHORT: 'TRANSCRIPT_TOO_SHORT',
  ANALYSIS_FAILED: 'ANALYSIS_FAILED',

  // Context gathering errors
  CONTEXT_GATHERING_FAILED: 'CONTEXT_GATHERING_FAILED',

  // CRM errors
  CRM_UPDATE_FAILED: 'CRM_UPDATE_FAILED',

  // External service errors
  QDRANT_ERROR: 'QDRANT_ERROR',
  SLACK_ERROR: 'SLACK_ERROR',
  ATTIO_ERROR: 'ATTIO_ERROR',
  AIRTABLE_ERROR: 'AIRTABLE_ERROR',
  CLAUDE_ERROR: 'CLAUDE_ERROR',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',

  // General
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TIMEOUT: 'TIMEOUT',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ===========================================
// Response Helpers
// ===========================================

export function successResponse<T extends Record<string, unknown>>(
  data: T,
  message: string = 'Success',
): { success: true; message: string } & T {
  return {
    success: true,
    message,
    ...data,
  };
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };
}

// ===========================================
// Webhook Event Types (for logging - FR-015)
// ===========================================

export type WebhookEventType =
  | 'brief_requested'
  | 'context_gathered'
  | 'brief_generated'
  | 'brief_delivered'
  | 'brief_failed'
  | 'analysis_requested'
  | 'analysis_completed'
  | 'crm_updated';

export const WebhookEventSchema = z.object({
  event_type: z.enum([
    'brief_requested',
    'context_gathered',
    'brief_generated',
    'brief_delivered',
    'brief_failed',
    'analysis_requested',
    'analysis_completed',
    'crm_updated',
  ]),
  timestamp: z.string().datetime({ offset: true }),
  meeting_id: z.string(),
  brain_id: z.string().min(1),
  brief_id: z.string().uuid().optional(),
  analysis_id: z.string().uuid().optional(),
  duration_ms: z.number().int().min(0).optional(),
  metadata: z.record(z.any()).optional(),
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
