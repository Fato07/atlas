/**
 * Webhook API Contract
 *
 * Defines the webhook endpoint for single lead scoring.
 * This contract is used by:
 * - n8n workflow (caller)
 * - Lead Scorer Agent (handler)
 *
 * @module contracts/webhook-api
 */

import { z } from 'zod';
import { LeadInputSchema, type LeadInput } from './lead-input';
import { ScoringResultSchema, type ScoringResult } from './scoring-result';

// ===========================================
// Webhook Request
// ===========================================

/**
 * Required headers for webhook authentication
 */
export const WEBHOOK_SECRET_HEADER = 'X-Webhook-Secret';

/**
 * Request body schema (extends LeadInput with optional flags)
 */
export const WebhookRequestSchema = LeadInputSchema.extend({
  /**
   * Force re-scoring even if lead was previously scored
   * Per FR-014: Allow re-scoring via explicit force_rescore flag
   */
  force_rescore: z
    .boolean()
    .optional()
    .default(false)
    .describe('Force re-scoring even if lead was previously scored'),

  /**
   * Callback URL for async results (optional)
   */
  callback_url: z
    .string()
    .url()
    .optional()
    .describe('URL to POST results when scoring completes'),
});

export type WebhookRequest = z.infer<typeof WebhookRequestSchema>;

// ===========================================
// Webhook Response
// ===========================================

/**
 * Success response - scoring completed
 */
export const WebhookSuccessResponseSchema = z.object({
  success: z.literal(true),
  data: ScoringResultSchema,
});

export type WebhookSuccessResponse = z.infer<typeof WebhookSuccessResponseSchema>;

/**
 * Error response - scoring failed
 */
export const WebhookErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.enum([
      'INVALID_INPUT',       // Request body validation failed
      'AUTH_FAILED',         // Missing or invalid X-Webhook-Secret
      'SECURITY_BLOCKED',    // Blocked by Lakera Guard (prompt injection, etc.)
      'BRAIN_NOT_FOUND',     // No brain found for vertical
      'SCORING_FAILED',      // Internal scoring error
      'RATE_LIMITED',        // Too many requests
      'TIMEOUT',             // Request timed out
    ]),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type WebhookErrorResponse = z.infer<typeof WebhookErrorResponseSchema>;

/**
 * Skipped response - lead already scored
 */
export const WebhookSkippedResponseSchema = z.object({
  success: z.literal(true),
  skipped: z.literal(true),
  reason: z.enum([
    'ALREADY_SCORED',        // Lead has existing score, force_rescore=false
    'NEEDS_ENRICHMENT',      // Too many missing fields
  ]),
  existing_score: z.number().optional(),
  scored_at: z.string().datetime().optional(),
});

export type WebhookSkippedResponse = z.infer<typeof WebhookSkippedResponseSchema>;

/**
 * Combined response type
 */
export const WebhookResponseSchema = z.discriminatedUnion('success', [
  WebhookSuccessResponseSchema,
  WebhookErrorResponseSchema,
]).or(WebhookSkippedResponseSchema);

export type WebhookResponse = z.infer<typeof WebhookResponseSchema>;

// ===========================================
// HTTP Status Codes
// ===========================================

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  TIMEOUT: 504,
} as const;

/**
 * Map error codes to HTTP status
 */
export function errorCodeToHttpStatus(
  code: WebhookErrorResponse['error']['code']
): number {
  switch (code) {
    case 'INVALID_INPUT':
      return HTTP_STATUS.BAD_REQUEST;
    case 'AUTH_FAILED':
      return HTTP_STATUS.UNAUTHORIZED;
    case 'SECURITY_BLOCKED':
      return HTTP_STATUS.FORBIDDEN;
    case 'RATE_LIMITED':
      return HTTP_STATUS.TOO_MANY_REQUESTS;
    case 'TIMEOUT':
      return HTTP_STATUS.TIMEOUT;
    case 'BRAIN_NOT_FOUND':
    case 'SCORING_FAILED':
    default:
      return HTTP_STATUS.INTERNAL_ERROR;
  }
}

// ===========================================
// Request Validation
// ===========================================

/**
 * Validate webhook authentication
 * Per FR-020: Validate webhook requests using shared secret token
 */
export function validateWebhookAuth(
  headers: Headers | Record<string, string>,
  expectedSecret: string
): { valid: boolean; error?: string } {
  const secret =
    headers instanceof Headers
      ? headers.get(WEBHOOK_SECRET_HEADER)
      : headers[WEBHOOK_SECRET_HEADER];

  if (!secret) {
    return {
      valid: false,
      error: `Missing ${WEBHOOK_SECRET_HEADER} header`,
    };
  }

  if (secret !== expectedSecret) {
    return {
      valid: false,
      error: 'Invalid webhook secret',
    };
  }

  return { valid: true };
}

/**
 * Validate webhook request body
 */
export function validateWebhookRequest(body: unknown): {
  valid: boolean;
  data?: WebhookRequest;
  errors?: string[];
} {
  const result = WebhookRequestSchema.safeParse(body);

  if (result.success) {
    return { valid: true, data: result.data };
  }

  return {
    valid: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    ),
  };
}

// ===========================================
// Response Builders
// ===========================================

/**
 * Build success response
 */
export function buildSuccessResponse(result: ScoringResult): WebhookSuccessResponse {
  return {
    success: true,
    data: result,
  };
}

/**
 * Build error response
 */
export function buildErrorResponse(
  code: WebhookErrorResponse['error']['code'],
  message: string,
  details?: Record<string, unknown>
): WebhookErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };
}

/**
 * Build skipped response
 */
export function buildSkippedResponse(
  reason: WebhookSkippedResponse['reason'],
  existingScore?: number,
  scoredAt?: string
): WebhookSkippedResponse {
  return {
    success: true,
    skipped: true,
    reason,
    ...(existingScore !== undefined && { existing_score: existingScore }),
    ...(scoredAt && { scored_at: scoredAt }),
  };
}

// ===========================================
// API Documentation
// ===========================================

/**
 * OpenAPI-style endpoint documentation
 */
export const WEBHOOK_API_DOC = {
  endpoint: '/webhook/score-lead',
  method: 'POST',
  description: 'Score a single lead against ICP rules',

  headers: {
    required: {
      [WEBHOOK_SECRET_HEADER]: 'Shared secret for authentication',
      'Content-Type': 'application/json',
    },
  },

  request: {
    body: 'WebhookRequest (LeadInput + force_rescore flag)',
  },

  responses: {
    200: {
      description: 'Success - lead scored or skipped',
      body: 'WebhookSuccessResponse | WebhookSkippedResponse',
    },
    400: {
      description: 'Invalid request body',
      body: 'WebhookErrorResponse (code: INVALID_INPUT)',
    },
    401: {
      description: 'Authentication failed',
      body: 'WebhookErrorResponse (code: AUTH_FAILED)',
    },
    429: {
      description: 'Rate limited',
      body: 'WebhookErrorResponse (code: RATE_LIMITED)',
    },
    500: {
      description: 'Internal error',
      body: 'WebhookErrorResponse (code: SCORING_FAILED | BRAIN_NOT_FOUND)',
    },
    504: {
      description: 'Request timeout',
      body: 'WebhookErrorResponse (code: TIMEOUT)',
    },
  },

  performance: {
    timeout: '10s',
    target_latency: '<2s',
  },
} as const;
