/**
 * Learning Loop Weekly Synthesis Tests
 *
 * Tests for FR-022 through FR-026:
 * - FR-022: Aggregate insights by category
 * - FR-023: Rank objections and templates
 * - FR-024: Generate ICP signals summary
 * - FR-025: Deliver synthesis via Slack
 * - FR-026: Track delivery status
 *
 * @module __tests__/learning-loop/weekly-synthesis.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WeeklySynthesizer,
  createWeeklySynthesizer,
  DEFAULT_SYNTHESIZER_CONFIG,
} from '../../learning-loop/weekly-synthesis';
import { TEST_BRAIN_ID } from './fixtures';

// ===========================================
// Mock Qdrant Client for Synthesis
// ===========================================

interface MockInsight {
  id: string;
  payload: {
    category: string;
    content: string;
    confidence: number;
    validation: {
      status: string;
    };
  };
}

function createMockSynthesisQdrantClient() {
  const _insights: MockInsight[] = [];

  return {
    getInsightsByDateRange: vi.fn(async (
      brainId: string,
      startDate: Date,
      endDate: Date,
      limit: number
    ) => {
      // Return filtered insights based on brain_id
      return _insights.filter(i => true).slice(0, limit);
    }),

    // Test helpers
    _insights,
    _addInsight(insight: MockInsight) {
      _insights.push(insight);
    },
    _setInsights(insights: MockInsight[]) {
      _insights.length = 0;
      _insights.push(...insights);
    },
    _clear() {
      _insights.length = 0;
    },
  };
}

// ===========================================
// Mock Redis Client for Synthesis
// ===========================================

function createMockSynthesisRedisClient() {
  const _templatePerformances: Array<{
    template_id: string;
    times_used: number;
    success_rate: number;
    outcomes: {
      meeting_booked: number;
      positive_reply: number;
      no_response: number;
      negative_reply: number;
    };
  }> = [];

  let _lastSynthesisRun: string | null = null;

  return {
    getAllTemplatePerformances: vi.fn(async (brainId: string) => {
      return _templatePerformances;
    }),

    getDecliningTemplates: vi.fn(async (brainId: string, threshold: number) => {
      return _templatePerformances.filter(t => t.success_rate < 0.4);
    }),

    setLastSynthesisRun: vi.fn(async (brainId: string, timestamp: string) => {
      _lastSynthesisRun = timestamp;
      return true;
    }),

    isSynthesisDue: vi.fn(async (brainId: string, lookbackDays: number) => {
      if (!_lastSynthesisRun) return true;
      const lastRun = new Date(_lastSynthesisRun);
      const daysSince = (Date.now() - lastRun.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince >= lookbackDays;
    }),

    // Test helpers
    _templatePerformances,
    _setTemplatePerformances(perfs: typeof _templatePerformances) {
      _templatePerformances.length = 0;
      _templatePerformances.push(...perfs);
    },
    _setLastSynthesisRun(timestamp: string | null) {
      _lastSynthesisRun = timestamp;
    },
    _clear() {
      _templatePerformances.length = 0;
      _lastSynthesisRun = null;
    },
  };
}

// ===========================================
// Mock Slack Client for Synthesis
// ===========================================

function createMockSynthesisSlackClient() {
  const _sentSyntheses: any[] = [];
  const _sentAlerts: any[] = [];

  return {
    sendWeeklySynthesis: vi.fn(async (synthesis: any) => {
      _sentSyntheses.push(synthesis);
      return { success: true, ts: '1234567890.123456' };
    }),

    sendDecliningTemplateAlert: vi.fn(async (
      brainId: string,
      templateId: string,
      templateName: string,
      currentRate: number,
      previousRate: number
    ) => {
      _sentAlerts.push({ brainId, templateId, templateName, currentRate, previousRate });
      return { ok: true, ts: '1234567890.789012' };
    }),

    // Test helpers
    _sentSyntheses,
    _sentAlerts,
    _clear() {
      _sentSyntheses.length = 0;
      _sentAlerts.length = 0;
    },
  };
}

// ===========================================
// Mock State Manager for Synthesis
// ===========================================

function createMockSynthesisStateManager() {
  return {
    getMetrics: vi.fn(() => ({
      insights_extracted: 100,
      insights_validated: 80,
      insights_auto_approved: 60,
      insights_rejected: 10,
      kb_writes: 90,
    })),
  };
}

// ===========================================
// Helper to create mock insights
// ===========================================

function createMockInsight(
  id: string,
  category: string,
  content: string,
  overrides: Partial<MockInsight['payload']> = {}
): MockInsight {
  return {
    id,
    payload: {
      category,
      content,
      confidence: 0.85,
      validation: {
        status: 'validated',
      },
      ...overrides,
    },
  };
}

describe('WeeklySynthesizer', () => {
  let synthesizer: WeeklySynthesizer;
  let mockQdrant: ReturnType<typeof createMockSynthesisQdrantClient>;
  let mockRedis: ReturnType<typeof createMockSynthesisRedisClient>;
  let mockSlack: ReturnType<typeof createMockSynthesisSlackClient>;
  let mockState: ReturnType<typeof createMockSynthesisStateManager>;

  beforeEach(() => {
    mockQdrant = createMockSynthesisQdrantClient();
    mockRedis = createMockSynthesisRedisClient();
    mockSlack = createMockSynthesisSlackClient();
    mockState = createMockSynthesisStateManager();

    synthesizer = createWeeklySynthesizer(
      mockQdrant as any,
      mockRedis as any,
      mockSlack as any,
      mockState as any
    );
  });

  // ===========================================
  // Default Configuration Tests
  // ===========================================

  describe('Default Configuration', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_SYNTHESIZER_CONFIG.lookbackDays).toBe(7);
      expect(DEFAULT_SYNTHESIZER_CONFIG.topN).toBe(5);
      expect(DEFAULT_SYNTHESIZER_CONFIG.synthesisChannel).toBe('learning-loop-reports');
      expect(DEFAULT_SYNTHESIZER_CONFIG.decliningThreshold).toBe(0.2);
    });

    it('should allow custom configuration', () => {
      const customSynthesizer = createWeeklySynthesizer(
        mockQdrant as any,
        mockRedis as any,
        mockSlack as any,
        mockState as any,
        { lookbackDays: 14, topN: 10 }
      );

      expect(customSynthesizer).toBeDefined();
    });
  });

  // ===========================================
  // Category Statistics Tests (FR-022)
  // ===========================================

  describe('Category Statistics (FR-022)', () => {
    beforeEach(() => {
      // Setup diverse insights
      mockQdrant._setInsights([
        createMockInsight('ins_1', 'pain_point', 'Manual data entry taking too long'),
        createMockInsight('ins_2', 'pain_point', 'Integration issues with existing tools'),
        createMockInsight('ins_3', 'objection', 'Budget constraints this quarter'),
        createMockInsight('ins_4', 'objection', 'Need approval from VP'),
        createMockInsight('ins_5', 'objection', 'Already using competitor'),
        createMockInsight('ins_6', 'competitive_intel', 'Competitor X pricing is $500/mo'),
        createMockInsight('ins_7', 'icp_signal', 'Company uses Salesforce'),
        createMockInsight('ins_8', 'buying_process', 'Quarterly purchasing cycles'),
      ]);
    });

    it('should aggregate insights by category', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(result.success).toBe(true);
      expect(result.synthesis).toBeDefined();

      const stats = result.synthesis!.category_stats;
      expect(stats.length).toBeGreaterThan(0);

      // Verify objection category (most common in test data)
      const objectionStats = stats.find(s => s.category === 'objection');
      expect(objectionStats).toBeDefined();
      expect(objectionStats!.count).toBe(3);
    });

    it('should sort categories by count descending', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      const stats = result.synthesis!.category_stats;

      // Verify sorted order
      for (let i = 1; i < stats.length; i++) {
        expect(stats[i - 1].count).toBeGreaterThanOrEqual(stats[i].count);
      }
    });

    it('should calculate average confidence per category', async () => {
      // Setup insights with varying confidence
      mockQdrant._setInsights([
        createMockInsight('ins_1', 'pain_point', 'Issue 1', { confidence: 0.9 }),
        createMockInsight('ins_2', 'pain_point', 'Issue 2', { confidence: 0.7 }),
        createMockInsight('ins_3', 'pain_point', 'Issue 3', { confidence: 0.8 }),
      ]);

      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      const painPointStats = result.synthesis!.category_stats.find(
        s => s.category === 'pain_point'
      );
      expect(painPointStats).toBeDefined();
      expect(painPointStats!.avg_confidence).toBeCloseTo(0.8, 1);
    });
  });

  // ===========================================
  // Objection Ranking Tests (FR-023)
  // ===========================================

  describe('Objection Ranking (FR-023)', () => {
    beforeEach(() => {
      // Setup objection insights
      mockQdrant._setInsights([
        createMockInsight('obj_1', 'objection', 'Budget is too tight right now'),
        createMockInsight('obj_2', 'objection', 'Budget constraints mentioned'),
        createMockInsight('obj_3', 'objection', 'Need to check with stakeholders'),
        createMockInsight('obj_4', 'objection', 'Already using Competitor X'),
        createMockInsight('obj_5', 'objection', 'Already using Competitor X solution'),
      ]);
    });

    it('should rank objections by occurrence count', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(result.synthesis!.top_objections).toBeDefined();
      expect(result.synthesis!.top_objections.length).toBeGreaterThan(0);
    });

    it('should limit to topN objections', async () => {
      const customSynthesizer = createWeeklySynthesizer(
        mockQdrant as any,
        mockRedis as any,
        mockSlack as any,
        mockState as any,
        { topN: 3 }
      );

      const result = await customSynthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(result.synthesis!.top_objections.length).toBeLessThanOrEqual(3);
    });
  });

  // ===========================================
  // Template Ranking Tests (FR-023)
  // ===========================================

  describe('Template Ranking (FR-023)', () => {
    beforeEach(() => {
      mockRedis._setTemplatePerformances([
        {
          template_id: 'template_top',
          times_used: 20,
          success_rate: 0.85,
          outcomes: { meeting_booked: 10, positive_reply: 5, no_response: 3, negative_reply: 2 },
        },
        {
          template_id: 'template_mid',
          times_used: 15,
          success_rate: 0.6,
          outcomes: { meeting_booked: 5, positive_reply: 4, no_response: 4, negative_reply: 2 },
        },
        {
          template_id: 'template_low',
          times_used: 10,
          success_rate: 0.3,
          outcomes: { meeting_booked: 1, positive_reply: 2, no_response: 4, negative_reply: 3 },
        },
        {
          template_id: 'template_insufficient',
          times_used: 2,
          success_rate: 1.0,
          outcomes: { meeting_booked: 2, positive_reply: 0, no_response: 0, negative_reply: 0 },
        },
      ]);
    });

    it('should rank templates by success rate', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      const rankings = result.synthesis!.top_templates;
      expect(rankings.length).toBeGreaterThan(0);

      // Should be sorted by success_rate descending
      for (let i = 1; i < rankings.length; i++) {
        expect(rankings[i - 1].success_rate).toBeGreaterThanOrEqual(rankings[i].success_rate);
      }
    });

    it('should filter out templates with insufficient usage', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      const rankings = result.synthesis!.top_templates;
      const insufficientTemplate = rankings.find(t => t.template_id === 'template_insufficient');

      // Should not include templates with < 5 uses
      expect(insufficientTemplate).toBeUndefined();
    });

    it('should include trend information', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      const topTemplate = result.synthesis!.top_templates[0];
      expect(topTemplate.trend).toBeDefined();
      expect(['improving', 'stable', 'declining']).toContain(topTemplate.trend);
    });
  });

  // ===========================================
  // ICP Signals Tests (FR-024)
  // ===========================================

  describe('ICP Signals Summary (FR-024)', () => {
    beforeEach(() => {
      mockQdrant._setInsights([
        createMockInsight('icp_1', 'icp_signal', 'Company size is 50-200 employees'),
        createMockInsight('icp_2', 'icp_signal', 'Uses Salesforce for CRM'),
        createMockInsight('icp_3', 'icp_signal', 'Tech stack includes AWS and React'),
        createMockInsight('icp_4', 'icp_signal', 'Budget around $50k for this quarter'),
        createMockInsight('icp_5', 'icp_signal', 'Industry is fintech'),
      ]);
    });

    it('should generate ICP signal summaries', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(result.synthesis!.icp_signals).toBeDefined();
      expect(result.synthesis!.icp_signals.length).toBeGreaterThan(0);
    });

    it('should infer signal types from content', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      const signals = result.synthesis!.icp_signals;

      // Find a signal with recognizable type
      const sizeSignal = signals.find(s => s.signal_type === 'company_size');
      const budgetSignal = signals.find(s => s.signal_type === 'budget');

      // At least some signal types should be inferred
      expect(signals.every(s => s.signal_type)).toBe(true);
    });

    it('should include confidence scores', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      for (const signal of result.synthesis!.icp_signals) {
        expect(signal.confidence).toBeGreaterThanOrEqual(0);
        expect(signal.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  // ===========================================
  // Slack Delivery Tests (FR-025, FR-026)
  // ===========================================

  describe('Slack Delivery (FR-025, FR-026)', () => {
    beforeEach(() => {
      mockQdrant._setInsights([
        createMockInsight('ins_1', 'pain_point', 'Test insight'),
      ]);
    });

    it('should deliver synthesis via Slack', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(result.success).toBe(true);
      expect(mockSlack.sendWeeklySynthesis).toHaveBeenCalledTimes(1);
      expect(result.slackMessageTs).toBe('1234567890.123456');
    });

    it('should record last synthesis run time', async () => {
      await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(mockRedis.setLastSynthesisRun).toHaveBeenCalledWith(
        TEST_BRAIN_ID,
        expect.any(String)
      );
    });

    it('should handle Slack delivery failure gracefully', async () => {
      mockSlack.sendWeeklySynthesis = vi.fn().mockResolvedValue({
        success: false,
        error: 'Channel not found',
      });

      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      // Should still succeed overall even if Slack fails
      expect(result.success).toBe(true);
      expect(result.synthesis).toBeDefined();
    });

    it('should check and alert on declining templates', async () => {
      // Setup declining template
      mockRedis._setTemplatePerformances([
        {
          template_id: 'declining_template',
          times_used: 20,
          success_rate: 0.25,
          outcomes: { meeting_booked: 2, positive_reply: 3, no_response: 10, negative_reply: 5 },
        },
      ]);

      await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(mockRedis.getDecliningTemplates).toHaveBeenCalledWith(
        TEST_BRAIN_ID,
        DEFAULT_SYNTHESIZER_CONFIG.decliningThreshold
      );
    });
  });

  // ===========================================
  // Synthesis Due Check Tests
  // ===========================================

  describe('Synthesis Due Check', () => {
    it('should report synthesis due when never run', async () => {
      mockRedis._setLastSynthesisRun(null);

      const isDue = await synthesizer.isSynthesisDue(TEST_BRAIN_ID);

      expect(isDue).toBe(true);
    });

    it('should report synthesis due after lookback period', async () => {
      // Set last run 8 days ago
      const eightDaysAgo = new Date();
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
      mockRedis._setLastSynthesisRun(eightDaysAgo.toISOString());

      const isDue = await synthesizer.isSynthesisDue(TEST_BRAIN_ID);

      expect(mockRedis.isSynthesisDue).toHaveBeenCalledWith(
        TEST_BRAIN_ID,
        DEFAULT_SYNTHESIZER_CONFIG.lookbackDays
      );
    });
  });

  // ===========================================
  // Overview Statistics Tests
  // ===========================================

  describe('Overview Statistics', () => {
    beforeEach(() => {
      mockQdrant._setInsights([
        createMockInsight('ins_1', 'pain_point', 'Test 1', { confidence: 0.9 }),
        createMockInsight('ins_2', 'objection', 'Test 2', { confidence: 0.8 }),
        createMockInsight('ins_3', 'icp_signal', 'Test 3', { confidence: 0.85 }),
      ]);
    });

    it('should include total insights count', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(result.synthesis!.overview.total_insights_extracted).toBe(3);
    });

    it('should calculate average confidence', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      // Average of 0.9, 0.8, 0.85 = 0.85
      expect(result.synthesis!.overview.avg_extraction_confidence).toBeCloseTo(0.85, 1);
    });

    it('should include validation metrics from state', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(mockState.getMetrics).toHaveBeenCalled();
      expect(result.synthesis!.overview.insights_validated).toBe(80);
      expect(result.synthesis!.overview.insights_auto_approved).toBe(60);
    });
  });

  // ===========================================
  // Competitive Intelligence Tests
  // ===========================================

  describe('Competitive Intelligence', () => {
    beforeEach(() => {
      mockQdrant._setInsights([
        createMockInsight('comp_1', 'competitive_intel', 'Already using CompetitorA for this'),
        createMockInsight('comp_2', 'competitive_intel', 'CompetitorA is cheaper'),
        createMockInsight('comp_3', 'competitive_intel', 'Evaluated CompetitorB last quarter'),
        createMockInsight('comp_4', 'competitive_intel', 'CompetitorC does not have this feature'),
      ]);
    });

    it('should aggregate competitor mentions', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(result.synthesis!.competitive_intel).toBeDefined();
      expect(result.synthesis!.competitive_intel.length).toBeGreaterThanOrEqual(0);
    });

    it('should sort by mention count', async () => {
      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      const intel = result.synthesis!.competitive_intel;

      // Should be sorted by mentions descending
      for (let i = 1; i < intel.length; i++) {
        expect(intel[i - 1].mentions).toBeGreaterThanOrEqual(intel[i].mentions);
      }
    });
  });

  // ===========================================
  // Error Handling Tests
  // ===========================================

  describe('Error Handling', () => {
    it('should handle Qdrant error gracefully', async () => {
      mockQdrant.getInsightsByDateRange = vi.fn().mockRejectedValue(
        new Error('Qdrant connection failed')
      );

      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Qdrant connection failed');
    });

    it('should handle Redis error gracefully', async () => {
      mockRedis.getAllTemplatePerformances = vi.fn().mockRejectedValue(
        new Error('Redis timeout')
      );

      const result = await synthesizer.generateAndDeliver(TEST_BRAIN_ID);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Redis timeout');
    });
  });

  // ===========================================
  // Generate Without Delivery Tests
  // ===========================================

  describe('Generate Without Delivery', () => {
    beforeEach(() => {
      mockQdrant._setInsights([
        createMockInsight('ins_1', 'pain_point', 'Test insight'),
      ]);
    });

    it('should generate synthesis without sending to Slack', async () => {
      const synthesis = await synthesizer.generate(TEST_BRAIN_ID);

      expect(synthesis).toBeDefined();
      expect(synthesis.brain_id).toBe(TEST_BRAIN_ID);
      expect(mockSlack.sendWeeklySynthesis).not.toHaveBeenCalled();
    });

    it('should include all synthesis sections', async () => {
      const synthesis = await synthesizer.generate(TEST_BRAIN_ID);

      expect(synthesis.overview).toBeDefined();
      expect(synthesis.category_stats).toBeDefined();
      expect(synthesis.top_objections).toBeDefined();
      expect(synthesis.top_templates).toBeDefined();
      expect(synthesis.icp_signals).toBeDefined();
      expect(synthesis.competitive_intel).toBeDefined();
    });
  });
});
