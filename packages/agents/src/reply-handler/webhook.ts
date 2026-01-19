/**
 * Reply Handler Agent - Webhook HTTP Handler
 *
 * Provides HTTP endpoints for:
 * - POST /webhook/reply - Receive reply webhooks from Instantly
 * - POST /webhook/slack - Handle Slack interactive callbacks
 * - GET /health - Health check endpoint
 * - GET /status/:draftId - Check draft status
 *
 * Implements FR-024 (webhook receiver), FR-025 (security).
 *
 * @module reply-handler/webhook
 */

// Bun server type
import { z } from 'zod';
import type { ReplyInput } from './contracts/reply-input';
import { parseReplyInput, webhookToReplyInput, InstantlyWebhookPayloadSchema } from './contracts/reply-input';
import type { ReplyHandlerResult } from './contracts/handler-result';
import type { SlackInteractivePayload } from './slack-flow';
import { verifySlackSignature } from './slack-flow';

// ===========================================
// Webhook Configuration
// ===========================================

export interface WebhookConfig {
  /** Port to listen on */
  port: number;

  /** Brain ID for scoped KB queries */
  brainId: string;

  /** Webhook secret for Instantly */
  instantlySecret: string;

  /** Slack signing secret */
  slackSigningSecret: string;

  /** Handler function for reply processing */
  handleReply: (input: ReplyInput) => Promise<ReplyHandlerResult>;

  /** Handler function for Slack interactive actions */
  handleSlackAction: (payload: SlackInteractivePayload) => Promise<{
    action: string;
    success: boolean;
    error?: string;
  }>;

  /** Get draft status function */
  getDraftStatus?: (draftId: string) => Promise<{
    status: string;
    createdAt: string;
    expiresAt?: string;
    resolvedAt?: string;
    resolvedBy?: string;
  } | null>;

  /** CORS configuration */
  cors?: {
    origin?: string;
    methods?: string[];
  };
}

// ===========================================
// HTTP Status Codes
// ===========================================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// ===========================================
// Response Helpers
// ===========================================

function jsonResponse(
  data: unknown,
  status: number = HTTP_STATUS.OK,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function errorResponse(
  message: string,
  status: number,
  code?: string
): Response {
  return jsonResponse(
    {
      error: true,
      message,
      code: code ?? `ERR_${status}`,
    },
    status
  );
}

function corsHeaders(config: WebhookConfig): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': config.cors?.origin ?? '*',
    'Access-Control-Allow-Methods': (config.cors?.methods ?? ['GET', 'POST', 'OPTIONS']).join(', '),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret, X-Slack-Signature, X-Slack-Request-Timestamp',
  };
}

// ===========================================
// Request Verification
// ===========================================

/**
 * Verify Instantly webhook secret
 */
function verifyInstantlySecret(request: Request, secret: string): boolean {
  const providedSecret = request.headers.get('X-Webhook-Secret');
  if (!providedSecret) return false;

  // Timing-safe comparison
  if (providedSecret.length !== secret.length) return false;

  let result = 0;
  for (let i = 0; i < secret.length; i++) {
    result |= providedSecret.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify Slack request signature
 */
async function verifySlackRequest(
  request: Request,
  body: string,
  signingSecret: string
): Promise<boolean> {
  const signature = request.headers.get('X-Slack-Signature');
  const timestamp = request.headers.get('X-Slack-Request-Timestamp');

  if (!signature || !timestamp) return false;

  return verifySlackSignature({
    signature,
    timestamp,
    body,
    signingSecret,
  });
}

// ===========================================
// Health Check Response
// ===========================================

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    message?: string;
  }[];
}

let serverStartTime: number;

function buildHealthResponse(): HealthCheckResponse {
  const now = Date.now();
  const uptime = serverStartTime ? (now - serverStartTime) / 1000 : 0;

  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.0.0',
    uptime,
    checks: [
      { name: 'webhook_receiver', status: 'pass' },
      { name: 'slack_integration', status: 'pass' },
      { name: 'reply_processor', status: 'pass' },
    ],
  };
}

// ===========================================
// Route Handlers
// ===========================================

async function handleReplyWebhook(
  request: Request,
  config: WebhookConfig
): Promise<Response> {
  // Verify Instantly secret
  if (!verifyInstantlySecret(request, config.instantlySecret)) {
    return errorResponse('Invalid webhook secret', HTTP_STATUS.UNAUTHORIZED, 'ERR_INVALID_SECRET');
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', HTTP_STATUS.BAD_REQUEST, 'ERR_INVALID_JSON');
  }

  // Validate Instantly webhook payload
  const parseResult = InstantlyWebhookPayloadSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(
      `Invalid webhook payload: ${parseResult.error.message}`,
      HTTP_STATUS.BAD_REQUEST,
      'ERR_INVALID_PAYLOAD'
    );
  }

  // Convert to ReplyInput
  const replyInput = webhookToReplyInput(parseResult.data, config.brainId);

  // Process the reply
  try {
    const result = await config.handleReply(replyInput);

    return jsonResponse({
      success: true,
      reply_id: result.reply_id,
      tier: result.routing.tier,
      action_type: result.action.type,
    }, HTTP_STATUS.OK);
  } catch (error) {
    console.error('Reply processing error:', error);
    return errorResponse(
      'Failed to process reply',
      HTTP_STATUS.INTERNAL_ERROR,
      'ERR_PROCESSING_FAILED'
    );
  }
}

async function handleSlackWebhook(
  request: Request,
  config: WebhookConfig
): Promise<Response> {
  // Get raw body for signature verification
  const rawBody = await request.text();

  // Verify Slack signature
  const isValid = await verifySlackRequest(request, rawBody, config.slackSigningSecret);
  if (!isValid) {
    return errorResponse('Invalid Slack signature', HTTP_STATUS.UNAUTHORIZED, 'ERR_INVALID_SIGNATURE');
  }

  // Parse payload
  let payload: SlackInteractivePayload;
  try {
    // Slack sends form-urlencoded with payload field
    const formData = new URLSearchParams(rawBody);
    const payloadStr = formData.get('payload');
    if (!payloadStr) {
      return errorResponse('Missing payload', HTTP_STATUS.BAD_REQUEST, 'ERR_MISSING_PAYLOAD');
    }
    payload = JSON.parse(payloadStr) as SlackInteractivePayload;
  } catch {
    return errorResponse('Invalid payload format', HTTP_STATUS.BAD_REQUEST, 'ERR_INVALID_FORMAT');
  }

  // Handle the action
  try {
    const result = await config.handleSlackAction(payload);

    // Slack expects 200 OK for successful handling
    if (result.success) {
      return new Response('', { status: HTTP_STATUS.OK });
    }

    // Return error response for display
    return jsonResponse({
      response_type: 'ephemeral',
      text: `Error: ${result.error ?? 'Unknown error'}`,
    });
  } catch (error) {
    console.error('Slack action error:', error);
    return jsonResponse({
      response_type: 'ephemeral',
      text: 'An error occurred while processing your action.',
    });
  }
}

async function handleDraftStatus(
  draftId: string,
  config: WebhookConfig
): Promise<Response> {
  if (!config.getDraftStatus) {
    return errorResponse('Status endpoint not configured', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }

  try {
    const status = await config.getDraftStatus(draftId);

    if (!status) {
      return errorResponse('Draft not found', HTTP_STATUS.NOT_FOUND, 'ERR_NOT_FOUND');
    }

    return jsonResponse({
      draft_id: draftId,
      ...status,
    });
  } catch (error) {
    console.error('Status check error:', error);
    return errorResponse('Failed to get status', HTTP_STATUS.INTERNAL_ERROR);
  }
}

// ===========================================
// Main Request Handler
// ===========================================

export function createRequestHandler(config: WebhookConfig) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Add CORS headers
    const cors = corsHeaders(config);

    // Handle OPTIONS (CORS preflight)
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Route handling
    try {
      // Health check
      if (path === '/health' && method === 'GET') {
        return jsonResponse(buildHealthResponse(), HTTP_STATUS.OK, cors);
      }

      // Reply webhook
      if (path === '/webhook/reply' && method === 'POST') {
        const response = await handleReplyWebhook(request, config);
        // Add CORS headers
        for (const [key, value] of Object.entries(cors)) {
          response.headers.set(key, value);
        }
        return response;
      }

      // Slack webhook
      if (path === '/webhook/slack' && method === 'POST') {
        const response = await handleSlackWebhook(request, config);
        for (const [key, value] of Object.entries(cors)) {
          response.headers.set(key, value);
        }
        return response;
      }

      // Draft status
      const statusMatch = path.match(/^\/status\/([a-zA-Z0-9_-]+)$/);
      if (statusMatch && method === 'GET') {
        const response = await handleDraftStatus(statusMatch[1], config);
        for (const [key, value] of Object.entries(cors)) {
          response.headers.set(key, value);
        }
        return response;
      }

      // 404 for unknown routes
      return errorResponse('Not found', HTTP_STATUS.NOT_FOUND, 'ERR_NOT_FOUND');
    } catch (error) {
      console.error('Unhandled error:', error);
      return errorResponse('Internal server error', HTTP_STATUS.INTERNAL_ERROR);
    }
  };
}

// ===========================================
// Server Factory
// ===========================================

/**
 * Create and start webhook server
 */
export function createWebhookServer(config: WebhookConfig) {
  serverStartTime = Date.now();

  const handler = createRequestHandler(config);

  const server = Bun.serve({
    port: config.port,
    fetch: handler,
  });

  console.log(`Reply Handler webhook server listening on port ${config.port}`);

  return server;
}

// ===========================================
// Express-style Middleware (for integration)
// ===========================================

/**
 * Create middleware for Bun HTTP server
 */
export function createWebhookMiddleware(config: WebhookConfig) {
  const handler = createRequestHandler(config);

  return {
    /**
     * Handle incoming request
     */
    async handle(request: Request): Promise<Response> {
      return handler(request);
    },

    /**
     * Check if path matches webhook routes
     */
    matches(path: string): boolean {
      return (
        path === '/health' ||
        path === '/webhook/reply' ||
        path === '/webhook/slack' ||
        path.startsWith('/status/')
      );
    },
  };
}

// ===========================================
// Request Parsing Utilities
// ===========================================

/**
 * Parse JSON body with validation
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ data: T } | { error: string }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: 'Invalid JSON body' };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return { error: result.error.message };
  }

  return { data: result.data };
}

/**
 * Extract client IP from request
 */
export function getClientIP(request: Request): string | undefined {
  // Check X-Forwarded-For header (from proxies)
  const forwarded = request.headers.get('X-Forwarded-For');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  // Check X-Real-IP header
  const realIP = request.headers.get('X-Real-IP');
  if (realIP) {
    return realIP;
  }

  return undefined;
}

/**
 * Rate limiting helper (in-memory, for development)
 */
const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  identifier: string,
  maxRequests: number = 100,
  windowMs: number = 60000
): boolean {
  const now = Date.now();
  const entry = requestCounts.get(identifier);

  if (!entry || entry.resetAt < now) {
    requestCounts.set(identifier, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}
