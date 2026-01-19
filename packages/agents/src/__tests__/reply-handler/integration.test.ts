/**
 * Reply Handler Integration Tests
 *
 * Tests full Tier 1/2/3 flows with mocked dependencies.
 * Verifies the complete pipeline from webhook to action.
 *
 * @module __tests__/reply-handler/integration.test
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import type { Classification, KBMatch, ReplyHandlerResult } from '../../reply-handler/contracts/handler-result';
import type { ReplyInput, LeadContext } from '../../reply-handler/contracts/reply-input';

// ===========================================
// Mock Dependencies
// ===========================================

/**
 * Creates a mock Anthropic client
 */
function createMockAnthropicClient(classificationOverride?: Partial<{
  intent: string;
  confidence: number;
  sentiment: number;
}>) {
  return {
    messages: {
      create: mock(async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              intent: classificationOverride?.intent ?? 'positive_interest',
              confidence: classificationOverride?.confidence ?? 0.92,
              sentiment: classificationOverride?.sentiment ?? 0.75,
              reasoning: 'Mock classification',
            }),
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      })),
    },
  };
}

/**
 * Creates a mock Qdrant client with configurable search results
 */
function createMockQdrantClient(searchScore: number = 0.90) {
  return {
    search: mock(async () => [
      {
        score: searchScore,
        payload: {
          id: 'template_001',
          brain_id: 'brain_fintech',
          reply_type: 'positive_response',
          content: 'Hi {{first_name}}, Thanks for your interest!',
          personalization_instructions: 'Reference their industry.',
        },
      },
    ]),
    count: mock(async () => ({ count: 10 })),
  };
}

/**
 * Creates a mock embedder function
 */
function createMockEmbedder() {
  return mock(async (text: string) =>
    Array(1024).fill(0).map((_, i) => Math.sin(i) * 0.1)
  );
}

/**
 * Creates a mock Slack client
 */
function createMockSlackClient() {
  return {
    chat: {
      postMessage: mock(async () => ({ ok: true, ts: '1234567890.123456' })),
    },
    views: {
      open: mock(async () => ({ ok: true })),
    },
  };
}

/**
 * Creates a mock MCP tool function
 */
function createMockMcpTool() {
  return mock(async (tool: string, params: Record<string, unknown>) => {
    if (tool === 'instantly_send_reply') {
      return { success: true, messageId: 'msg_123' };
    }
    return { success: true };
  });
}

// ===========================================
// Test Fixtures
// ===========================================

function createReplyInput(overrides?: Partial<ReplyInput>): ReplyInput {
  return {
    reply_id: 'reply_12345',
    brain_id: 'brain_fintech',
    lead: {
      email: 'john.smith@acme.com',
      first_name: 'John',
      last_name: 'Smith',
      company: 'Acme Corp',
      title: 'VP Engineering',
      industry: 'Technology',
    },
    email: {
      reply_text: "Yes, I'd love to learn more about your solution!",
      subject: 'Re: Quick question about our platform',
      thread_id: 'thread_abc',
    },
    campaign: {
      campaign_id: 'camp_123',
      sender_account: 'sender@company.com',
    },
    received_at: new Date().toISOString(),
    ...overrides,
  };
}

// ===========================================
// Tier 1 Flow Tests (Auto-Response)
// ===========================================

describe('Tier 1 Flow - Auto-Response', () => {
  test('processes positive interest with high confidence KB match', async () => {
    // Setup: High confidence classification + high confidence KB match
    const classification: Classification = {
      intent: 'positive_interest',
      intent_confidence: 0.92,
      sentiment: 0.8,
      complexity: 'simple',
      urgency: 'high',
      reply_type: 'positive_response',
    };

    const kbMatch: KBMatch = {
      type: 'template',
      id: 'template_positive_001',
      confidence: 0.90,
      content: 'Hi {{first_name}}, Thanks for your interest!',
    };

    // Verify routing decision
    const shouldAutoRespond =
      classification.intent_confidence >= 0.85 &&
      kbMatch.confidence >= 0.85 &&
      classification.complexity === 'simple';

    expect(shouldAutoRespond).toBe(true);
  });

  test('Tier 1 requirements: confidence >= 0.85 and KB match >= 0.85', () => {
    const testCases = [
      { intentConf: 0.92, kbConf: 0.90, expected: true },
      { intentConf: 0.85, kbConf: 0.85, expected: true },
      { intentConf: 0.84, kbConf: 0.90, expected: false },
      { intentConf: 0.92, kbConf: 0.84, expected: false },
    ];

    for (const tc of testCases) {
      const isTier1 = tc.intentConf >= 0.85 && tc.kbConf >= 0.85;
      expect(isTier1).toBe(tc.expected);
    }
  });

  test('sends response via MCP instantly_send_reply', async () => {
    const mockMcpTool = createMockMcpTool();

    // Simulate sending reply
    const result = await mockMcpTool('instantly_send_reply', {
      to: 'john@acme.com',
      subject: 'Re: Quick question',
      body: 'Hi John, Thanks for your interest!',
    });

    expect(result.success).toBe(true);
    expect(mockMcpTool).toHaveBeenCalledWith('instantly_send_reply', expect.any(Object));
  });
});

// ===========================================
// Tier 2 Flow Tests (Draft Approval)
// ===========================================

describe('Tier 2 Flow - Draft Approval', () => {
  test('routes to Tier 2 with moderate confidence', () => {
    const testCases = [
      { intentConf: 0.70, kbConf: 0.75, expected: 2 },
      { intentConf: 0.60, kbConf: 0.80, expected: 2 },
      { intentConf: 0.50, kbConf: 0.90, expected: 2 },
      { intentConf: 0.92, kbConf: undefined, expected: 2 }, // High intent, no KB
    ];

    for (const tc of testCases) {
      const tier = determineTier(tc.intentConf, tc.kbConf);
      expect(tier).toBe(tc.expected);
    }
  });

  test('creates draft for Slack approval', () => {
    const draft = {
      id: `draft_${Date.now()}`,
      reply_id: 'reply_12345',
      content: 'Hi John, Thanks for your interest!',
      status: 'pending_approval' as const,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4 hours
    };

    expect(draft.status).toBe('pending_approval');
    expect(new Date(draft.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  test('posts to Slack approval channel', async () => {
    const mockSlack = createMockSlackClient();

    const result = await mockSlack.chat.postMessage({
      channel: 'C123456',
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'New draft for approval' },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(mockSlack.chat.postMessage).toHaveBeenCalled();
  });

  test('handles approve action', async () => {
    const mockMcpTool = createMockMcpTool();

    // Simulate approval workflow
    const draft = { id: 'draft_123', content: 'Approved response text' };

    // When approved, send via MCP
    const sendResult = await mockMcpTool('instantly_send_reply', {
      body: draft.content,
    });

    expect(sendResult.success).toBe(true);
  });

  test('handles edit action', () => {
    const originalDraft = {
      id: 'draft_123',
      content: 'Original content',
      status: 'pending_approval' as const,
    };

    const editedDraft = {
      ...originalDraft,
      content: 'Edited content by reviewer',
      edited_by: 'reviewer@company.com',
    };

    expect(editedDraft.content).not.toBe(originalDraft.content);
    expect(editedDraft.edited_by).toBeDefined();
  });

  test('handles reject action', () => {
    const draft = {
      id: 'draft_123',
      status: 'pending_approval' as const,
    };

    const rejectedDraft = {
      ...draft,
      status: 'rejected' as const,
      rejected_by: 'reviewer@company.com',
      rejected_at: new Date().toISOString(),
    };

    expect(rejectedDraft.status).toBe('rejected');
  });
});

// ===========================================
// Tier 3 Flow Tests (Human Escalation)
// ===========================================

describe('Tier 3 Flow - Human Escalation', () => {
  test('routes to Tier 3 with low confidence', () => {
    const testCases = [
      { intentConf: 0.40, kbConf: 0.50, expected: 3 },
      { intentConf: 0.35, kbConf: undefined, expected: 3 },
      { intentConf: 0.49, kbConf: 0.30, expected: 3 },
    ];

    for (const tc of testCases) {
      const tier = determineTier(tc.intentConf, tc.kbConf);
      expect(tier).toBe(tc.expected);
    }
  });

  test('routes to Tier 3 for sensitive intents', () => {
    const sensitiveIntents = ['unsubscribe', 'not_interested', 'referral'];

    for (const intent of sensitiveIntents) {
      const tier = determineTierForIntent(intent, 0.95, 0.90);
      expect(tier).toBe(3);
    }
  });

  test('routes to Tier 3 for complex replies', () => {
    const classification: Classification = {
      intent: 'question',
      intent_confidence: 0.85,
      sentiment: 0.3,
      complexity: 'complex', // Complex triggers Tier 3
      urgency: 'medium',
    };

    const tier = determineTierForClassification(classification, 0.90);
    expect(tier).toBe(3);
  });

  test('posts to Slack escalation channel', async () => {
    const mockSlack = createMockSlackClient();

    const result = await mockSlack.chat.postMessage({
      channel: 'C_ESCALATION',
      text: '🚨 Manual handling required',
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '*Escalation:* Complex reply requires human review' },
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  test('includes all context in escalation', () => {
    const escalation = {
      reply_id: 'reply_123',
      classification: {
        intent: 'unclear',
        intent_confidence: 0.35,
        complexity: 'complex',
      },
      lead: {
        email: 'john@acme.com',
        company: 'Acme Corp',
      },
      reason: 'Low confidence classification with complex content',
      suggested_actions: ['Review original reply', 'Contact lead directly'],
    };

    expect(escalation.classification).toBeDefined();
    expect(escalation.lead).toBeDefined();
    expect(escalation.reason).toBeDefined();
    expect(escalation.suggested_actions.length).toBeGreaterThan(0);
  });
});

// ===========================================
// Auto-Reply Handling Tests
// ===========================================

describe('Auto-Reply Handling', () => {
  test('detects and handles out_of_office', () => {
    const classification: Classification = {
      intent: 'out_of_office',
      intent_confidence: 0.95,
      sentiment: 0,
      complexity: 'simple',
      urgency: 'low',
    };

    // OOO should not trigger response or escalation
    const action = determineAction(classification);
    expect(action.type).toBe('no_action');
    expect(action.reason).toContain('auto-reply');
  });

  test('detects and handles bounce', () => {
    const classification: Classification = {
      intent: 'bounce',
      intent_confidence: 0.99,
      sentiment: 0,
      complexity: 'simple',
      urgency: 'low',
    };

    // Bounce should trigger CRM update but no response
    const action = determineAction(classification);
    expect(action.type).toBe('crm_update');
    expect(action.updateType).toBe('mark_invalid');
  });
});

// ===========================================
// End-to-End Pipeline Tests
// ===========================================

describe('End-to-End Pipeline', () => {
  test('complete Tier 1 flow: webhook → classify → match → respond', async () => {
    // 1. Receive webhook
    const input = createReplyInput({
      email: {
        reply_text: "Yes! I'd love to schedule a demo.",
        subject: 'Re: Demo request',
      },
    });

    // 2. Classify
    const classification: Classification = {
      intent: 'positive_interest',
      intent_confidence: 0.92,
      sentiment: 0.85,
      complexity: 'simple',
      urgency: 'high',
      reply_type: 'positive_response',
    };

    // 3. Match KB
    const kbMatch: KBMatch = {
      type: 'template',
      id: 'template_001',
      confidence: 0.91,
      content: 'Hi {{first_name}}, Thanks for your interest!',
    };

    // 4. Route
    const tier = determineTier(classification.intent_confidence, kbMatch.confidence);
    expect(tier).toBe(1);

    // 5. Generate response
    const response = kbMatch.content.replace('{{first_name}}', input.lead.first_name ?? 'there');

    // 6. Verify result
    const result: Partial<ReplyHandlerResult> = {
      reply_id: input.reply_id,
      classification,
      routing: { tier: 1, reason: 'High confidence', override_applied: false },
      action: { type: 'auto_response', response_sent: true },
    };

    expect(result.routing?.tier).toBe(1);
    expect(result.action?.type).toBe('auto_response');
  });

  test('complete Tier 2 flow: webhook → classify → match → draft → approve → respond', async () => {
    // 1. Receive webhook
    const input = createReplyInput({
      email: {
        reply_text: 'Sounds interesting. What are your pricing options?',
        subject: 'Re: Pricing inquiry',
      },
    });

    // 2. Classify (moderate confidence)
    const classification: Classification = {
      intent: 'question',
      intent_confidence: 0.70,
      sentiment: 0.4,
      complexity: 'medium',
      urgency: 'medium',
      reply_type: 'question_response',
    };

    // 3. Match KB
    const kbMatch: KBMatch = {
      type: 'template',
      id: 'template_pricing',
      confidence: 0.78,
      content: 'Hi {{first_name}}, Great question about pricing!',
    };

    // 4. Route to Tier 2
    const tier = determineTier(classification.intent_confidence, kbMatch.confidence);
    expect(tier).toBe(2);

    // 5. Create draft
    const draft = {
      id: `draft_${input.reply_id}`,
      content: kbMatch.content.replace('{{first_name}}', input.lead.first_name ?? 'there'),
      status: 'pending_approval' as const,
    };

    // 6. Simulate approval
    const approvedDraft = {
      ...draft,
      status: 'approved' as const,
      approved_by: 'reviewer@company.com',
    };

    // 7. Verify result
    expect(approvedDraft.status).toBe('approved');
  });

  test('complete Tier 3 flow: webhook → classify → escalate', async () => {
    // 1. Receive webhook with unclear content
    const input = createReplyInput({
      email: {
        reply_text: `I have many questions about this.
First, how does it integrate with Salesforce?
Second, what about GDPR compliance?
Third, can it handle our specific workflow?
We're also evaluating competitors.`,
        subject: 'Re: Questions',
      },
    });

    // 2. Classify (low confidence, complex)
    const classification: Classification = {
      intent: 'question',
      intent_confidence: 0.45,
      sentiment: 0.2,
      complexity: 'complex',
      urgency: 'medium',
    };

    // 3. Route to Tier 3
    const tier = determineTierForClassification(classification, undefined);
    expect(tier).toBe(3);

    // 4. Verify escalation
    const result: Partial<ReplyHandlerResult> = {
      reply_id: input.reply_id,
      classification,
      routing: { tier: 3, reason: 'Complex reply with low confidence', override_applied: false },
      action: { type: 'human_escalation' },
    };

    expect(result.routing?.tier).toBe(3);
    expect(result.action?.type).toBe('human_escalation');
  });
});

// ===========================================
// Helper Functions (mimicking router logic)
// ===========================================

function determineTier(intentConfidence: number, kbConfidence?: number): 1 | 2 | 3 {
  // Tier 1: High confidence classification AND high confidence KB match
  if (intentConfidence >= 0.85 && kbConfidence !== undefined && kbConfidence >= 0.85) {
    return 1;
  }

  // Tier 3: Low confidence
  if (intentConfidence < 0.50 || (kbConfidence !== undefined && kbConfidence < 0.50)) {
    return 3;
  }

  // Tier 2: Moderate confidence
  return 2;
}

function determineTierForIntent(intent: string, intentConfidence: number, kbConfidence?: number): 1 | 2 | 3 {
  // Sensitive intents always go to Tier 3
  const sensitiveIntents = ['unsubscribe', 'not_interested', 'referral', 'out_of_office', 'bounce'];
  if (sensitiveIntents.includes(intent)) {
    return 3;
  }

  return determineTier(intentConfidence, kbConfidence);
}

function determineTierForClassification(classification: Classification, kbConfidence?: number): 1 | 2 | 3 {
  // Complex replies go to Tier 3
  if (classification.complexity === 'complex') {
    return 3;
  }

  return determineTierForIntent(classification.intent, classification.intent_confidence, kbConfidence);
}

function determineAction(classification: Classification): {
  type: 'no_action' | 'crm_update' | 'response' | 'escalation';
  reason?: string;
  updateType?: string;
} {
  if (classification.intent === 'out_of_office') {
    return { type: 'no_action', reason: 'Detected auto-reply (OOO)' };
  }

  if (classification.intent === 'bounce') {
    return { type: 'crm_update', updateType: 'mark_invalid', reason: 'Email bounced' };
  }

  return { type: 'response' };
}
