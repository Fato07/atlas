/**
 * Reply Handler Agent - Webhook API Contract
 *
 * Defines the HTTP webhook API for receiving replies from n8n
 * and handling Slack interactive callbacks.
 *
 * @module reply-handler/contracts/webhook-api
 */

import { z } from 'zod';
import { ReplyInputSchema, InstantlyWebhookPayloadSchema } from './reply-input';
import { ReplyHandlerResultSchema } from './handler-result';

// ===========================================
// Webhook Endpoints
// ===========================================

/**
 * POST /webhook/reply-handler
 *
 * Main endpoint for receiving reply webhooks from n8n.
 * Accepts either a ReplyInput (pre-processed) or InstantlyWebhookPayload (raw).
 */
export const ReplyWebhookEndpoint = {
  method: 'POST' as const,
  path: '/webhook/reply-handler',
  headers: {
    'Content-Type': 'application/json',
    'X-Webhook-Secret': z.string().min(1),
  },
  body: z.union([ReplyInputSchema, InstantlyWebhookPayloadSchema]),
  response: {
    200: ReplyHandlerResultSchema,
    400: z.object({
      error: z.literal('VALIDATION_ERROR'),
      message: z.string(),
      details: z.array(z.object({
        path: z.string(),
        message: z.string(),
      })),
    }),
    401: z.object({
      error: z.literal('UNAUTHORIZED'),
      message: z.string(),
    }),
    500: z.object({
      error: z.literal('PROCESSING_ERROR'),
      message: z.string(),
      reply_id: z.string().optional(),
    }),
  },
};

// ===========================================
// Slack Callback Endpoints
// ===========================================

/**
 * Slack interactive callback payload
 */
export const SlackActionPayloadSchema = z.object({
  type: z.literal('block_actions'),
  user: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
  }),
  channel: z.object({
    id: z.string(),
    name: z.string(),
  }),
  message: z.object({
    ts: z.string(),
    text: z.string().optional(),
  }),
  actions: z.array(z.object({
    action_id: z.enum(['approve', 'edit', 'reject', 'escalate']),
    value: z.string(), // JSON-encoded draft context
    type: z.literal('button'),
  })),
  trigger_id: z.string(), // Required for opening modals
  response_url: z.string().url(),
});

export type SlackActionPayload = z.infer<typeof SlackActionPayloadSchema>;

/**
 * Slack modal submission payload
 */
export const SlackModalSubmissionSchema = z.object({
  type: z.literal('view_submission'),
  user: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
  }),
  view: z.object({
    id: z.string(),
    callback_id: z.literal('edit_draft_modal'),
    private_metadata: z.string(), // JSON-encoded draft context
    state: z.object({
      values: z.record(z.record(z.object({
        value: z.string(),
      }))),
    }),
  }),
});

export type SlackModalSubmission = z.infer<typeof SlackModalSubmissionSchema>;

/**
 * POST /webhook/slack-action
 *
 * Endpoint for receiving Slack interactive callbacks.
 */
export const SlackActionEndpoint = {
  method: 'POST' as const,
  path: '/webhook/slack-action',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Slack-Signature': z.string(),
    'X-Slack-Request-Timestamp': z.string(),
  },
  body: z.object({
    payload: z.string(), // JSON-encoded SlackActionPayload or SlackModalSubmission
  }),
  response: {
    200: z.object({
      success: z.boolean(),
      action: z.string(),
      message_ts: z.string().optional(),
    }),
    400: z.object({
      error: z.string(),
      message: z.string(),
    }),
    401: z.object({
      error: z.literal('INVALID_SIGNATURE'),
      message: z.string(),
    }),
  },
};

// ===========================================
// Health Check Endpoint
// ===========================================

/**
 * GET /webhook/reply-handler/health
 *
 * Health check endpoint for monitoring.
 */
export const HealthCheckEndpoint = {
  method: 'GET' as const,
  path: '/webhook/reply-handler/health',
  response: {
    200: z.object({
      status: z.literal('healthy'),
      version: z.string(),
      uptime_seconds: z.number(),
      last_reply_processed_at: z.string().datetime().optional(),
      pending_drafts: z.number().int().nonnegative(),
    }),
    503: z.object({
      status: z.literal('unhealthy'),
      error: z.string(),
    }),
  },
};

// ===========================================
// Draft Status Endpoint
// ===========================================

/**
 * GET /webhook/reply-handler/drafts/:draftId
 *
 * Check status of a pending draft.
 */
export const DraftStatusEndpoint = {
  method: 'GET' as const,
  path: '/webhook/reply-handler/drafts/:draftId',
  params: z.object({
    draftId: z.string(),
  }),
  response: {
    200: z.object({
      id: z.string(),
      status: z.enum(['pending', 'approved', 'approved_edited', 'rejected', 'escalated', 'expired']),
      response_text: z.string(),
      expires_at: z.string().datetime(),
      created_at: z.string().datetime(),
      resolved_at: z.string().datetime().optional(),
      resolved_by: z.string().optional(),
    }),
    404: z.object({
      error: z.literal('DRAFT_NOT_FOUND'),
      message: z.string(),
    }),
  },
};

// ===========================================
// Webhook Security
// ===========================================

/**
 * Verify webhook secret header
 */
export function verifyWebhookSecret(
  header: string | undefined,
  expectedSecret: string
): boolean {
  if (!header) return false;
  // Use constant-time comparison to prevent timing attacks
  if (header.length !== expectedSecret.length) return false;
  let result = 0;
  for (let i = 0; i < header.length; i++) {
    result |= header.charCodeAt(i) ^ expectedSecret.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify Slack request signature
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  // Check timestamp to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  if (Math.abs(now - requestTime) > 60 * 5) {
    return false; // Request older than 5 minutes
  }

  // Compute expected signature using Bun's native crypto
  const sigBasestring = `v0:${timestamp}:${body}`;
  const hasher = new Bun.CryptoHasher('sha256', signingSecret);
  hasher.update(sigBasestring);
  const expectedSignature = 'v0=' + hasher.digest('hex');

  // Constant-time comparison
  if (signature.length !== expectedSignature.length) return false;
  let diff = 0;
  for (let i = 0; i < signature.length; i++) {
    diff |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  return diff === 0;
}

// ===========================================
// Error Response Helpers
// ===========================================

export interface WebhookError {
  error: string;
  message: string;
  reply_id?: string;
  details?: Array<{ path: string; message: string }>;
}

export function createValidationError(
  errors: Array<{ path: string; message: string }>
): WebhookError {
  return {
    error: 'VALIDATION_ERROR',
    message: 'Invalid request payload',
    details: errors,
  };
}

export function createUnauthorizedError(message: string): WebhookError {
  return {
    error: 'UNAUTHORIZED',
    message,
  };
}

export function createProcessingError(
  message: string,
  replyId?: string
): WebhookError {
  return {
    error: 'PROCESSING_ERROR',
    message,
    reply_id: replyId,
  };
}

// ===========================================
// Response Status Codes
// ===========================================

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// ===========================================
// n8n Workflow Node Types
// ===========================================

/**
 * Expected n8n workflow structure for reply handling
 */
export interface N8nReplyHandlerWorkflow {
  nodes: {
    // Webhook trigger node
    webhook: {
      type: 'n8n-nodes-base.webhook';
      parameters: {
        httpMethod: 'POST';
        path: 'reply-handler';
        authentication: 'headerAuth';
        responseMode: 'responseNode';
      };
    };

    // Set brain_id from campaign metadata
    setBrainId: {
      type: 'n8n-nodes-base.set';
      parameters: {
        values: {
          string: Array<{
            name: 'brain_id';
            value: string; // Expression to extract brain_id
          }>;
        };
      };
    };

    // HTTP request to reply handler agent
    callAgent: {
      type: 'n8n-nodes-base.httpRequest';
      parameters: {
        method: 'POST';
        url: string; // Reply handler agent URL
        authentication: 'genericCredentialType';
        sendBody: true;
        bodyParameters: {
          parameters: Array<{
            name: string;
            value: string; // Expression referencing webhook data
          }>;
        };
      };
    };

    // Error handler
    errorHandler: {
      type: 'n8n-nodes-base.if';
      parameters: {
        conditions: {
          boolean: Array<{
            value1: string; // {{ $json.error }}
            operation: 'isNotEmpty';
          }>;
        };
      };
    };

    // Response node
    respond: {
      type: 'n8n-nodes-base.respondToWebhook';
      parameters: {
        responseCode: number;
        responseBody: string; // Expression
      };
    };
  };
}
