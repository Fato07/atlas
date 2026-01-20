/**
 * Webhook API Schema
 *
 * Defines schemas for Learning Loop webhook endpoints,
 * request/response contracts, and authentication.
 *
 * @module learning-loop/contracts/webhook-api
 */

import { z } from 'zod';
import { InsightCategorySchema, InsightImportanceSchema } from './insight';
import { TemplateOutcomeSchema } from './template-stats';

// ===========================================
// Authentication
// ===========================================

export const WebhookAuthHeadersSchema = z.object({
  'x-webhook-secret': z.string().min(1).describe('Webhook authentication secret'),
});

export type WebhookAuthHeaders = z.infer<typeof WebhookAuthHeadersSchema>;

// ===========================================
// POST /webhook/learning-loop/insight
// Trigger insight extraction from conversation
// ===========================================

export const InsightExtractionRequestSchema = z.object({
  source_type: z.enum(['email_reply', 'call_transcript']).describe('FR-001, FR-002'),
  source_id: z.string().min(1).describe('Unique ID of source document'),
  content: z.string().min(10).max(50000).describe('Content to analyze'),
  thread_context: z.string().max(20000).optional().describe('Previous messages for context'),
  lead: z.object({
    id: z.string().min(1),
    company_id: z.string().optional(),
    company_name: z.string().optional(),
    industry: z.string().optional(),
    title: z.string().optional(),
  }),
  brain_id: z.string().min(1),
  template_used_id: z.string().optional().describe('Template ID if template was used'),
  template_outcome: TemplateOutcomeSchema.optional().describe('Outcome if known'),
});

export type InsightExtractionRequest = z.infer<typeof InsightExtractionRequestSchema>;

export const InsightExtractionResponseSchema = z.object({
  success: z.literal(true),
  job_id: z.string().min(1).describe('Async job ID for tracking'),
  estimated_ms: z.number().int().min(0).describe('Estimated processing time'),
});

export type InsightExtractionResponse = z.infer<typeof InsightExtractionResponseSchema>;

export const InsightExtractionErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.enum([
    'INVALID_REQUEST',
    'BRAIN_NOT_FOUND',
    'RATE_LIMITED',
    'INTERNAL_ERROR',
  ]),
});

export type InsightExtractionError = z.infer<typeof InsightExtractionErrorSchema>;

// ===========================================
// POST /webhook/learning-loop/validate
// Slack interaction callback
// ===========================================

export const ValidationCallbackRequestSchema = z.object({
  type: z.literal('block_actions'),
  user: z.object({
    id: z.string().min(1),
    username: z.string().min(1),
    name: z.string().min(1),
  }),
  actions: z
    .array(
      z.object({
        action_id: z.enum([
          'insight_approve',
          'insight_reject',
          'insight_approve_with_note',
        ]),
        value: z.string(),
        block_id: z.string().optional(),
      })
    )
    .min(1),
  response_url: z.string().url(),
  message: z.object({
    ts: z.string(),
  }),
  channel: z.object({
    id: z.string(),
  }),
  trigger_id: z.string().optional(),
});

export type ValidationCallbackRequest = z.infer<typeof ValidationCallbackRequestSchema>;

// Response is sent to response_url
export const ValidationCallbackResponseSchema = z.object({
  replace_original: z.boolean(),
  text: z.string().optional(),
  blocks: z.array(z.any()).optional(),
});

export type ValidationCallbackResponse = z.infer<typeof ValidationCallbackResponseSchema>;

// ===========================================
// POST /webhook/learning-loop/synthesis
// Trigger weekly synthesis report
// ===========================================

export const SynthesisRequestSchema = z.object({
  brain_id: z.string().min(1),
  week_start: z.string().datetime({ offset: true }).optional().describe('Override week start'),
  week_end: z.string().datetime({ offset: true }).optional().describe('Override week end'),
  slack_channel: z.string().min(1),
});

export type SynthesisRequest = z.infer<typeof SynthesisRequestSchema>;

export const SynthesisResponseSchema = z.object({
  success: z.literal(true),
  synthesis_id: z.string().min(1),
  estimated_ms: z.number().int().min(0),
});

export type SynthesisResponse = z.infer<typeof SynthesisResponseSchema>;

export const SynthesisErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.enum([
    'INVALID_REQUEST',
    'BRAIN_NOT_FOUND',
    'NO_DATA_FOR_PERIOD',
    'RATE_LIMITED',
    'INTERNAL_ERROR',
  ]),
});

export type SynthesisError = z.infer<typeof SynthesisErrorSchema>;

// ===========================================
// POST /webhook/learning-loop/template-outcome
// Record template outcome for performance tracking
// ===========================================

export const TemplateOutcomeRequestSchema = z.object({
  template_id: z.string().min(1),
  brain_id: z.string().min(1),
  lead_id: z.string().min(1),
  reply_id: z.string().min(1),
  outcome: TemplateOutcomeSchema,
});

export type TemplateOutcomeRequest = z.infer<typeof TemplateOutcomeRequestSchema>;

export const TemplateOutcomeResponseSchema = z.object({
  success: z.literal(true),
  template_id: z.string(),
  new_success_rate: z.number().min(0).max(1),
  times_used: z.number().int().min(0),
});

export type TemplateOutcomeResponse = z.infer<typeof TemplateOutcomeResponseSchema>;

// ===========================================
// GET /webhook/learning-loop/health
// Health check endpoint
// ===========================================

export const HealthCheckResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string(),
  uptime_seconds: z.number().int().min(0),
  dependencies: z.object({
    qdrant: z.enum(['connected', 'disconnected']),
    redis: z.enum(['connected', 'disconnected']),
    slack: z.enum(['connected', 'disconnected']),
  }),
  metrics: z.object({
    insights_processed_24h: z.number().int().min(0),
    validations_pending: z.number().int().min(0),
    avg_extraction_ms: z.number().min(0),
  }),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

// ===========================================
// GET /webhook/learning-loop/queue/:brain_id
// Get validation queue status
// ===========================================

export const QueueStatusResponseSchema = z.object({
  brain_id: z.string(),
  pending_count: z.number().int().min(0),
  approved_today: z.number().int().min(0),
  rejected_today: z.number().int().min(0),
  avg_decision_time_ms: z.number().min(0).nullable(),
  oldest_pending: z
    .object({
      id: z.string(),
      created_at: z.string().datetime({ offset: true }),
      category: InsightCategorySchema,
      importance: InsightImportanceSchema,
    })
    .nullable(),
});

export type QueueStatusResponse = z.infer<typeof QueueStatusResponseSchema>;

// ===========================================
// GET /webhook/learning-loop/stats/:brain_id
// Get learning loop statistics
// ===========================================

export const StatsResponseSchema = z.object({
  brain_id: z.string(),
  period: z.object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  }),
  insights: z.object({
    total_extracted: z.number().int().min(0),
    total_validated: z.number().int().min(0),
    total_rejected: z.number().int().min(0),
    total_auto_approved: z.number().int().min(0),
    kb_growth: z.number().int(),
    by_category: z.record(InsightCategorySchema, z.number().int()),
  }),
  templates: z.object({
    total_tracked: z.number().int().min(0),
    total_usage: z.number().int().min(0),
    avg_success_rate: z.number().min(0).max(1),
    top_performer: z
      .object({
        template_id: z.string(),
        success_rate: z.number(),
      })
      .nullable(),
  }),
  performance: z.object({
    avg_extraction_ms: z.number().min(0),
    avg_validation_time_ms: z.number().min(0),
    queue_throughput_per_day: z.number().min(0),
  }),
});

export type StatsResponse = z.infer<typeof StatsResponseSchema>;

// ===========================================
// Webhook Error Codes
// ===========================================

export const WebhookErrorCodes = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  BRAIN_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  NO_DATA_FOR_PERIOD: 404,
  INTERNAL_ERROR: 500,
} as const;

export type WebhookErrorCode = keyof typeof WebhookErrorCodes;

// ===========================================
// Webhook Authentication Helper
// ===========================================

export function validateWebhookSecret(
  headers: Record<string, string | undefined>,
  expectedSecret: string
): boolean {
  const providedSecret = headers['x-webhook-secret'];
  return providedSecret === expectedSecret;
}

// ===========================================
// Route Definitions
// ===========================================

export const WEBHOOK_ROUTES = {
  INSIGHT_EXTRACT: '/webhook/learning-loop/insight',
  VALIDATION_CALLBACK: '/webhook/learning-loop/validate',
  SYNTHESIS: '/webhook/learning-loop/synthesis',
  TEMPLATE_OUTCOME: '/webhook/learning-loop/template-outcome',
  HEALTH: '/webhook/learning-loop/health',
  QUEUE_STATUS: '/webhook/learning-loop/queue/:brain_id',
  STATS: '/webhook/learning-loop/stats/:brain_id',
} as const;

// ===========================================
// HTTP Status Constants
// ===========================================

export const HTTP_STATUS = {
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;
