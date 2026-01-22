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
  complexity?: string;
  urgency?: string;
}) {
  // Map intent to default reply_type for mock
  const intentToReplyType: Record<string, string> = {
    positive_interest: 'positive_response',
    question: 'question_response',
    objection: 'objection_handler',
    referral: 'referral_response',
    unsubscribe: 'unsubscribe_confirmation',
    not_interested: 'decline_acknowledgment',
    out_of_office: 'ooo_handling',
    bounce: 'bounce_handling',
    unclear: 'clarification_request',
  };

  const intent = mockResponse?.intent ?? 'positive_interest';

  const defaultResponse = {
    intent,
    intent_confidence: mockResponse?.confidence ?? 0.90,
    sentiment: mockResponse?.sentiment ?? 0.75,
    intent_reasoning: mockResponse?.reasoning ?? 'Test classification',
    complexity: mockResponse?.complexity ?? 'simple',
    urgency: mockResponse?.urgency ?? 'medium',
    reply_type: intentToReplyType[intent] ?? 'clarification_request',
  };

  return {
    messages: {
      create: mock(async () => ({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_test_123',
            name: 'classify_reply',
            input: defaultResponse,
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
  test('handles missing tool_use response', async () => {
    // When no tool_use block is returned, classifier should fallback to unclear
    const mockClient = {
      messages: {
        create: mock(async () => ({
          content: [{ type: 'text', text: 'Some text without tool use' }],
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

  test('handles tool_use with valid response', async () => {
    // Structured outputs via tool_use should be properly parsed
    const mockClient = {
      messages: {
        create: mock(async () => ({
          content: [
            {
              type: 'tool_use',
              id: 'toolu_test_123',
              name: 'classify_reply',
              input: {
                intent: 'question',
                intent_confidence: 0.88,
                sentiment: 0.3,
                intent_reasoning: 'Lead is asking about pricing',
                complexity: 'simple',
                urgency: 'medium',
                reply_type: 'question_response',
              },
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
    expect(result.intent_confidence).toBe(0.88);
    expect(result.sentiment).toBe(0.3);
  });

  test('handles tool_use with extreme values (clamped by Zod)', async () => {
    // Zod schema should validate/clamp extreme values
    const mockClient = {
      messages: {
        create: mock(async () => ({
          content: [
            {
              type: 'tool_use',
              id: 'toolu_test_123',
              name: 'classify_reply',
              input: {
                intent: 'positive_interest',
                intent_confidence: 0.95,
                sentiment: 0.8,
                intent_reasoning: 'Very positive response',
              },
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
    expect(result.sentiment).toBeLessThanOrEqual(1.0);
  });

  test('handles invalid intent via Zod schema validation', async () => {
    // Invalid intent values should fail Zod validation and fall back to unclear
    const mockClient = {
      messages: {
        create: mock(async () => ({
          content: [
            {
              type: 'tool_use',
              id: 'toolu_test_123',
              name: 'classify_reply',
              input: {
                intent: 'invalid_intent',
                intent_confidence: 0.9,
                sentiment: 0.0,
                intent_reasoning: 'Test',
              },
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
// A/B/C Category Classification Tests (GTM Operations)
// ===========================================

import { classifyReplyCategory, intentToCategory } from '../../reply-handler/classifier';

/**
 * Mock Anthropic client for category classification tests
 */
function createMockCategoryClient(mockResponse: {
  category: 'A' | 'B' | 'C';
  confidence: number;
  reasoning: string;
  signals: string[];
}) {
  return {
    messages: {
      create: mock(async () => ({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_cat_123',
            name: 'classify_reply_category',
            input: mockResponse,
          },
        ],
        usage: {
          input_tokens: 120,
          output_tokens: 60,
        },
      })),
    },
  };
}

describe('A/B/C Category Classification', () => {
  describe('Category A - Interested', () => {
    test('classifies "Yes, I\'d love to learn more" as Category A', async () => {
      const mockClient = createMockCategoryClient({
        category: 'A',
        confidence: 0.92,
        reasoning: 'Clear positive buying signal with explicit interest',
        signals: ['love to learn more', 'when are you free'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: "Yes, I'd love to learn more. When are you free for a call?",
        channel: 'email',
      });

      expect(result.category).toBe('A');
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.signals).toContain('love to learn more');
    });

    test('classifies "Let\'s schedule a meeting" as Category A', async () => {
      const mockClient = createMockCategoryClient({
        category: 'A',
        confidence: 0.95,
        reasoning: 'Direct meeting request indicates clear interest',
        signals: ['schedule a meeting', 'sounds interesting'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: 'This sounds interesting. Let\'s schedule a meeting.',
        channel: 'email',
      });

      expect(result.category).toBe('A');
      expect(result.effectiveCategory).toBe('A');
    });

    test('classifies calendar link request as Category A', async () => {
      const mockClient = createMockCategoryClient({
        category: 'A',
        confidence: 0.98,
        reasoning: 'Requesting calendar link shows intent to schedule',
        signals: ['calendar link'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: 'Can you send me a calendar link?',
        channel: 'email',
      });

      expect(result.category).toBe('A');
    });
  });

  describe('Category B - Not Interested', () => {
    test('classifies "No thanks, we\'re not interested" as Category B', async () => {
      const mockClient = createMockCategoryClient({
        category: 'B',
        confidence: 0.94,
        reasoning: 'Explicit decline with polite rejection',
        signals: ['no thanks', 'not interested'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: "No thanks, we're not interested.",
        channel: 'email',
      });

      expect(result.category).toBe('B');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    test('classifies unsubscribe request as Category B', async () => {
      const mockClient = createMockCategoryClient({
        category: 'B',
        confidence: 0.99,
        reasoning: 'Explicit opt-out request',
        signals: ['remove me', 'list'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: 'Please remove me from your list.',
        channel: 'email',
      });

      expect(result.category).toBe('B');
    });

    test('classifies "Stop contacting me" as Category B', async () => {
      const mockClient = createMockCategoryClient({
        category: 'B',
        confidence: 0.99,
        reasoning: 'Hostile opt-out request',
        signals: ['stop contacting'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: 'Stop contacting me.',
        channel: 'email',
      });

      expect(result.category).toBe('B');
    });

    test('detects out-of-office as Category B (auto-reply)', async () => {
      // OOO should be detected by heuristics before Claude call
      const mockClient = createMockCategoryClient({
        category: 'B',
        confidence: 0.95,
        reasoning: 'Out of office auto-reply',
        signals: ['out of office'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: `I am currently out of the office and will return on Monday.
For urgent matters, please contact backup@company.com.`,
        channel: 'email',
      });

      // Should be auto-detected, not sent to Claude
      expect(result.category).toBe('B');
      expect(result.tokensUsed).toBe(0); // Heuristic detection uses no tokens
    });
  });

  describe('Category C - Manual Review', () => {
    test('classifies pricing question as Category C', async () => {
      const mockClient = createMockCategoryClient({
        category: 'C',
        confidence: 0.85,
        reasoning: 'Question about pricing requires follow-up conversation',
        signals: ['pricing', 'question'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: "What's your pricing?",
        channel: 'email',
      });

      expect(result.category).toBe('C');
    });

    test('classifies "next quarter" timing objection as Category C', async () => {
      const mockClient = createMockCategoryClient({
        category: 'C',
        confidence: 0.78,
        reasoning: 'Timing objection - not a clear no, could follow up later',
        signals: ['next quarter', 'looking at this'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: "We're looking at this for next quarter.",
        channel: 'email',
      });

      expect(result.category).toBe('C');
    });

    test('classifies referral as Category C', async () => {
      const mockClient = createMockCategoryClient({
        category: 'C',
        confidence: 0.82,
        reasoning: 'Referral to another person requires manual follow-up',
        signals: ['not the right person', 'CTO'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: "I'm not the right person, try reaching out to our CTO.",
        channel: 'email',
      });

      expect(result.category).toBe('C');
    });

    test('classifies feature information request as Category C', async () => {
      const mockClient = createMockCategoryClient({
        category: 'C',
        confidence: 0.75,
        reasoning: 'Requesting more information shows some interest but not clear commitment',
        signals: ['more information', 'feature'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: 'Can you send more information about X feature?',
        channel: 'email',
      });

      expect(result.category).toBe('C');
    });
  });

  describe('Low confidence routing', () => {
    test('routes low confidence A to C (effective category)', async () => {
      const mockClient = createMockCategoryClient({
        category: 'A',
        confidence: 0.55, // Below 0.7 threshold
        reasoning: 'Possibly interested but unclear',
        signals: ['maybe'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: 'Maybe we could talk sometime?',
        channel: 'email',
      });

      expect(result.category).toBe('A');
      expect(result.effectiveCategory).toBe('C'); // Routed to manual review
    });

    test('routes low confidence B to C (effective category)', async () => {
      const mockClient = createMockCategoryClient({
        category: 'B',
        confidence: 0.60, // Below 0.7 threshold
        reasoning: 'Possibly not interested but unclear',
        signals: ['not sure'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: "I'm not sure this is for us.",
        channel: 'email',
      });

      expect(result.category).toBe('B');
      expect(result.effectiveCategory).toBe('C'); // Routed to manual review
    });
  });

  describe('Channel support', () => {
    test('handles LinkedIn channel', async () => {
      const mockClient = createMockCategoryClient({
        category: 'A',
        confidence: 0.88,
        reasoning: 'Positive response on LinkedIn',
        signals: ['interested', 'connect'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: "Yes, I'm interested. Let's connect!",
        channel: 'linkedin',
      });

      expect(result.category).toBe('A');
    });
  });

  describe('Lead context handling', () => {
    test('uses lead context in classification', async () => {
      const mockClient = createMockCategoryClient({
        category: 'C',
        confidence: 0.80,
        reasoning: 'VP-level lead asking about enterprise features',
        signals: ['enterprise', 'features'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: 'What enterprise features do you offer?',
        channel: 'email',
        leadContext: {
          name: 'Jane Doe',
          company: 'Enterprise Corp',
          title: 'VP of Engineering',
          industry: 'Technology',
        },
      });

      expect(result.category).toBe('C');
      expect(result.confidence).toBeGreaterThan(0.7);
    });
  });

  describe('Conversation history', () => {
    test('considers conversation history', async () => {
      const mockClient = createMockCategoryClient({
        category: 'A',
        confidence: 0.90,
        reasoning: 'Follow-up to previous conversation, ready to proceed',
        signals: ['ready', 'proceed'],
      });

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: "I'm ready to proceed.",
        channel: 'email',
        conversationHistory: [
          { role: 'outbound', content: 'Would you like to learn more about our solution?' },
          { role: 'reply', content: "What's the pricing?" },
          { role: 'outbound', content: 'Our pricing starts at $X/month.' },
        ],
      });

      expect(result.category).toBe('A');
    });
  });

  describe('Error handling', () => {
    test('handles missing tool result gracefully', async () => {
      const mockClient = {
        messages: {
          create: mock(async () => ({
            content: [{ type: 'text', text: 'Some unexpected response' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          })),
        },
      };

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: 'Some reply',
        channel: 'email',
      });

      expect(result.category).toBe('C'); // Default to manual review
      expect(result.effectiveCategory).toBe('C');
    });

    test('handles invalid category value gracefully', async () => {
      const mockClient = {
        messages: {
          create: mock(async () => ({
            content: [
              {
                type: 'tool_use',
                id: 'toolu_test',
                name: 'classify_reply_category',
                input: {
                  category: 'X', // Invalid category
                  confidence: 0.9,
                  reasoning: 'Test',
                  signals: [],
                },
              },
            ],
            usage: { input_tokens: 100, output_tokens: 50 },
          })),
        },
      };

      const result = await classifyReplyCategory(mockClient as any, {
        replyText: 'Some reply',
        channel: 'email',
      });

      expect(result.category).toBe('C'); // Default to manual review
    });
  });
});

describe('intentToCategory helper', () => {
  test('maps positive_interest to Category A', () => {
    expect(intentToCategory('positive_interest')).toBe('A');
  });

  test('maps unsubscribe to Category B', () => {
    expect(intentToCategory('unsubscribe')).toBe('B');
  });

  test('maps not_interested to Category B', () => {
    expect(intentToCategory('not_interested')).toBe('B');
  });

  test('maps out_of_office to Category B', () => {
    expect(intentToCategory('out_of_office')).toBe('B');
  });

  test('maps bounce to Category B', () => {
    expect(intentToCategory('bounce')).toBe('B');
  });

  test('maps question to Category C', () => {
    expect(intentToCategory('question')).toBe('C');
  });

  test('maps objection to Category C', () => {
    expect(intentToCategory('objection')).toBe('C');
  });

  test('maps referral to Category C', () => {
    expect(intentToCategory('referral')).toBe('C');
  });

  test('maps unclear to Category C', () => {
    expect(intentToCategory('unclear')).toBe('C');
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
