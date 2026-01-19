/**
 * Reply Handler Classifier Tests
 *
 * Tests for intent classification, sentiment analysis, and complexity assessment.
 * Uses mocked Anthropic client to test classification logic.
 *
 * @module __tests__/reply-handler/classifier.test
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { ReplyClassifier, createClassifier } from '../../reply-handler/classifier';
import type { ClassifierConfig } from '../../reply-handler/classifier';

// ===========================================
// Mock Anthropic Client
// ===========================================

function createMockAnthropicClient(mockResponse?: {
  intent?: string;
  confidence?: number;
  sentiment?: number;
  reasoning?: string;
}) {
  const defaultResponse = {
    intent: mockResponse?.intent ?? 'positive_interest',
    confidence: mockResponse?.confidence ?? 0.90,
    sentiment: mockResponse?.sentiment ?? 0.75,
    reasoning: mockResponse?.reasoning ?? 'Test classification',
  };

  return {
    messages: {
      create: mock(async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(defaultResponse),
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

// ===========================================
// Classifier Creation Tests
// ===========================================

describe('ReplyClassifier creation', () => {
  test('creates classifier with default model', () => {
    const mockClient = createMockAnthropicClient();
    const classifier = createClassifier({ client: mockClient as any });
    expect(classifier).toBeDefined();
    expect(classifier).toBeInstanceOf(ReplyClassifier);
  });

  test('creates classifier with custom model', () => {
    const mockClient = createMockAnthropicClient();
    const classifier = createClassifier({
      client: mockClient as any,
      model: 'claude-3-haiku-20240307',
      maxTokens: 512,
    });
    expect(classifier).toBeDefined();
  });
});

// ===========================================
// Intent Classification Tests
// ===========================================

describe('Intent classification', () => {
  let classifier: ReplyClassifier;
  let mockClient: ReturnType<typeof createMockAnthropicClient>;

  beforeEach(() => {
    mockClient = createMockAnthropicClient({
      intent: 'positive_interest',
      confidence: 0.92,
      sentiment: 0.8,
    });
    classifier = createClassifier({ client: mockClient as any });
  });

  test('classifies positive interest reply', async () => {
    const result = await classifier.classify({
      replyText: "Yes, I'd love to schedule a demo! How about next week?",
      leadName: 'John Doe',
      leadCompany: 'Acme Corp',
    });

    expect(result.intent).toBe('positive_interest');
    expect(result.intent_confidence).toBeGreaterThan(0.85);
    expect(result.sentiment).toBeGreaterThan(0.5);
  });

  test('classifies question reply', async () => {
    mockClient = createMockAnthropicClient({
      intent: 'question',
      confidence: 0.88,
      sentiment: 0.3,
    });
    classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: "What's the pricing for your enterprise plan?",
    });

    expect(result.intent).toBe('question');
    expect(result.reply_type).toBe('question_response');
  });

  test('classifies objection reply', async () => {
    mockClient = createMockAnthropicClient({
      intent: 'objection',
      confidence: 0.85,
      sentiment: -0.2,
    });
    classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: "We don't have the budget for this right now.",
    });

    expect(result.intent).toBe('objection');
    expect(result.reply_type).toBe('objection_handler');
  });

  test('classifies not_interested reply', async () => {
    mockClient = createMockAnthropicClient({
      intent: 'not_interested',
      confidence: 0.95,
      sentiment: -0.1,
    });
    classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: "Thanks but we're not interested at this time.",
    });

    expect(result.intent).toBe('not_interested');
    expect(result.reply_type).toBe('decline_acknowledgment');
  });

  test('classifies unsubscribe request', async () => {
    mockClient = createMockAnthropicClient({
      intent: 'unsubscribe',
      confidence: 0.98,
      sentiment: -0.5,
    });
    classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: 'Please remove me from your mailing list.',
    });

    expect(result.intent).toBe('unsubscribe');
    expect(result.reply_type).toBe('unsubscribe_confirmation');
  });

  test('classifies referral reply', async () => {
    mockClient = createMockAnthropicClient({
      intent: 'referral',
      confidence: 0.87,
      sentiment: 0.2,
    });
    classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: "I'm not the right person for this. You should talk to Jane in purchasing.",
    });

    expect(result.intent).toBe('referral');
    expect(result.reply_type).toBe('referral_response');
  });
});

// ===========================================
// Auto-Reply Detection Tests
// ===========================================

describe('Auto-reply detection', () => {
  let classifier: ReplyClassifier;

  beforeEach(() => {
    const mockClient = createMockAnthropicClient();
    classifier = createClassifier({ client: mockClient as any });
  });

  test('detects out of office message', async () => {
    const result = await classifier.classify({
      replyText: `I am currently out of the office with limited access to email.
I will respond to your message when I return on Monday, January 22nd.`,
    });

    expect(result.intent).toBe('out_of_office');
    expect(result.intent_confidence).toBe(0.95);
    expect(result.model_version).toBe('heuristic');
    expect(result.tokens_used).toBe(0);
  });

  test('detects vacation auto-reply', async () => {
    const result = await classifier.classify({
      replyText: `Thank you for your email. I am currently on vacation
and will return on February 1st.`,
    });

    expect(result.intent).toBe('out_of_office');
    expect(result.urgency).toBe('low');
  });

  test('detects delivery failure bounce', async () => {
    const result = await classifier.classify({
      replyText: `Delivery Status Notification (Failure)

This is an automatically generated Delivery Status Notification.
Delivery to the following recipient failed permanently:
    user@domain.com`,
    });

    expect(result.intent).toBe('bounce');
    expect(result.reply_type).toBe('bounce_handling');
  });
});

// ===========================================
// Complexity Assessment Tests
// ===========================================

describe('Complexity assessment', () => {
  let classifier: ReplyClassifier;
  let mockClient: ReturnType<typeof createMockAnthropicClient>;

  beforeEach(() => {
    mockClient = createMockAnthropicClient({
      intent: 'positive_interest',
      confidence: 0.90,
      sentiment: 0.5,
    });
    classifier = createClassifier({ client: mockClient as any });
  });

  test('assesses simple reply', async () => {
    const result = await classifier.classify({
      replyText: 'Yes, sounds good!',
    });

    expect(result.complexity).toBe('simple');
  });

  test('assesses complex reply with multiple questions', async () => {
    mockClient = createMockAnthropicClient({
      intent: 'question',
      confidence: 0.45,
      sentiment: 0.0,
    });
    classifier = createClassifier({ client: mockClient as any });

    const longReply = `I have several questions about your platform.

    First, can you explain how the integration works with our existing CRM?
    Second, what's the typical implementation timeline?
    Third, do you offer customization for our specific industry needs?

    Also, I'd need to get approval from our IT team and finance department.
    Can you provide a detailed security assessment and pricing breakdown?

    We're currently evaluating three other vendors as well.`;

    const result = await classifier.classify({
      replyText: longReply,
    });

    expect(result.complexity).toBe('complex');
  });

  test('assesses medium complexity reply', async () => {
    // Medium complexity requires: confidence < 0.7 OR multiple intents OR longer text
    mockClient = createMockAnthropicClient({
      intent: 'question',
      confidence: 0.65, // Below 0.7 threshold
      sentiment: 0.2,
    });
    classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: `That's interesting. Could you tell me more about pricing?
I'd also like to know about implementation.`,
    });

    expect(result.complexity).toBe('medium');
  });

  test('marks negative sentiment as higher complexity', async () => {
    mockClient = createMockAnthropicClient({
      intent: 'objection',
      confidence: 0.85,
      sentiment: -0.7,
    });
    classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: "This is way too expensive and I'm frustrated with these emails.",
    });

    expect(result.complexity).toBe('complex');
    expect(result.urgency).toBe('high');
  });
});

// ===========================================
// Urgency Derivation Tests
// ===========================================

describe('Urgency derivation', () => {
  let mockClient: ReturnType<typeof createMockAnthropicClient>;

  test('positive interest has high urgency', async () => {
    mockClient = createMockAnthropicClient({
      intent: 'positive_interest',
      confidence: 0.92,
      sentiment: 0.8,
    });
    const classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: "Yes! I'm excited to learn more!",
    });

    expect(result.urgency).toBe('high');
  });

  test('out_of_office has low urgency', async () => {
    const mockClient = createMockAnthropicClient();
    const classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: `I am currently out of the office with limited access to email.
I will return on Monday and respond to your message then.`,
    });

    expect(result.urgency).toBe('low');
  });

  test('question has medium urgency', async () => {
    mockClient = createMockAnthropicClient({
      intent: 'question',
      confidence: 0.85,
      sentiment: 0.3,
    });
    const classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: 'What are your pricing plans?',
    });

    expect(result.urgency).toBe('medium');
  });
});

// ===========================================
// Response Parsing Tests
// ===========================================

describe('Response parsing edge cases', () => {
  test('handles malformed JSON response', async () => {
    const mockClient = {
      messages: {
        create: mock(async () => ({
          content: [{ type: 'text', text: 'not valid json' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        })),
      },
    };
    const classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: 'Some reply text',
    });

    expect(result.intent).toBe('unclear');
    expect(result.intent_confidence).toBe(0.5);
  });

  test('handles partial JSON response', async () => {
    const mockClient = {
      messages: {
        create: mock(async () => ({
          content: [
            {
              type: 'text',
              text: 'Here is the analysis: {"intent": "question"}',
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        })),
      },
    };
    const classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: 'What is the pricing?',
    });

    expect(result.intent).toBe('question');
    // Should use defaults for missing fields
    expect(result.intent_confidence).toBe(0.5);
    expect(result.sentiment).toBe(0);
  });

  test('clamps confidence values to valid range', async () => {
    const mockClient = {
      messages: {
        create: mock(async () => ({
          content: [
            {
              type: 'text',
              text: '{"intent": "positive_interest", "confidence": 1.5, "sentiment": -2.0}',
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        })),
      },
    };
    const classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: 'Yes please!',
    });

    expect(result.intent_confidence).toBeLessThanOrEqual(1.0);
    expect(result.sentiment).toBeGreaterThanOrEqual(-1.0);
  });

  test('validates intent values', async () => {
    const mockClient = {
      messages: {
        create: mock(async () => ({
          content: [
            {
              type: 'text',
              text: '{"intent": "invalid_intent", "confidence": 0.9}',
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        })),
      },
    };
    const classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: 'Some reply',
    });

    expect(result.intent).toBe('unclear');
  });
});

// ===========================================
// Classification Metadata Tests
// ===========================================

describe('Classification metadata', () => {
  test('includes classification timestamp', async () => {
    const mockClient = createMockAnthropicClient();
    const classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: 'Yes, interested!',
    });

    expect(result.classified_at).toBeDefined();
    expect(new Date(result.classified_at!).getTime()).toBeLessThanOrEqual(Date.now());
  });

  test('includes model version', async () => {
    const mockClient = createMockAnthropicClient();
    const classifier = createClassifier({
      client: mockClient as any,
      model: 'claude-sonnet-4-20250514',
    });

    const result = await classifier.classify({
      replyText: 'Yes, interested!',
    });

    expect(result.model_version).toBe('claude-sonnet-4-20250514');
  });

  test('tracks tokens used', async () => {
    const mockClient = createMockAnthropicClient();
    const classifier = createClassifier({ client: mockClient as any });

    const result = await classifier.classify({
      replyText: 'Yes, interested!',
    });

    expect(result.tokens_used).toBe(150); // 100 input + 50 output from mock
  });
});
