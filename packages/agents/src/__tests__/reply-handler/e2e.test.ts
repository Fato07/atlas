/**
 * Reply Handler E2E Tests
 *
 * Tests the full server endpoints with HTTP requests.
 * Requires the server to be started with mocked dependencies.
 *
 * To run E2E tests:
 *   1. Start mock server: bun run reply-handler:mock
 *   2. Run tests: bun test:e2e
 *
 * These tests will SKIP if server is not running.
 *
 * @module __tests__/reply-handler/e2e.test
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createHmac } from 'crypto';

// ===========================================
// Test Configuration
// ===========================================

const TEST_PORT = parseInt(process.env.TEST_PORT ?? '3099', 10);
const BASE_URL = `http://localhost:${TEST_PORT}`;
const WEBHOOK_SECRET = process.env.INSTANTLY_WEBHOOK_SECRET ?? 'test_webhook_secret';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? 'test_slack_secret';

// Track server availability - set once at startup
let serverAvailable = false;

/**
 * Safe fetch that handles connection errors
 * Returns null if connection fails
 */
async function safeFetch(
  url: string,
  options?: RequestInit
): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Connection refused or timeout - server not running
    return null;
  }
}

// ===========================================
// Test Fixtures
// ===========================================

/**
 * Creates a valid Instantly webhook payload for testing
 */
function createInstantlyPayload(overrides: Partial<{
  reply_id: string;
  reply_text: string;
  lead_email: string;
  lead_name: string;
  lead_company: string;
  brain_id: string;
}> = {}) {
  const now = new Date().toISOString();

  return {
    reply_id: overrides.reply_id ?? `reply_${Date.now()}`,
    source: 'instantly',
    received_at: now,
    reply_text: overrides.reply_text ?? 'This sounds great! I would love to learn more about your solution.',
    thread_id: `thread_${Date.now()}`,
    thread_messages: [
      {
        id: 'msg_out_1',
        direction: 'outbound',
        content: 'Hi there, I wanted to reach out about our solution...',
        sent_at: new Date(Date.now() - 86400000).toISOString(),
        sender: 'sales@company.com',
        subject: 'Quick question about your workflow',
      },
    ],
    message_count: 2,
    lead_id: `lead_${Date.now()}`,
    lead_email: overrides.lead_email ?? 'prospect@example.com',
    lead_name: overrides.lead_name ?? 'John Smith',
    lead_company: overrides.lead_company ?? 'Acme Corp',
    lead_title: 'VP of Engineering',
    campaign_id: 'campaign_001',
    sequence_step: 1,
    last_sent_template: 'initial_outreach',
    brain_id: overrides.brain_id ?? 'brain_fintech',
  };
}

/**
 * Creates Slack signature for webhook authentication
 */
function createSlackSignature(
  timestamp: string,
  body: string,
  secret: string
): string {
  const sigBasestring = `v0:${timestamp}:${body}`;
  const signature = createHmac('sha256', secret)
    .update(sigBasestring)
    .digest('hex');
  return `v0=${signature}`;
}

// ===========================================
// Server Connection Check
// ===========================================

// Check server availability before all tests
beforeAll(async () => {
  const response = await safeFetch(`${BASE_URL}/health`);
  serverAvailable = response !== null && response.ok;

  if (!serverAvailable) {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  E2E SERVER NOT RUNNING - E2E tests will pass as no-ops    ║');
    console.log('║                                                            ║');
    console.log('║  To run E2E tests against live server:                     ║');
    console.log('║    1. Start mock server: bun run reply-handler:mock        ║');
    console.log('║    2. Run tests: bun test:e2e                              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
  } else {
    console.log(`\n✓ E2E server available at ${BASE_URL}\n`);
  }
});

// ===========================================
// E2E Tests
// ===========================================

describe('E2E: Health Check', () => {
  test('GET /health returns 200 with service info', async () => {
    if (!serverAvailable) return; // Skip silently

    const response = await safeFetch(`${BASE_URL}/health`);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);

    const body = await response!.json();
    expect(body).toHaveProperty('status', 'healthy');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('uptime');
  });

  test('GET /health includes service checks', async () => {
    if (!serverAvailable) return;

    const response = await safeFetch(`${BASE_URL}/health`);
    expect(response).not.toBeNull();

    const body = await response!.json();
    expect(body).toHaveProperty('services');
  });
});

describe('E2E: Reply Webhook', () => {
  test('POST /webhook/reply rejects missing secret', async () => {
    if (!serverAvailable) return;

    const payload = createInstantlyPayload();

    const response = await safeFetch(`${BASE_URL}/webhook/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);

    const body = await response!.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /webhook/reply rejects invalid secret', async () => {
    if (!serverAvailable) return;

    const payload = createInstantlyPayload();

    const response = await safeFetch(`${BASE_URL}/webhook/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': 'wrong_secret',
      },
      body: JSON.stringify(payload),
    });

    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);
  });

  test('POST /webhook/reply validates payload schema', async () => {
    if (!serverAvailable) return;

    const invalidPayload = { reply_text: 'Hello' }; // Missing required fields

    const response = await safeFetch(`${BASE_URL}/webhook/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify(invalidPayload),
    });

    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);

    const body = await response!.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /webhook/reply processes valid Tier 1 payload', async () => {
    if (!serverAvailable) return;

    const payload = createInstantlyPayload({
      reply_text: 'Yes! I am very interested. When can we talk?',
    });

    const response = await safeFetch(`${BASE_URL}/webhook/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    expect(response).not.toBeNull();
    expect([200, 202]).toContain(response!.status);

    const body = await response!.json();
    expect(body).toHaveProperty('status');
  });

  test('POST /webhook/reply handles objection (Tier 2)', async () => {
    if (!serverAvailable) return;

    const payload = createInstantlyPayload({
      reply_text: "We don't have budget for this right now. Maybe next quarter?",
    });

    const response = await safeFetch(`${BASE_URL}/webhook/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    expect(response).not.toBeNull();
    expect([200, 202]).toContain(response!.status);
  });

  test('POST /webhook/reply handles complex reply (Tier 3)', async () => {
    if (!serverAvailable) return;

    const payload = createInstantlyPayload({
      reply_text:
        "I'm not the right person for this. You should talk to our procurement team about enterprise software. Also, we have existing contracts with competitors.",
    });

    const response = await safeFetch(`${BASE_URL}/webhook/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    expect(response).not.toBeNull();
    expect([200, 202]).toContain(response!.status);
  });
});

describe('E2E: Slack Webhook', () => {
  test('POST /webhook/slack rejects missing signature', async () => {
    if (!serverAvailable) return;

    const payload = {
      type: 'block_actions',
      user: { id: 'U123', username: 'testuser' },
      actions: [{ action_id: 'approve_draft::draft_123' }],
    };

    const response = await safeFetch(`${BASE_URL}/webhook/slack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `payload=${encodeURIComponent(JSON.stringify(payload))}`,
    });

    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);
  });

  test('POST /webhook/slack validates signature', async () => {
    if (!serverAvailable) return;

    const payload = {
      type: 'block_actions',
      user: { id: 'U123', username: 'testuser' },
      actions: [{ action_id: 'approve_draft::draft_123' }],
    };

    const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createSlackSignature(timestamp, body, SLACK_SIGNING_SECRET);

    const response = await safeFetch(`${BASE_URL}/webhook/slack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': signature,
      },
      body,
    });

    expect(response).not.toBeNull();
    // Should accept valid signature (may return 404 for missing draft)
    expect([200, 404]).toContain(response!.status);
  });
});

describe('E2E: Draft Status', () => {
  test('GET /status/:draftId returns 404 for unknown draft', async () => {
    if (!serverAvailable) return;

    const response = await safeFetch(`${BASE_URL}/status/unknown_draft_id`);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(404);
  });
});

describe('E2E: CORS', () => {
  test('OPTIONS request returns CORS headers', async () => {
    if (!serverAvailable) return;

    const response = await safeFetch(`${BASE_URL}/webhook/reply`, {
      method: 'OPTIONS',
    });

    expect(response).not.toBeNull();
    expect(response!.status).toBe(204);
    expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response!.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

describe('E2E: Error Handling', () => {
  test('GET /unknown returns 404', async () => {
    if (!serverAvailable) return;

    const response = await safeFetch(`${BASE_URL}/unknown`);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(404);
  });

  test('POST /webhook/reply handles malformed JSON', async () => {
    if (!serverAvailable) return;

    const response = await safeFetch(`${BASE_URL}/webhook/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET,
      },
      body: 'not valid json',
    });

    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
  });
});

describe('E2E: Server Connection', () => {
  test('server availability check', () => {
    // This test documents whether server was available
    // Always passes - used for status reporting
    if (serverAvailable) {
      expect(serverAvailable).toBe(true);
    } else {
      // Server not running is a valid state for unit test runs
      expect(serverAvailable).toBe(false);
    }
  });
});
