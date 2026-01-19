/**
 * Reply Handler KB Matcher Tests
 *
 * Tests for KB template and objection handler matching against Qdrant.
 * Uses mocked Qdrant client and embedder to test matching logic.
 *
 * @module __tests__/reply-handler/matcher.test
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  KBMatcher,
  createMatcher,
  isEligibleForTier,
  getRecommendedTier,
} from '../../reply-handler/matcher';
import type { Classification, KBMatch } from '../../reply-handler/contracts/handler-result';

// ===========================================
// Mock Factories
// ===========================================

function createMockEmbedder() {
  return mock(async (text: string) => {
    // Return a deterministic 1024-dim vector based on text length
    return Array(1024).fill(0).map((_, i) => Math.sin(i + text.length) * 0.1);
  });
}

function createMockQdrantClient(
  searchResults?: Array<{ score: number; payload: Record<string, any> }>
) {
  const defaultResults = searchResults ?? [
    {
      score: 0.92,
      payload: {
        id: 'template_001',
        brain_id: 'brain_fintech',
        reply_type: 'positive_response',
        tier_eligible: [1, 2],
        content: 'Hi {{first_name}}, Thanks for your interest!',
        personalization_instructions: 'Reference their industry',
      },
    },
  ];

  return {
    search: mock(async () => defaultResults),
    count: mock(async () => ({ count: 10 })),
  };
}

function createClassification(overrides: Partial<Classification> = {}): Classification {
  return {
    intent: 'positive_interest',
    intent_confidence: 0.90,
    sentiment: 0.75,
    complexity: 'simple',
    urgency: 'medium',
    reply_type: 'positive_response',
    ...overrides,
  };
}

// ===========================================
// Matcher Creation Tests
// ===========================================

describe('KBMatcher creation', () => {
  test('creates matcher with default configuration', () => {
    const mockQdrant = createMockQdrantClient();
    const mockEmbedder = createMockEmbedder();

    const matcher = createMatcher({
      qdrantClient: mockQdrant as any,
      embedder: mockEmbedder,
    });

    expect(matcher).toBeDefined();
    expect(matcher).toBeInstanceOf(KBMatcher);
  });

  test('creates matcher with custom collection names', () => {
    const mockQdrant = createMockQdrantClient();
    const mockEmbedder = createMockEmbedder();

    const matcher = createMatcher({
      qdrantClient: mockQdrant as any,
      embedder: mockEmbedder,
      collections: {
        responseTemplates: 'custom_templates',
        objectionHandlers: 'custom_handlers',
      },
    });

    expect(matcher).toBeDefined();
  });

  test('creates matcher with custom search config', () => {
    const mockQdrant = createMockQdrantClient();
    const mockEmbedder = createMockEmbedder();

    const matcher = createMatcher({
      qdrantClient: mockQdrant as any,
      embedder: mockEmbedder,
      searchConfig: {
        limit: 10,
        minScore: 0.7,
      },
    });

    expect(matcher).toBeDefined();
  });
});

// ===========================================
// Response Template Matching Tests
// ===========================================

describe('Response template matching', () => {
  let matcher: KBMatcher;
  let mockQdrant: ReturnType<typeof createMockQdrantClient>;
  let mockEmbedder: ReturnType<typeof createMockEmbedder>;

  beforeEach(() => {
    mockQdrant = createMockQdrantClient();
    mockEmbedder = createMockEmbedder();
    matcher = createMatcher({
      qdrantClient: mockQdrant as any,
      embedder: mockEmbedder,
    });
  });

  test('finds template match for positive interest', async () => {
    const classification = createClassification({
      intent: 'positive_interest',
      reply_type: 'positive_response',
    });

    const result = await matcher.findMatch({
      classification,
      replyText: "Yes, I'd love to learn more!",
      brainId: 'brain_fintech',
    });

    expect(result).toBeDefined();
    expect(result?.type).toBe('template');
    expect(result?.confidence).toBeGreaterThan(0.85);
  });

  test('includes brain_id filter in search', async () => {
    const classification = createClassification();

    await matcher.findMatch({
      classification,
      replyText: 'Some reply',
      brainId: 'brain_fintech',
    });

    expect(mockQdrant.search).toHaveBeenCalled();
    const searchCall = (mockQdrant.search as any).mock.calls[0];
    expect(searchCall[1].filter.must).toContainEqual({
      key: 'brain_id',
      match: { value: 'brain_fintech' },
    });
  });

  test('includes reply_type filter in search', async () => {
    const classification = createClassification({
      reply_type: 'question_response',
    });

    await matcher.findMatch({
      classification,
      replyText: 'What is the pricing?',
      brainId: 'brain_fintech',
    });

    expect(mockQdrant.search).toHaveBeenCalled();
    const searchCall = (mockQdrant.search as any).mock.calls[0];
    expect(searchCall[1].filter.must).toContainEqual({
      key: 'reply_type',
      match: { value: 'question_response' },
    });
  });

  test('returns undefined when no matches above threshold', async () => {
    mockQdrant = createMockQdrantClient([
      { score: 0.3, payload: { id: 'template_001' } },
    ]);
    matcher = createMatcher({
      qdrantClient: mockQdrant as any,
      embedder: mockEmbedder,
    });

    const classification = createClassification();

    const result = await matcher.findMatch({
      classification,
      replyText: 'Some obscure reply',
      brainId: 'brain_fintech',
    });

    expect(result).toBeUndefined();
  });

  test('applies confidence penalty for fallback search', async () => {
    // First search returns no results, second (fallback) returns results
    let callCount = 0;
    mockQdrant = {
      search: mock(async () => {
        callCount++;
        if (callCount === 1) {
          return []; // No results for specific reply_type
        }
        return [
          {
            score: 0.80,
            payload: {
              id: 'template_fallback',
              brain_id: 'brain_fintech',
              content: 'Fallback template',
            },
          },
        ];
      }),
      count: mock(async () => ({ count: 10 })),
    };

    matcher = createMatcher({
      qdrantClient: mockQdrant as any,
      embedder: mockEmbedder,
    });

    const classification = createClassification();

    const result = await matcher.findMatch({
      classification,
      replyText: 'Some reply',
      brainId: 'brain_fintech',
    });

    expect(result).toBeDefined();
    // Confidence should be penalized (0.80 * 0.9 = 0.72)
    expect(result?.confidence).toBeLessThan(0.80);
  });
});

// ===========================================
// Objection Handler Matching Tests
// ===========================================

describe('Objection handler matching', () => {
  let matcher: KBMatcher;
  let mockQdrant: ReturnType<typeof createMockQdrantClient>;
  let mockEmbedder: ReturnType<typeof createMockEmbedder>;

  beforeEach(() => {
    mockQdrant = createMockQdrantClient([
      {
        score: 0.88,
        payload: {
          id: 'handler_budget_001',
          brain_id: 'brain_fintech',
          objection_type: 'budget',
          strategy: 'value_focus',
          content: 'I understand budget is a concern. Let me share...',
        },
      },
    ]);
    mockEmbedder = createMockEmbedder();
    matcher = createMatcher({
      qdrantClient: mockQdrant as any,
      embedder: mockEmbedder,
    });
  });

  test('routes objection intent to handler search', async () => {
    const classification = createClassification({
      intent: 'objection',
      reply_type: 'objection_handler',
    });

    const result = await matcher.findMatch({
      classification,
      replyText: "We don't have the budget for this.",
      brainId: 'brain_fintech',
    });

    expect(result).toBeDefined();
    expect(result?.type).toBe('handler');
  });

  test('detects budget objection type', () => {
    const type = matcher.detectObjectionType("This is too expensive for our budget.");
    expect(type).toBe('budget');
  });

  test('detects timing objection type', () => {
    const type = matcher.detectObjectionType("Not the right time, maybe next quarter.");
    expect(type).toBe('timing');
  });

  test('detects authority objection type', () => {
    const type = matcher.detectObjectionType("I need to check with my manager first.");
    expect(type).toBe('authority');
  });

  test('detects competitor objection type', () => {
    const type = matcher.detectObjectionType("We're already using a competitor solution.");
    expect(type).toBe('competitor');
  });

  test('returns undefined for unclear objection type', () => {
    const type = matcher.detectObjectionType("I'm not sure about this.");
    expect(type).toBeUndefined();
  });

  test('includes objection_type filter when detected', async () => {
    const classification = createClassification({
      intent: 'objection',
      reply_type: 'objection_handler',
    });

    await matcher.findMatch({
      classification,
      replyText: "We can't afford this.",
      brainId: 'brain_fintech',
    });

    const searchCall = (mockQdrant.search as any).mock.calls[0];
    const mustFilters = searchCall[1].filter.must;

    expect(mustFilters).toContainEqual({
      key: 'objection_type',
      match: { value: 'budget' },
    });
  });
});

// ===========================================
// Batch Matching Tests
// ===========================================

describe('Batch matching', () => {
  test('matches multiple replies in parallel', async () => {
    const mockQdrant = createMockQdrantClient();
    const mockEmbedder = createMockEmbedder();
    const matcher = createMatcher({
      qdrantClient: mockQdrant as any,
      embedder: mockEmbedder,
    });

    const params = [
      {
        classification: createClassification({ intent: 'positive_interest' }),
        replyText: 'Yes, interested!',
        brainId: 'brain_fintech',
      },
      {
        classification: createClassification({ intent: 'question' }),
        replyText: 'What is the pricing?',
        brainId: 'brain_fintech',
      },
    ];

    const results = await matcher.matchBatch(params);

    expect(results).toHaveLength(2);
  });
});

// ===========================================
// KB Health Check Tests
// ===========================================

describe('KB health check', () => {
  test('returns healthy status when collections have content', async () => {
    const mockQdrant = createMockQdrantClient();
    const mockEmbedder = createMockEmbedder();
    const matcher = createMatcher({
      qdrantClient: mockQdrant as any,
      embedder: mockEmbedder,
    });

    const health = await matcher.checkKBHealth('brain_fintech');

    expect(health.healthy).toBe(true);
    expect(health.templateCount).toBeGreaterThan(0);
  });

  test('returns unhealthy status when collections are empty', async () => {
    const mockQdrant = {
      ...createMockQdrantClient(),
      count: mock(async () => ({ count: 0 })),
    };
    const mockEmbedder = createMockEmbedder();
    const matcher = createMatcher({
      qdrantClient: mockQdrant as any,
      embedder: mockEmbedder,
    });

    const health = await matcher.checkKBHealth('brain_unknown');

    expect(health.healthy).toBe(false);
    expect(health.templateCount).toBe(0);
    expect(health.handlerCount).toBe(0);
  });

  test('handles errors gracefully', async () => {
    const mockQdrant = {
      ...createMockQdrantClient(),
      count: mock(async () => {
        throw new Error('Connection failed');
      }),
    };
    const mockEmbedder = createMockEmbedder();
    const matcher = createMatcher({
      qdrantClient: mockQdrant as any,
      embedder: mockEmbedder,
    });

    const health = await matcher.checkKBHealth('brain_fintech');

    expect(health.healthy).toBe(false);
  });
});

// ===========================================
// Tier Eligibility Helper Tests
// ===========================================

describe('isEligibleForTier helper', () => {
  const highConfidenceMatch: KBMatch = {
    type: 'template',
    id: 'template_001',
    confidence: 0.92,
    content: 'Some content',
  };

  const mediumConfidenceMatch: KBMatch = {
    type: 'template',
    id: 'template_002',
    confidence: 0.70,
    content: 'Some content',
  };

  const lowConfidenceMatch: KBMatch = {
    type: 'template',
    id: 'template_003',
    confidence: 0.40,
    content: 'Some content',
  };

  test('high confidence is eligible for Tier 1', () => {
    expect(isEligibleForTier(highConfidenceMatch, 1)).toBe(true);
    expect(isEligibleForTier(highConfidenceMatch, 2)).toBe(false);
    expect(isEligibleForTier(highConfidenceMatch, 3)).toBe(false);
  });

  test('medium confidence is eligible for Tier 2', () => {
    expect(isEligibleForTier(mediumConfidenceMatch, 1)).toBe(false);
    expect(isEligibleForTier(mediumConfidenceMatch, 2)).toBe(true);
    expect(isEligibleForTier(mediumConfidenceMatch, 3)).toBe(false);
  });

  test('low confidence is eligible for Tier 3', () => {
    expect(isEligibleForTier(lowConfidenceMatch, 1)).toBe(false);
    expect(isEligibleForTier(lowConfidenceMatch, 2)).toBe(false);
    expect(isEligibleForTier(lowConfidenceMatch, 3)).toBe(true);
  });

  test('boundary value 0.85 is eligible for Tier 1', () => {
    const boundaryMatch: KBMatch = { ...highConfidenceMatch, confidence: 0.85 };
    expect(isEligibleForTier(boundaryMatch, 1)).toBe(true);
  });

  test('boundary value 0.50 is eligible for Tier 2', () => {
    const boundaryMatch: KBMatch = { ...highConfidenceMatch, confidence: 0.50 };
    expect(isEligibleForTier(boundaryMatch, 2)).toBe(true);
  });
});

// ===========================================
// Recommended Tier Helper Tests
// ===========================================

describe('getRecommendedTier helper', () => {
  test('recommends Tier 1 for high confidence match', () => {
    const match: KBMatch = {
      type: 'template',
      id: 'template_001',
      confidence: 0.92,
      content: 'Some content',
    };
    expect(getRecommendedTier(match)).toBe(1);
  });

  test('recommends Tier 2 for medium confidence match', () => {
    const match: KBMatch = {
      type: 'template',
      id: 'template_001',
      confidence: 0.70,
      content: 'Some content',
    };
    expect(getRecommendedTier(match)).toBe(2);
  });

  test('recommends Tier 3 for low confidence match', () => {
    const match: KBMatch = {
      type: 'template',
      id: 'template_001',
      confidence: 0.40,
      content: 'Some content',
    };
    expect(getRecommendedTier(match)).toBe(3);
  });

  test('recommends Tier 3 when no match', () => {
    expect(getRecommendedTier(undefined)).toBe(3);
  });
});
