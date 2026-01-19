/**
 * Reply Handler Router Tests
 *
 * Tests for tier routing logic based on classification and KB matches.
 * The router determines which tier (1-3) should handle a reply.
 *
 * Tier Routing Rules:
 * - Tier 1: Auto-respond (confidence >= 0.85 with KB match)
 * - Tier 2: Draft approval (confidence 0.50-0.85 or no KB match)
 * - Tier 3: Human escalation (confidence < 0.50 or complex)
 *
 * @module __tests__/reply-handler/router.test
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { TierRouter, createRouter } from '../../reply-handler/router';
import type { Classification, KBMatch } from '../../reply-handler/contracts/handler-result';

// ===========================================
// Test Fixtures
// ===========================================

function createClassification(overrides: Partial<Classification> = {}): Classification {
  return {
    intent: 'positive_interest',
    intent_confidence: 0.90,
    sentiment: 0.75,
    complexity: 'simple',
    urgency: 'medium',
    topics: ['pricing', 'demo'],
    extracted_questions: [],
    tokens_used: 150,
    ...overrides,
  };
}

function createKBMatch(overrides: Partial<KBMatch> = {}): KBMatch {
  return {
    type: 'template',
    id: 'template_positive_interest_001',
    confidence: 0.92,
    content: 'Hi {{first_name}}, Thanks for your interest!',
    ...overrides,
  };
}

// ===========================================
// Router Creation Tests
// ===========================================

describe('TierRouter creation', () => {
  test('creates router with default thresholds', () => {
    const router = createRouter();
    expect(router).toBeDefined();
    expect(router.route).toBeInstanceOf(Function);
  });

  test('creates router with custom thresholds', () => {
    const router = createRouter({
      thresholds: {
        tier1_min_confidence: 0.90,
        tier2_min_confidence: 0.60,
        kb_match_min_confidence: 0.80,
      },
    });
    expect(router).toBeDefined();
  });
});

// ===========================================
// Tier 1 Routing Tests
// ===========================================

describe('Tier 1 routing (auto-respond)', () => {
  let router: TierRouter;

  beforeEach(() => {
    router = createRouter();
  });

  test('routes to Tier 1 with high confidence positive interest and KB match', () => {
    const classification = createClassification({
      intent: 'positive_interest',
      intent_confidence: 0.92,
    });
    const kbMatch = createKBMatch({ confidence: 0.90 });

    const result = router.route({ classification, kbMatch });

    expect(result.tier).toBe(1);
    expect(result.reason).toContain('confidence');
  });

  test('routes to Tier 1 with exactly 0.85 confidence', () => {
    const classification = createClassification({
      intent: 'positive_interest',
      intent_confidence: 0.85,
    });
    const kbMatch = createKBMatch({ confidence: 0.85 });

    const result = router.route({ classification, kbMatch });

    expect(result.tier).toBe(1);
  });

  test('does not route question intent to Tier 1 (only positive_interest eligible)', () => {
    // Question intent is NOT eligible for Tier 1 auto-respond
    // Only positive_interest with high KB match confidence gets Tier 1
    const classification = createClassification({
      intent: 'question',
      intent_confidence: 0.88,
      complexity: 'simple',
    });
    const kbMatch = createKBMatch({
      type: 'handler',
      confidence: 0.90,
    });

    const result = router.route({ classification, kbMatch });

    // Question intent goes to Tier 2 for approval, not Tier 1
    expect(result.tier).toBe(2);
  });

  test('does not route to Tier 1 without KB match', () => {
    const classification = createClassification({
      intent: 'positive_interest',
      intent_confidence: 0.95,
    });

    const result = router.route({ classification, kbMatch: undefined });

    expect(result.tier).not.toBe(1);
  });

  test('does not route to Tier 1 with low KB match confidence', () => {
    const classification = createClassification({
      intent: 'positive_interest',
      intent_confidence: 0.92,
    });
    const kbMatch = createKBMatch({ confidence: 0.60 });

    const result = router.route({ classification, kbMatch });

    expect(result.tier).not.toBe(1);
  });
});

// ===========================================
// Tier 2 Routing Tests
// ===========================================

describe('Tier 2 routing (draft approval)', () => {
  let router: TierRouter;

  beforeEach(() => {
    router = createRouter();
  });

  test('routes to Tier 2 with moderate confidence', () => {
    const classification = createClassification({
      intent: 'positive_interest',
      intent_confidence: 0.70,
    });
    const kbMatch = createKBMatch({ confidence: 0.75 });

    const result = router.route({ classification, kbMatch });

    expect(result.tier).toBe(2);
    expect(result.reason).toContain('confidence');
  });

  test('routes to Tier 3 when no KB match (escalates for human handling)', () => {
    // Without KB match, even high confidence goes to Tier 3
    const classification = createClassification({
      intent: 'positive_interest',
      intent_confidence: 0.95,
    });

    const result = router.route({ classification, kbMatch: undefined });

    // No KB match = escalate to Tier 3
    expect(result.tier).toBe(3);
    expect(result.reason).toContain('No matching KB template');
  });

  test('routes to Tier 2 for objection with moderate confidence', () => {
    const classification = createClassification({
      intent: 'objection',
      intent_confidence: 0.75,
    });
    const kbMatch = createKBMatch({
      type: 'handler',
      confidence: 0.80,
    });

    const result = router.route({ classification, kbMatch });

    expect(result.tier).toBe(2);
  });

  test('routes to Tier 2 when KB match confidence is moderate (0.50-0.85)', () => {
    const classification = createClassification({
      intent: 'positive_interest',
      intent_confidence: 0.90,
    });
    // KB match with confidence below tier1 threshold (0.85) but above tier2 threshold (0.50)
    const kbMatch = createKBMatch({ confidence: 0.70 });

    const result = router.route({ classification, kbMatch });

    expect(result.tier).toBe(2);
  });
});

// ===========================================
// Tier 3 Routing Tests
// ===========================================

describe('Tier 3 routing (human escalation)', () => {
  let router: TierRouter;

  beforeEach(() => {
    router = createRouter();
  });

  test('routes to Tier 3 with unclear intent', () => {
    const classification = createClassification({
      intent: 'unclear',
      intent_confidence: 0.35,
    });
    // Provide KB match to isolate the unclear intent test
    const kbMatch = createKBMatch({ confidence: 0.70 });

    const result = router.route({ classification, kbMatch });

    expect(result.tier).toBe(3);
    expect(result.reason).toContain('Unable to determine reply intent');
  });

  test('routes to Tier 3 for not_interested when lead has high score', () => {
    // not_interested only escalates to Tier 3 when lead has high score
    const classification = createClassification({
      intent: 'not_interested',
      intent_confidence: 0.90,
    });
    const kbMatch = createKBMatch();

    const result = router.route({
      classification,
      kbMatch,
      leadContext: { email: 'test@example.com', lead_score: 80 },
    });

    expect(result.tier).toBe(3);
    expect(result.reason).toContain('High-value lead');
  });

  test('routes to Tier 1 for unsubscribe intent (auto-respond)', () => {
    // Unsubscribe is an auto-respond intent, always Tier 1
    const classification = createClassification({
      intent: 'unsubscribe',
      intent_confidence: 0.95,
    });

    const result = router.route({ classification, kbMatch: undefined });

    expect(result.tier).toBe(1);
    expect(result.reason).toContain('Auto-respond intent');
  });

  test('routes to Tier 3 for complex classification', () => {
    const classification = createClassification({
      intent: 'question',
      intent_confidence: 0.85,
      complexity: 'complex',
    });
    const kbMatch = createKBMatch();

    const result = router.route({ classification, kbMatch });

    expect(result.tier).toBe(3);
    // Reason is "Complex reply requires human handling" - check case-insensitive
    expect(result.reason.toLowerCase()).toContain('complex');
  });

  test('routes to Tier 3 for referral intent', () => {
    const classification = createClassification({
      intent: 'referral',
      intent_confidence: 0.88,
    });

    const result = router.route({ classification, kbMatch: undefined });

    expect(result.tier).toBe(3);
  });

  test('routes to Tier 1 for bounce (auto-respond)', () => {
    // Bounce is an auto-respond intent, always Tier 1
    const classification = createClassification({
      intent: 'bounce',
      intent_confidence: 0.99,
    });

    const result = router.route({ classification, kbMatch: undefined });

    expect(result.tier).toBe(1);
    expect(result.reason).toContain('Auto-respond intent');
  });
});

// ===========================================
// Edge Cases
// ===========================================

describe('Router edge cases', () => {
  let router: TierRouter;

  beforeEach(() => {
    router = createRouter();
  });

  test('handles out_of_office intent (auto-respond)', () => {
    const classification = createClassification({
      intent: 'out_of_office',
      intent_confidence: 0.95,
    });

    const result = router.route({ classification, kbMatch: undefined });

    // OOO is an auto-respond intent, always Tier 1
    expect(result.tier).toBe(1);
    expect(result.reason).toContain('Auto-respond intent');
  });

  test('handles very low KB match confidence', () => {
    const classification = createClassification({
      intent: 'positive_interest',
      intent_confidence: 0.90,
    });
    const kbMatch = createKBMatch({ confidence: 0.30 });

    const result = router.route({ classification, kbMatch });

    // Low KB confidence should prevent Tier 1
    expect(result.tier).not.toBe(1);
  });

  test('returns routing reason in all cases', () => {
    const classification = createClassification();

    const result = router.route({ classification, kbMatch: undefined });

    expect(result.reason).toBeTruthy();
    expect(typeof result.reason).toBe('string');
  });

  test('override_applied is false for standard Tier 2 routing', () => {
    // Provide KB match to get Tier 2 (which doesn't set override)
    const classification = createClassification({
      intent: 'question',
      intent_confidence: 0.80,
    });
    const kbMatch = createKBMatch({ confidence: 0.75 });

    const result = router.route({ classification, kbMatch });

    expect(result.tier).toBe(2);
    expect(result.override_applied).toBe(false);
  });

  test('handles handler type KB match', () => {
    const classification = createClassification({
      intent: 'objection',
      intent_confidence: 0.88,
    });
    const kbMatch = createKBMatch({
      type: 'handler',
      confidence: 0.90,
    });

    const result = router.route({ classification, kbMatch });

    expect(result.tier).toBeLessThanOrEqual(2);
  });
});
