/**
 * Reply Handler Webhook Tests
 *
 * Tests for HTTP webhook endpoints, request validation, and routing.
 *
 * @module __tests__/reply-handler/webhook.test
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  createRequestHandler,
  createWebhookMiddleware,
  parseJsonBody,
  getClientIP,
  checkRateLimit,
  HTTP_STATUS,
} from '../../reply-handler/webhook';
import type { WebhookConfig } from '../../reply-handler/webhook';
import type { ReplyHandlerResult } from '../../reply-handler/contracts/handler-result';
import { z } from 'zod';

// ===========================================
// Mock Factories
// ===========================================

function createMockConfig(overrides?: Partial<WebhookConfig>): WebhookConfig {
  return {
    port: 3002,
    brainId: 'brain_fintech',
    instantlySecret: 'test-instantly-secret',
    heyreachSecret: 'test-heyreach-secret',
    slackSigningSecret: 'test-slack-secret',
    handleReply: mock(async () => ({
      reply_id: 'reply_12345',
      classification: {
        intent: 'positive_interest' as const,
        intent_confidence: 0.92,
        sentiment: 0.75,
        complexity: 'simple' as const,
        urgency: 'high' as const,
      },
      routing: {
        tier: 1 as const,
        reason: 'High confidence positive interest',
        override_applied: false,
      },
      action: {
        type: 'auto_response' as const,
        response_sent: true,
      },
      timestamps: {
        received_at: new Date().toISOString(),
        classified_at: new Date().toISOString(),
        routed_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
      metrics: {
        total_duration_ms: 250,
        classification_tokens: 150,
        response_tokens: 200,
      },
    })) as any,
    handleSlackAction: mock(async () => ({
      action: 'approve',
      success: true,
    })),
    getDraftStatus: mock(async () => ({
      status: 'pending',
      createdAt: new Date().toISOString(),
    })),
    ...overrides,
  };
}

function createMockRequest(
  path: string,
  method: string = 'GET',
  options?: {
    headers?: Record<string, string>;
    body?: unknown;
  }
): Request {
  const url = `http://localhost:3002${path}`;
  const init: RequestInit = {
    method,
    headers: options?.headers ?? {},
  };

  if (options?.body) {
    init.body = JSON.stringify(options.body);
    init.headers = {
      ...init.headers,
      'Content-Type': 'application/json',
    };
  }

  return new Request(url, init);
}

// ===========================================
// Request Handler Creation Tests
// ===========================================

describe('Request handler creation', () => {
  test('creates handler function', () => {
    const config = createMockConfig();
    const handler = createRequestHandler(config);

    expect(handler).toBeInstanceOf(Function);
  });
});

// ===========================================
// Health Check Endpoint Tests
// ===========================================

describe('Health check endpoint', () => {
  let handler: (request: Request) => Promise<Response>;

  beforeEach(() => {
    const config = createMockConfig();
    handler = createRequestHandler(config);
  });

  test('responds to GET /health', async () => {
    const request = createMockRequest('/health');
    const response = await handler(request);

    expect(response.status).toBe(HTTP_STATUS.OK);
    const data = await response.json();
    expect(data.status).toBe('healthy');
  });

  test('includes version and uptime', async () => {
    const request = createMockRequest('/health');
    const response = await handler(request);
    const data = await response.json();

    expect(data.timestamp).toBeDefined();
    expect(data.uptime).toBeDefined();
    expect(data.checks).toBeInstanceOf(Array);
  });

  test('includes all service checks', async () => {
    const request = createMockRequest('/health');
    const response = await handler(request);
    const data = await response.json();

    const checkNames = data.checks.map((c: any) => c.name);
    expect(checkNames).toContain('webhook_receiver');
    expect(checkNames).toContain('slack_integration');
    expect(checkNames).toContain('reply_processor');
  });
});

// ===========================================
// Reply Webhook Tests
// ===========================================

describe('Reply webhook endpoint', () => {
  let handler: (request: Request) => Promise<Response>;
  let config: WebhookConfig;

  beforeEach(() => {
    config = createMockConfig();
    handler = createRequestHandler(config);
  });

  test('rejects missing webhook secret', async () => {
    // Must use a valid Instantly payload structure - the generic endpoint
    // auto-detects source by parsing first, then validates auth
    const validPayload = {
      event: 'reply_received',
      timestamp: new Date().toISOString(),
      reply: {
        id: 'reply_123',
        message_id: 'msg_456',
        thread_id: 'thread_789',
        content: 'Test reply',
        received_at: new Date().toISOString(),
      },
      lead: {
        id: 'lead_001',
        email: 'test@example.com',
      },
      campaign: {
        id: 'camp_123',
        name: 'Test Campaign',
        sequence_step: 1,
      },
      account_id: 'acc_001',
      workspace_id: 'ws_001',
    };

    const request = createMockRequest('/webhook/reply', 'POST', {
      body: validPayload,
      // No X-Webhook-Secret header
    });

    const response = await handler(request);

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    const data = await response.json();
    expect(data.code).toBe('ERR_INVALID_SECRET');
  });

  test('rejects invalid webhook secret', async () => {
    // Must use a valid Instantly payload structure
    const validPayload = {
      event: 'reply_received',
      timestamp: new Date().toISOString(),
      reply: {
        id: 'reply_123',
        message_id: 'msg_456',
        thread_id: 'thread_789',
        content: 'Test reply',
        received_at: new Date().toISOString(),
      },
      lead: {
        id: 'lead_001',
        email: 'test@example.com',
      },
      campaign: {
        id: 'camp_123',
        name: 'Test Campaign',
        sequence_step: 1,
      },
      account_id: 'acc_001',
      workspace_id: 'ws_001',
    };

    const request = createMockRequest('/webhook/reply', 'POST', {
      headers: { 'X-Webhook-Secret': 'wrong-secret' },
      body: validPayload,
    });

    const response = await handler(request);

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  test('rejects unknown webhook payload format', async () => {
    // Payloads that don't match Instantly or HeyReach schemas are rejected
    const request = createMockRequest('/webhook/reply', 'POST', {
      headers: { 'X-Webhook-Secret': config.instantlySecret },
      body: { invalid: 'payload' },
    });

    const response = await handler(request);

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const data = await response.json();
    expect(data.code).toBe('ERR_UNKNOWN_PAYLOAD');
  });

  test('processes valid webhook payload', async () => {
    // Payload must match InstantlyWebhookPayloadSchema structure
    const validPayload = {
      event: 'reply_received',
      timestamp: new Date().toISOString(),
      reply: {
        id: 'reply_123',
        message_id: 'msg_456',
        thread_id: 'thread_789',
        content: "Yes, I'm interested!",
        subject: 'Re: Partnership Opportunity',
        received_at: new Date().toISOString(),
      },
      lead: {
        id: 'lead_001',
        email: 'john@example.com',
        first_name: 'John',
        last_name: 'Smith',
        company: 'Acme Corp',
        title: 'CTO',
      },
      campaign: {
        id: 'camp_123',
        name: 'Fintech Outreach Q1',
        sequence_step: 2,
        last_sent_template: 'follow_up_1',
      },
      account_id: 'acc_001',
      workspace_id: 'ws_001',
    };

    const request = createMockRequest('/webhook/reply', 'POST', {
      headers: { 'X-Webhook-Secret': config.instantlySecret },
      body: validPayload,
    });

    const response = await handler(request);

    expect(response.status).toBe(HTTP_STATUS.OK);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.reply_id).toBeDefined();
    expect(data.tier).toBeDefined();
  });

  test('handles processing errors gracefully', async () => {
    const errorConfig = createMockConfig({
      handleReply: mock(async () => {
        throw new Error('Processing failed');
      }),
    });
    const errorHandler = createRequestHandler(errorConfig);

    // Payload must match InstantlyWebhookPayloadSchema structure
    const validPayload = {
      event: 'reply_received',
      timestamp: new Date().toISOString(),
      reply: {
        id: 'reply_123',
        message_id: 'msg_456',
        thread_id: 'thread_789',
        content: 'Test reply',
        received_at: new Date().toISOString(),
      },
      lead: {
        id: 'lead_001',
        email: 'john@example.com',
      },
      campaign: {
        id: 'camp_123',
        name: 'Test Campaign',
        sequence_step: 1,
      },
      account_id: 'acc_001',
      workspace_id: 'ws_001',
    };

    const request = createMockRequest('/webhook/reply', 'POST', {
      headers: { 'X-Webhook-Secret': errorConfig.instantlySecret },
      body: validPayload,
    });

    const response = await errorHandler(request);

    expect(response.status).toBe(HTTP_STATUS.INTERNAL_ERROR);
    const data = await response.json();
    expect(data.code).toBe('ERR_PROCESSING_FAILED');
  });
});

// ===========================================
// Slack Webhook Tests
// ===========================================

describe('Slack webhook endpoint', () => {
  let handler: (request: Request) => Promise<Response>;
  let config: WebhookConfig;

  beforeEach(() => {
    config = createMockConfig();
    handler = createRequestHandler(config);
  });

  test('rejects missing signature', async () => {
    const request = new Request('http://localhost:3002/webhook/slack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'payload={}',
    });

    const response = await handler(request);

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    const data = await response.json();
    expect(data.code).toBe('ERR_INVALID_SIGNATURE');
  });

  test('rejects missing payload', async () => {
    // Mock a valid signature for testing
    const request = new Request('http://localhost:3002/webhook/slack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Signature': 'v0=test',
        'X-Slack-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      },
      body: 'no_payload=true',
    });

    const response = await handler(request);

    // Will fail signature verification or payload parsing
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

// ===========================================
// Draft Status Endpoint Tests
// ===========================================

describe('Draft status endpoint', () => {
  let handler: (request: Request) => Promise<Response>;
  let config: WebhookConfig;

  beforeEach(() => {
    config = createMockConfig();
    handler = createRequestHandler(config);
  });

  test('returns draft status', async () => {
    const request = createMockRequest('/status/draft_12345');
    const response = await handler(request);

    expect(response.status).toBe(HTTP_STATUS.OK);
    const data = await response.json();
    expect(data.draft_id).toBe('draft_12345');
    expect(data.status).toBeDefined();
  });

  test('returns 404 for unknown draft', async () => {
    const notFoundConfig = createMockConfig({
      getDraftStatus: mock(async () => null),
    });
    const notFoundHandler = createRequestHandler(notFoundConfig);

    const request = createMockRequest('/status/unknown_draft');
    const response = await notFoundHandler(request);

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    const data = await response.json();
    expect(data.code).toBe('ERR_NOT_FOUND');
  });

  test('returns 503 when status endpoint not configured', async () => {
    const noStatusConfig = createMockConfig({
      getDraftStatus: undefined,
    });
    const noStatusHandler = createRequestHandler(noStatusConfig);

    const request = createMockRequest('/status/draft_12345');
    const response = await noStatusHandler(request);

    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
  });
});

// ===========================================
// CORS Tests
// ===========================================

describe('CORS handling', () => {
  let handler: (request: Request) => Promise<Response>;

  beforeEach(() => {
    const config = createMockConfig({
      cors: {
        origin: 'https://example.com',
        methods: ['GET', 'POST'],
      },
    });
    handler = createRequestHandler(config);
  });

  test('handles OPTIONS preflight request', async () => {
    const request = new Request('http://localhost:3002/webhook/reply', {
      method: 'OPTIONS',
    });

    const response = await handler(request);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://example.com'
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  test('includes CORS headers in responses', async () => {
    const request = createMockRequest('/health');
    const response = await handler(request);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://example.com'
    );
  });
});

// ===========================================
// Route Matching Tests
// ===========================================

describe('Route matching', () => {
  let handler: (request: Request) => Promise<Response>;

  beforeEach(() => {
    const config = createMockConfig();
    handler = createRequestHandler(config);
  });

  test('returns 404 for unknown routes', async () => {
    const request = createMockRequest('/unknown/path');
    const response = await handler(request);

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  test('matches /status/:draftId pattern', async () => {
    const request = createMockRequest('/status/draft_abc123');
    const response = await handler(request);

    expect(response.status).toBe(HTTP_STATUS.OK);
  });

  test('rejects invalid status path format', async () => {
    const request = createMockRequest('/status/');
    const response = await handler(request);

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
  });
});

// ===========================================
// Webhook Middleware Tests
// ===========================================

describe('Webhook middleware', () => {
  test('creates middleware with handle method', () => {
    const config = createMockConfig();
    const middleware = createWebhookMiddleware(config);

    expect(middleware.handle).toBeInstanceOf(Function);
    expect(middleware.matches).toBeInstanceOf(Function);
  });

  test('matches webhook routes', () => {
    const config = createMockConfig();
    const middleware = createWebhookMiddleware(config);

    expect(middleware.matches('/health')).toBe(true);
    expect(middleware.matches('/webhook/reply')).toBe(true);
    expect(middleware.matches('/webhook/slack')).toBe(true);
    expect(middleware.matches('/status/draft_123')).toBe(true);
    expect(middleware.matches('/other/path')).toBe(false);
  });
});

// ===========================================
// Utility Function Tests
// ===========================================

describe('parseJsonBody utility', () => {
  const TestSchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  test('parses valid JSON body', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John', age: 30 }),
    });

    const result = await parseJsonBody(request, TestSchema);

    expect('data' in result).toBe(true);
    if ('data' in result) {
      expect(result.data.name).toBe('John');
      expect(result.data.age).toBe(30);
    }
  });

  test('returns error for invalid JSON', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    });

    const result = await parseJsonBody(request, TestSchema);

    expect('error' in result).toBe(true);
  });

  test('returns error for schema validation failure', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John' }), // Missing age
    });

    const result = await parseJsonBody(request, TestSchema);

    expect('error' in result).toBe(true);
  });
});

describe('getClientIP utility', () => {
  test('extracts IP from X-Forwarded-For header', () => {
    const request = new Request('http://localhost/test', {
      headers: {
        'X-Forwarded-For': '192.168.1.1, 10.0.0.1',
      },
    });

    const ip = getClientIP(request);

    expect(ip).toBe('192.168.1.1');
  });

  test('extracts IP from X-Real-IP header', () => {
    const request = new Request('http://localhost/test', {
      headers: {
        'X-Real-IP': '192.168.1.2',
      },
    });

    const ip = getClientIP(request);

    expect(ip).toBe('192.168.1.2');
  });

  test('prefers X-Forwarded-For over X-Real-IP', () => {
    const request = new Request('http://localhost/test', {
      headers: {
        'X-Forwarded-For': '192.168.1.1',
        'X-Real-IP': '192.168.1.2',
      },
    });

    const ip = getClientIP(request);

    expect(ip).toBe('192.168.1.1');
  });

  test('returns undefined when no IP headers', () => {
    const request = new Request('http://localhost/test');

    const ip = getClientIP(request);

    expect(ip).toBeUndefined();
  });
});

describe('checkRateLimit utility', () => {
  test('allows requests within limit', () => {
    const identifier = `test-${Date.now()}`;

    expect(checkRateLimit(identifier, 5, 1000)).toBe(true);
    expect(checkRateLimit(identifier, 5, 1000)).toBe(true);
    expect(checkRateLimit(identifier, 5, 1000)).toBe(true);
  });

  test('blocks requests exceeding limit', () => {
    const identifier = `test-${Date.now()}-block`;

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      checkRateLimit(identifier, 3, 60000);
    }

    // Should be blocked
    expect(checkRateLimit(identifier, 3, 60000)).toBe(false);
  });

  test('resets after window expires', async () => {
    const identifier = `test-${Date.now()}-reset`;

    // Use up limit with short window
    checkRateLimit(identifier, 1, 50);
    expect(checkRateLimit(identifier, 1, 50)).toBe(false);

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 60));

    // Should be allowed again
    expect(checkRateLimit(identifier, 1, 50)).toBe(true);
  });
});

// ===========================================
// HTTP Status Constants Tests
// ===========================================

describe('HTTP_STATUS constants', () => {
  test('has standard HTTP status codes', () => {
    expect(HTTP_STATUS.OK).toBe(200);
    expect(HTTP_STATUS.CREATED).toBe(201);
    expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
    expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
    expect(HTTP_STATUS.FORBIDDEN).toBe(403);
    expect(HTTP_STATUS.NOT_FOUND).toBe(404);
    expect(HTTP_STATUS.INTERNAL_ERROR).toBe(500);
    expect(HTTP_STATUS.SERVICE_UNAVAILABLE).toBe(503);
  });
});
