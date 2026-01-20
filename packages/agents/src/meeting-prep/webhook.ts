/**
 * Meeting Prep Agent - Webhook HTTP Handler
 *
 * Provides HTTP endpoints for:
 * - POST /webhook/meeting-prep/brief         - Receive calendar webhooks (30 min before meeting)
 * - POST /webhook/meeting-prep/brief/manual  - Manual brief request
 * - POST /webhook/meeting-prep/analyze       - Receive transcript for analysis
 * - GET  /webhook/meeting-prep/brief/:id/status - Check brief status
 * - GET  /webhook/meeting-prep/health        - Health check
 *
 * Implements FR-001 (calendar webhook), FR-007 (manual request).
 *
 * @module meeting-prep/webhook
 */

import { z } from 'zod';
import type { MeetingPrepAgent } from './agent';
import type {
  BriefWebhookRequest,
  BriefWebhookResponse,
  ManualBriefWebhookRequest,
  AnalysisWebhookRequest,
  AnalysisWebhookResponse,
  HealthCheckResponse,
  BriefStatusResponse,
  ErrorResponse,
} from './contracts/webhook-api';
import {
  BriefWebhookRequestSchema,
  ManualBriefWebhookRequestSchema,
  AnalysisWebhookRequestSchema,
  WebhookAuthHeaderSchema,
  ErrorCodes,
  errorResponse as createErrorResponse,
} from './contracts/webhook-api';

// ===========================================
// Webhook Configuration
// ===========================================

export interface MeetingPrepWebhookConfig {
  /** Port to listen on */
  port: number;

  /** Webhook secret for authentication */
  webhookSecret: string;

  /** The agent instance to handle requests */
  agent: MeetingPrepAgent;

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

function httpErrorResponse(
  message: string,
  status: number,
  code?: string
): Response {
  return jsonResponse(
    {
      success: false,
      error: {
        code: code ?? `ERR_${status}`,
        message,
      },
    },
    status
  );
}

function corsHeaders(config: MeetingPrepWebhookConfig): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': config.cors?.origin ?? '*',
    'Access-Control-Allow-Methods': (config.cors?.methods ?? ['GET', 'POST', 'OPTIONS']).join(', '),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret',
  };
}

// ===========================================
// Request Verification
// ===========================================

/**
 * Verify webhook secret (timing-safe comparison)
 */
function verifyWebhookSecret(request: Request, secret: string): boolean {
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

// ===========================================
// Health Check Response
// ===========================================

let serverStartTime: number;

function buildHealthResponse(agent: MeetingPrepAgent): HealthCheckResponse {
  const now = Date.now();
  const uptimeSeconds = serverStartTime ? (now - serverStartTime) / 1000 : 0;

  // Get last brief and analysis times from state
  const stateManager = agent.getStateManager();
  let lastBriefAt: string | null = null;
  let lastAnalysisAt: string | null = null;

  if (stateManager) {
    const state = stateManager.getState();
    if (state.recent_briefs.length > 0) {
      lastBriefAt = state.recent_briefs[state.recent_briefs.length - 1].delivered_at;
    }
    if (state.recent_analyses.length > 0) {
      lastAnalysisAt = state.recent_analyses[state.recent_analyses.length - 1].analyzed_at;
    }
  }

  return {
    status: 'healthy',
    version: process.env.npm_package_version ?? '0.1.0',
    uptime_seconds: uptimeSeconds,
    checks: {
      qdrant: 'ok', // TODO: Add actual health checks
      slack: 'ok',
      attio: 'ok',
      airtable: 'ok',
    },
    last_brief_at: lastBriefAt,
    last_analysis_at: lastAnalysisAt,
  };
}

// ===========================================
// Route Handlers
// ===========================================

/**
 * POST /webhook/meeting-prep/brief
 * Handle calendar webhook for brief generation
 */
async function handleBriefWebhook(
  request: Request,
  config: MeetingPrepWebhookConfig
): Promise<Response> {
  // Verify webhook secret
  if (!verifyWebhookSecret(request, config.webhookSecret)) {
    return httpErrorResponse(
      'Invalid webhook secret',
      HTTP_STATUS.UNAUTHORIZED,
      ErrorCodes.INVALID_SECRET
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return httpErrorResponse(
      'Invalid JSON body',
      HTTP_STATUS.BAD_REQUEST,
      ErrorCodes.INVALID_REQUEST
    );
  }

  // Validate payload
  const parseResult = BriefWebhookRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return httpErrorResponse(
      `Invalid payload: ${parseResult.error.message}`,
      HTTP_STATUS.BAD_REQUEST,
      ErrorCodes.INVALID_REQUEST
    );
  }

  // Process the brief request
  try {
    const result = await config.agent.generateBriefFromWebhook(parseResult.data);

    return jsonResponse(result, result.success ? HTTP_STATUS.OK : HTTP_STATUS.INTERNAL_ERROR);
  } catch (error) {
    console.error('Brief generation error:', error);
    return httpErrorResponse(
      'Failed to generate brief',
      HTTP_STATUS.INTERNAL_ERROR,
      ErrorCodes.BRIEF_GENERATION_FAILED
    );
  }
}

/**
 * POST /webhook/meeting-prep/brief/manual
 * Handle manual brief request
 */
async function handleManualBriefWebhook(
  request: Request,
  config: MeetingPrepWebhookConfig
): Promise<Response> {
  // Verify webhook secret
  if (!verifyWebhookSecret(request, config.webhookSecret)) {
    return httpErrorResponse(
      'Invalid webhook secret',
      HTTP_STATUS.UNAUTHORIZED,
      ErrorCodes.INVALID_SECRET
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return httpErrorResponse(
      'Invalid JSON body',
      HTTP_STATUS.BAD_REQUEST,
      ErrorCodes.INVALID_REQUEST
    );
  }

  // Validate payload
  const parseResult = ManualBriefWebhookRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return httpErrorResponse(
      `Invalid payload: ${parseResult.error.message}`,
      HTTP_STATUS.BAD_REQUEST,
      ErrorCodes.INVALID_REQUEST
    );
  }

  // Process the manual brief request
  try {
    const result = await config.agent.generateBriefManual(parseResult.data);

    return jsonResponse(result, result.success ? HTTP_STATUS.OK : HTTP_STATUS.INTERNAL_ERROR);
  } catch (error) {
    console.error('Manual brief generation error:', error);
    return httpErrorResponse(
      'Failed to generate brief',
      HTTP_STATUS.INTERNAL_ERROR,
      ErrorCodes.BRIEF_GENERATION_FAILED
    );
  }
}

/**
 * POST /webhook/meeting-prep/analyze
 * Handle transcript analysis request
 */
async function handleAnalyzeWebhook(
  request: Request,
  config: MeetingPrepWebhookConfig
): Promise<Response> {
  // Verify webhook secret
  if (!verifyWebhookSecret(request, config.webhookSecret)) {
    return httpErrorResponse(
      'Invalid webhook secret',
      HTTP_STATUS.UNAUTHORIZED,
      ErrorCodes.INVALID_SECRET
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return httpErrorResponse(
      'Invalid JSON body',
      HTTP_STATUS.BAD_REQUEST,
      ErrorCodes.INVALID_REQUEST
    );
  }

  // Validate payload
  const parseResult = AnalysisWebhookRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return httpErrorResponse(
      `Invalid payload: ${parseResult.error.message}`,
      HTTP_STATUS.BAD_REQUEST,
      ErrorCodes.INVALID_REQUEST
    );
  }

  // Process the analysis request
  try {
    const result = await config.agent.analyzeTranscript(parseResult.data);

    return jsonResponse(result, result.success ? HTTP_STATUS.OK : HTTP_STATUS.INTERNAL_ERROR);
  } catch (error) {
    console.error('Transcript analysis error:', error);
    return httpErrorResponse(
      'Failed to analyze transcript',
      HTTP_STATUS.INTERNAL_ERROR,
      ErrorCodes.ANALYSIS_FAILED
    );
  }
}

/**
 * GET /webhook/meeting-prep/brief/:id/status
 * Check brief generation status
 */
async function handleBriefStatus(
  briefId: string,
  config: MeetingPrepWebhookConfig
): Promise<Response> {
  // Get state manager from agent
  const stateManager = config.agent.getStateManager();

  if (!stateManager) {
    return httpErrorResponse(
      'Agent not initialized',
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ErrorCodes.INTERNAL_ERROR
    );
  }

  // Look up brief in state
  const state = stateManager.getState();

  // Check recent briefs first (delivered)
  const recentBrief = state.recent_briefs.find((b) => b.brief_id === briefId);

  if (recentBrief) {
    const response: BriefStatusResponse = {
      brief_id: recentBrief.brief_id,
      meeting_id: recentBrief.meeting_id,
      status: 'delivered',
      delivered_at: recentBrief.delivered_at,
      slack_message_ts: null, // TODO: Store this in state
      error: null,
    };
    return jsonResponse(response);
  }

  // Check for errors with this brief
  const errorEntry = state.errors.find(
    (e) => e.meeting_id === briefId || briefId.includes(e.meeting_id)
  );

  if (errorEntry && errorEntry.operation === 'brief_generation') {
    // Find the meeting for this error
    const meeting = state.upcoming_meetings.find((m) => m.meeting_id === errorEntry.meeting_id);

    const response: BriefStatusResponse = {
      brief_id: briefId,
      meeting_id: errorEntry.meeting_id,
      status: 'failed',
      delivered_at: null,
      slack_message_ts: null,
      error: {
        code: errorEntry.error_code,
        message: errorEntry.message,
        retry_count: errorEntry.retry_count,
      },
    };
    return jsonResponse(response);
  }

  // Check if there's a pending/generating brief for an upcoming meeting
  const upcomingMeeting = state.upcoming_meetings.find(
    (m) => m.brief_id === briefId || m.meeting_id === briefId
  );

  if (upcomingMeeting) {
    const response: BriefStatusResponse = {
      brief_id: upcomingMeeting.brief_id || briefId,
      meeting_id: upcomingMeeting.meeting_id,
      status: upcomingMeeting.brief_status,
      delivered_at: null,
      slack_message_ts: null,
      error: null,
    };
    return jsonResponse(response);
  }

  // Brief not found
  return httpErrorResponse(
    'Brief not found',
    HTTP_STATUS.NOT_FOUND,
    ErrorCodes.MEETING_NOT_FOUND
  );
}

// ===========================================
// Main Request Handler
// ===========================================

export function createRequestHandler(config: MeetingPrepWebhookConfig) {
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
      if (path === '/webhook/meeting-prep/health' && method === 'GET') {
        return jsonResponse(buildHealthResponse(config.agent), HTTP_STATUS.OK, cors);
      }

      // Brief webhook (calendar trigger)
      if (path === '/webhook/meeting-prep/brief' && method === 'POST') {
        const response = await handleBriefWebhook(request, config);
        for (const [key, value] of Object.entries(cors)) {
          response.headers.set(key, value);
        }
        return response;
      }

      // Manual brief request
      if (path === '/webhook/meeting-prep/brief/manual' && method === 'POST') {
        const response = await handleManualBriefWebhook(request, config);
        for (const [key, value] of Object.entries(cors)) {
          response.headers.set(key, value);
        }
        return response;
      }

      // Analyze transcript
      if (path === '/webhook/meeting-prep/analyze' && method === 'POST') {
        const response = await handleAnalyzeWebhook(request, config);
        for (const [key, value] of Object.entries(cors)) {
          response.headers.set(key, value);
        }
        return response;
      }

      // Brief status
      const statusMatch = path.match(/^\/webhook\/meeting-prep\/brief\/([a-zA-Z0-9-]+)\/status$/);
      if (statusMatch && method === 'GET') {
        const response = await handleBriefStatus(statusMatch[1], config);
        for (const [key, value] of Object.entries(cors)) {
          response.headers.set(key, value);
        }
        return response;
      }

      // 404 for unknown routes
      return httpErrorResponse('Not found', HTTP_STATUS.NOT_FOUND, 'ERR_NOT_FOUND');
    } catch (error) {
      console.error('Unhandled error:', error);
      return httpErrorResponse('Internal server error', HTTP_STATUS.INTERNAL_ERROR);
    }
  };
}

// ===========================================
// Server Factory
// ===========================================

/**
 * Create and start webhook server
 */
export function createWebhookServer(config: MeetingPrepWebhookConfig) {
  serverStartTime = Date.now();

  const handler = createRequestHandler(config);

  const server = Bun.serve({
    port: config.port,
    fetch: handler,
  });

  console.log(`Meeting Prep webhook server listening on port ${config.port}`);

  return server;
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
