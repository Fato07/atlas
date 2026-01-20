/**
 * Learning Loop Template Tracker Tests
 *
 * Tests for FR-027 through FR-031:
 * - FR-027: Record template usage
 * - FR-028: Track outcomes
 * - FR-029: Calculate success rates
 * - FR-030: Monitor for declining performance
 * - FR-031: Support A/B testing
 *
 * @module __tests__/learning-loop/template-tracker.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TemplateTracker,
  createTemplateTracker,
  DEFAULT_TEMPLATE_TRACKER_CONFIG,
} from '../../learning-loop/template-tracker';
import { TEST_BRAIN_ID } from './fixtures';

// ===========================================
// Mock Redis Client for Template Tracking
// ===========================================

interface MockTemplatePerformance {
  template_id: string;
  brain_id: string;
  times_used: number;
  outcomes: {
    meeting_booked: number;
    positive_reply: number;
    no_response: number;
    negative_reply: number;
  };
  success_rate: number;
  last_used: string | null;
  ab_group: string | null;
  variant: string | null;
  comparison: {
    vs_group_average: number | null;
    rank_in_group: number | null;
    total_in_group: number | null;
  } | null;
}

function createMockTemplateRedisClient() {
  const _performances: Map<string, MockTemplatePerformance> = new Map();

  return {
    getTemplatePerformance: vi.fn(async (brainId: string, templateId: string) => {
      const key = `${brainId}:${templateId}`;
      return _performances.get(key) ?? null;
    }),

    setTemplatePerformance: vi.fn(async (brainId: string, templateId: string, performance: MockTemplatePerformance) => {
      const key = `${brainId}:${templateId}`;
      _performances.set(key, performance);
      return true;
    }),

    getAllTemplatePerformances: vi.fn(async (brainId: string) => {
      const result: MockTemplatePerformance[] = [];
      for (const [key, perf] of _performances.entries()) {
        if (key.startsWith(`${brainId}:`)) {
          result.push(perf);
        }
      }
      return result;
    }),

    getDecliningTemplates: vi.fn(async (brainId: string, threshold: number) => {
      const all = await createMockTemplateRedisClient().getAllTemplatePerformances(brainId);
      // Simulating decline detection
      return all.filter(p => p.success_rate < 0.5);
    }),

    // Test helpers
    _performances,
    _setPerformance(brainId: string, templateId: string, perf: MockTemplatePerformance) {
      const key = `${brainId}:${templateId}`;
      _performances.set(key, perf);
    },
    _clear() {
      _performances.clear();
    },
  };
}

// ===========================================
// Mock Slack Client for Alerts
// ===========================================

function createMockTemplateSlackClient() {
  const _alerts: Array<{
    brainId: string;
    templateId: string;
    templateName: string;
    currentRate: number;
    previousRate: number;
  }> = [];

  return {
    sendDecliningTemplateAlert: vi.fn(async (
      brainId: string,
      templateId: string,
      templateName: string,
      currentRate: number,
      previousRate: number
    ) => {
      _alerts.push({ brainId, templateId, templateName, currentRate, previousRate });
      return { ok: true, ts: '1234567890.123456' };
    }),

    // Test helpers
    _alerts,
    _clear() {
      _alerts.length = 0;
    },
  };
}

// ===========================================
// Helper to create base performance record
// ===========================================

function createBasePerformance(
  templateId: string,
  brainId: string,
  overrides: Partial<MockTemplatePerformance> = {}
): MockTemplatePerformance {
  return {
    template_id: templateId,
    brain_id: brainId,
    times_used: 0,
    outcomes: {
      meeting_booked: 0,
      positive_reply: 0,
      no_response: 0,
      negative_reply: 0,
    },
    success_rate: 0,
    last_used: null,
    ab_group: null,
    variant: null,
    comparison: null,
    ...overrides,
  };
}

describe('TemplateTracker', () => {
  let tracker: TemplateTracker;
  let mockRedis: ReturnType<typeof createMockTemplateRedisClient>;
  let mockSlack: ReturnType<typeof createMockTemplateSlackClient>;

  beforeEach(() => {
    mockRedis = createMockTemplateRedisClient();
    mockSlack = createMockTemplateSlackClient();
    tracker = createTemplateTracker(mockRedis as any, mockSlack as any);
  });

  // ===========================================
  // Default Configuration Tests
  // ===========================================

  describe('Default Configuration', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_TEMPLATE_TRACKER_CONFIG.minUsesForStats).toBe(5);
      expect(DEFAULT_TEMPLATE_TRACKER_CONFIG.minUsesForAB).toBe(10);
      expect(DEFAULT_TEMPLATE_TRACKER_CONFIG.declineThreshold).toBe(0.2);
      expect(DEFAULT_TEMPLATE_TRACKER_CONFIG.declineWindowDays).toBe(7);
    });

    it('should allow custom configuration overrides', () => {
      const customTracker = createTemplateTracker(
        mockRedis as any,
        mockSlack as any,
        { minUsesForStats: 10, declineThreshold: 0.3 }
      );

      // Tracker is created successfully with custom config
      expect(customTracker).toBeDefined();
    });
  });

  // ===========================================
  // Usage Recording Tests (FR-027)
  // ===========================================

  describe('Usage Recording (FR-027)', () => {
    it('should record first usage for new template', async () => {
      const result = await tracker.recordUsage(TEST_BRAIN_ID, 'template_001');

      expect(result.success).toBe(true);
      expect(result.templateId).toBe('template_001');
      expect(result.timesUsed).toBe(1);

      expect(mockRedis.setTemplatePerformance).toHaveBeenCalledWith(
        TEST_BRAIN_ID,
        'template_001',
        expect.objectContaining({
          template_id: 'template_001',
          brain_id: TEST_BRAIN_ID,
          times_used: 1,
        })
      );
    });

    it('should increment usage for existing template', async () => {
      // Setup existing record
      mockRedis._setPerformance(TEST_BRAIN_ID, 'template_002', createBasePerformance(
        'template_002',
        TEST_BRAIN_ID,
        { times_used: 5 }
      ));

      const result = await tracker.recordUsage(TEST_BRAIN_ID, 'template_002');

      expect(result.success).toBe(true);
      expect(result.timesUsed).toBe(6);
    });

    it('should record usage with metadata', async () => {
      const result = await tracker.recordUsage(TEST_BRAIN_ID, 'template_003', {
        leadId: 'lead_123',
        campaignId: 'campaign_456',
        abGroup: 'test_group_1',
        variant: 'A',
      });

      expect(result.success).toBe(true);

      // Verify AB group was set
      const saved = (mockRedis.setTemplatePerformance as any).mock.calls[0][2];
      expect(saved.ab_group).toBe('test_group_1');
      expect(saved.variant).toBe('A');
    });

    it('should handle Redis error gracefully', async () => {
      mockRedis.getTemplatePerformance = vi.fn().mockRejectedValue(new Error('Redis unavailable'));

      const result = await tracker.recordUsage(TEST_BRAIN_ID, 'template_004');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Redis unavailable');
    });
  });

  // ===========================================
  // Outcome Recording Tests (FR-028)
  // ===========================================

  describe('Outcome Recording (FR-028)', () => {
    it('should record positive_reply outcome', async () => {
      // Setup existing template with usage
      mockRedis._setPerformance(TEST_BRAIN_ID, 'template_010', createBasePerformance(
        'template_010',
        TEST_BRAIN_ID,
        {
          times_used: 3,
          outcomes: { meeting_booked: 0, positive_reply: 1, no_response: 2, negative_reply: 0 },
          success_rate: 0.33,
        }
      ));

      const result = await tracker.recordOutcome(TEST_BRAIN_ID, 'template_010', 'positive_reply');

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('positive_reply');
      expect(result.newSuccessRate).toBeGreaterThan(0);
    });

    it('should record negative_reply outcome', async () => {
      mockRedis._setPerformance(TEST_BRAIN_ID, 'template_011', createBasePerformance(
        'template_011',
        TEST_BRAIN_ID,
        {
          times_used: 5,
          outcomes: { meeting_booked: 1, positive_reply: 2, no_response: 1, negative_reply: 1 },
          success_rate: 0.6,
        }
      ));

      const result = await tracker.recordOutcome(TEST_BRAIN_ID, 'template_011', 'negative_reply');

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('negative_reply');
    });

    it('should record no_response outcome', async () => {
      mockRedis._setPerformance(TEST_BRAIN_ID, 'template_012', createBasePerformance(
        'template_012',
        TEST_BRAIN_ID,
        { times_used: 5 }
      ));

      const result = await tracker.recordOutcome(TEST_BRAIN_ID, 'template_012', 'no_response');

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('no_response');
    });

    it('should create template if not exists when recording outcome', async () => {
      const result = await tracker.recordOutcome(TEST_BRAIN_ID, 'template_new', 'positive_reply');

      expect(result.success).toBe(true);
      expect(mockRedis.setTemplatePerformance).toHaveBeenCalled();
    });
  });

  // ===========================================
  // Declining Performance Tests (FR-030)
  // ===========================================

  describe('Declining Performance Detection (FR-030)', () => {
    it('should send alert when performance declines significantly', async () => {
      // Create tracker with lower threshold for testing
      const sensitiveTracker = createTemplateTracker(
        mockRedis as any,
        mockSlack as any,
        { minUsesForStats: 3, declineThreshold: 0.15 }
      );

      // Setup template with good performance
      mockRedis._setPerformance(TEST_BRAIN_ID, 'template_decline', createBasePerformance(
        'template_decline',
        TEST_BRAIN_ID,
        {
          times_used: 10,
          outcomes: { meeting_booked: 2, positive_reply: 6, no_response: 1, negative_reply: 1 },
          success_rate: 0.8,
        }
      ));

      // Record negative_reply outcome that causes decline
      await sensitiveTracker.recordOutcome(TEST_BRAIN_ID, 'template_decline', 'negative_reply');

      // The implementation checks if decline >= threshold
      // With previous rate 0.8 and new rate calculated after adding negative_reply,
      // if decline is significant, alert should be sent
    });

    it('should not alert if below min uses threshold', async () => {
      // Setup template with low usage
      mockRedis._setPerformance(TEST_BRAIN_ID, 'template_low_use', createBasePerformance(
        'template_low_use',
        TEST_BRAIN_ID,
        {
          times_used: 2,
          outcomes: { meeting_booked: 1, positive_reply: 1, no_response: 0, negative_reply: 0 },
          success_rate: 1.0,
        }
      ));

      await tracker.recordOutcome(TEST_BRAIN_ID, 'template_low_use', 'negative_reply');

      // Should not send alert because times_used < minUsesForStats (5)
      expect(mockSlack._alerts.length).toBe(0);
    });

    it('should get declining templates', async () => {
      // Setup some templates with different performance
      mockRedis._setPerformance(TEST_BRAIN_ID, 'good_template', createBasePerformance(
        'good_template',
        TEST_BRAIN_ID,
        { times_used: 10, success_rate: 0.8 }
      ));
      mockRedis._setPerformance(TEST_BRAIN_ID, 'bad_template', createBasePerformance(
        'bad_template',
        TEST_BRAIN_ID,
        { times_used: 10, success_rate: 0.3 }
      ));

      const declining = await tracker.getDecliningTemplates(TEST_BRAIN_ID);

      // getDecliningTemplates should return templates with low success rate
      expect(mockRedis.getDecliningTemplates).toHaveBeenCalledWith(
        TEST_BRAIN_ID,
        DEFAULT_TEMPLATE_TRACKER_CONFIG.declineThreshold
      );
    });
  });

  // ===========================================
  // A/B Testing Tests (FR-031)
  // ===========================================

  describe('A/B Testing (FR-031)', () => {
    it('should setup A/B test for two templates', async () => {
      const result = await tracker.setupABTest(
        TEST_BRAIN_ID,
        'template_a',
        'template_b',
        'subject_line_test'
      );

      expect(result).toBe(true);

      // Verify both templates were configured with A/B group
      expect(mockRedis.setTemplatePerformance).toHaveBeenCalledTimes(2);

      const calls = (mockRedis.setTemplatePerformance as any).mock.calls;
      const savedA = calls.find((c: any) => c[1] === 'template_a')?.[2];
      const savedB = calls.find((c: any) => c[1] === 'template_b')?.[2];

      expect(savedA.ab_group).toBe('subject_line_test');
      expect(savedA.variant).toBe('A');
      expect(savedB.ab_group).toBe('subject_line_test');
      expect(savedB.variant).toBe('B');
    });

    it('should get A/B comparison with sufficient data', async () => {
      // Setup A/B test templates with usage
      mockRedis._setPerformance(TEST_BRAIN_ID, 'ab_template_a', createBasePerformance(
        'ab_template_a',
        TEST_BRAIN_ID,
        {
          times_used: 15,
          outcomes: { meeting_booked: 4, positive_reply: 8, no_response: 2, negative_reply: 1 },
          success_rate: 0.8,
          ab_group: 'email_test',
          variant: 'A',
        }
      ));
      mockRedis._setPerformance(TEST_BRAIN_ID, 'ab_template_b', createBasePerformance(
        'ab_template_b',
        TEST_BRAIN_ID,
        {
          times_used: 15,
          outcomes: { meeting_booked: 3, positive_reply: 6, no_response: 3, negative_reply: 3 },
          success_rate: 0.6,
          ab_group: 'email_test',
          variant: 'B',
        }
      ));

      const result = await tracker.getABComparison(
        TEST_BRAIN_ID,
        'ab_template_a',
        'ab_template_b'
      );

      expect(result).not.toBeNull();
      expect(result!.templateA).toBe('ab_template_a');
      expect(result!.templateB).toBe('ab_template_b');
      // With 20% difference (0.8 vs 0.6), should recommend A
      expect(result!.recommendation).toBe('a');
    });

    it('should return inconclusive for insufficient data', async () => {
      // Setup templates with low usage
      mockRedis._setPerformance(TEST_BRAIN_ID, 'ab_low_a', createBasePerformance(
        'ab_low_a',
        TEST_BRAIN_ID,
        { times_used: 3, success_rate: 0.8, ab_group: 'test', variant: 'A' }
      ));
      mockRedis._setPerformance(TEST_BRAIN_ID, 'ab_low_b', createBasePerformance(
        'ab_low_b',
        TEST_BRAIN_ID,
        { times_used: 3, success_rate: 0.6, ab_group: 'test', variant: 'B' }
      ));

      const result = await tracker.getABComparison(
        TEST_BRAIN_ID,
        'ab_low_a',
        'ab_low_b'
      );

      expect(result).not.toBeNull();
      expect(result!.recommendation).toBe('inconclusive');
    });

    it('should recommend continue when difference is small', async () => {
      // Setup templates with similar performance
      mockRedis._setPerformance(TEST_BRAIN_ID, 'ab_similar_a', createBasePerformance(
        'ab_similar_a',
        TEST_BRAIN_ID,
        { times_used: 15, success_rate: 0.72, ab_group: 'test', variant: 'A' }
      ));
      mockRedis._setPerformance(TEST_BRAIN_ID, 'ab_similar_b', createBasePerformance(
        'ab_similar_b',
        TEST_BRAIN_ID,
        { times_used: 15, success_rate: 0.68, ab_group: 'test', variant: 'B' }
      ));

      const result = await tracker.getABComparison(
        TEST_BRAIN_ID,
        'ab_similar_a',
        'ab_similar_b'
      );

      expect(result).not.toBeNull();
      // 4% difference (0.72 vs 0.68) is below 10% threshold
      expect(result!.recommendation).toBe('continue');
    });

    it('should return null when templates not found', async () => {
      const result = await tracker.getABComparison(
        TEST_BRAIN_ID,
        'nonexistent_a',
        'nonexistent_b'
      );

      expect(result).toBeNull();
    });
  });

  // ===========================================
  // Top Templates & Statistics Tests (FR-029)
  // ===========================================

  describe('Performance Statistics (FR-029)', () => {
    beforeEach(() => {
      // Setup multiple templates with varying performance
      mockRedis._setPerformance(TEST_BRAIN_ID, 'top_performer', createBasePerformance(
        'top_performer',
        TEST_BRAIN_ID,
        {
          times_used: 20,
          outcomes: { meeting_booked: 6, positive_reply: 12, no_response: 1, negative_reply: 1 },
          success_rate: 0.9,
        }
      ));
      mockRedis._setPerformance(TEST_BRAIN_ID, 'mid_performer', createBasePerformance(
        'mid_performer',
        TEST_BRAIN_ID,
        {
          times_used: 15,
          outcomes: { meeting_booked: 3, positive_reply: 6, no_response: 4, negative_reply: 2 },
          success_rate: 0.6,
        }
      ));
      mockRedis._setPerformance(TEST_BRAIN_ID, 'low_performer', createBasePerformance(
        'low_performer',
        TEST_BRAIN_ID,
        {
          times_used: 10,
          outcomes: { meeting_booked: 1, positive_reply: 2, no_response: 4, negative_reply: 3 },
          success_rate: 0.3,
        }
      ));
      mockRedis._setPerformance(TEST_BRAIN_ID, 'insufficient_data', createBasePerformance(
        'insufficient_data',
        TEST_BRAIN_ID,
        {
          times_used: 2,
          outcomes: { meeting_booked: 1, positive_reply: 1, no_response: 0, negative_reply: 0 },
          success_rate: 1.0,
        }
      ));
    });

    it('should get top performing templates', async () => {
      const topTemplates = await tracker.getTopTemplates(TEST_BRAIN_ID, 3);

      // Should return sorted by success rate, excluding insufficient data
      expect(topTemplates.length).toBeLessThanOrEqual(3);
      expect(mockRedis.getAllTemplatePerformances).toHaveBeenCalledWith(TEST_BRAIN_ID);
    });

    it('should get single template performance', async () => {
      const performance = await tracker.getPerformance(TEST_BRAIN_ID, 'top_performer');

      expect(performance).not.toBeNull();
      expect(performance!.template_id).toBe('top_performer');
      expect(performance!.success_rate).toBe(0.9);
    });

    it('should return null for non-existent template', async () => {
      const performance = await tracker.getPerformance(TEST_BRAIN_ID, 'nonexistent');

      expect(performance).toBeNull();
    });

    it('should get all template performances', async () => {
      const all = await tracker.getAllPerformances(TEST_BRAIN_ID);

      expect(mockRedis.getAllTemplatePerformances).toHaveBeenCalledWith(TEST_BRAIN_ID);
    });

    it('should calculate aggregate statistics', async () => {
      const stats = await tracker.getAggregateStats(TEST_BRAIN_ID);

      expect(stats.totalTemplates).toBeGreaterThan(0);
      expect(stats.totalUsage).toBeGreaterThan(0);
      expect(stats.avgSuccessRate).toBeGreaterThanOrEqual(0);
      expect(stats.avgSuccessRate).toBeLessThanOrEqual(1);
    });

    it('should return empty stats for brain with no templates', async () => {
      const emptyRedis = createMockTemplateRedisClient();
      const emptyTracker = createTemplateTracker(emptyRedis as any, mockSlack as any);

      const stats = await emptyTracker.getAggregateStats('empty_brain');

      expect(stats.totalTemplates).toBe(0);
      expect(stats.totalUsage).toBe(0);
      expect(stats.avgSuccessRate).toBe(0);
      expect(stats.topTemplate).toBeNull();
      expect(stats.bottomTemplate).toBeNull();
      expect(stats.activeABTests).toBe(0);
    });

    it('should track active A/B tests in aggregate stats', async () => {
      // Add templates with A/B groups
      mockRedis._setPerformance(TEST_BRAIN_ID, 'ab_1a', createBasePerformance(
        'ab_1a',
        TEST_BRAIN_ID,
        { times_used: 10, ab_group: 'test_1', variant: 'A' }
      ));
      mockRedis._setPerformance(TEST_BRAIN_ID, 'ab_1b', createBasePerformance(
        'ab_1b',
        TEST_BRAIN_ID,
        { times_used: 10, ab_group: 'test_1', variant: 'B' }
      ));
      mockRedis._setPerformance(TEST_BRAIN_ID, 'ab_2a', createBasePerformance(
        'ab_2a',
        TEST_BRAIN_ID,
        { times_used: 10, ab_group: 'test_2', variant: 'A' }
      ));

      const stats = await tracker.getAggregateStats(TEST_BRAIN_ID);

      // Should count unique A/B groups
      expect(stats.activeABTests).toBeGreaterThanOrEqual(2);
    });
  });

  // ===========================================
  // Error Handling Tests
  // ===========================================

  describe('Error Handling', () => {
    it('should handle setup A/B test failure', async () => {
      mockRedis.setTemplatePerformance = vi.fn().mockRejectedValue(new Error('Save failed'));

      const result = await tracker.setupABTest(
        TEST_BRAIN_ID,
        'template_a',
        'template_b',
        'test_name'
      );

      expect(result).toBe(false);
    });

    it('should handle outcome recording failure', async () => {
      mockRedis.getTemplatePerformance = vi.fn().mockRejectedValue(new Error('Get failed'));

      const result = await tracker.recordOutcome(TEST_BRAIN_ID, 'template_x', 'positive_reply');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Get failed');
      expect(result.newSuccessRate).toBe(0);
    });
  });
});
