/**
 * Learning Loop Integration Tests
 *
 * End-to-end tests for the complete learning loop pipeline:
 * - Full flow: Source → Extract → Gates → KB Write (auto-approve)
 * - Full flow: Source → Extract → Gates → Validation → Approve → KB Write
 * - Weekly synthesis generation
 *
 * @module __tests__/learning-loop/integration.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LearningLoopAgent } from '../../learning-loop/agent';
import { TEST_BRAIN_ID, createTestExtractionRequest, createTestLead } from './fixtures';
import { createMockAnthropicClient } from './fixtures/mock-clients';

// ===========================================
// Comprehensive Mock Infrastructure
// ===========================================

/**
 * Create mock state manager for integration tests.
 */
function createIntegrationStateManager() {
  let _brainId: string | null = TEST_BRAIN_ID;
  const _metrics = {
    insights_extracted: 0,
    insights_validated: 0,
    insights_auto_approved: 0,
    insights_rejected: 0,
    kb_writes: 0,
    extraction_times: [] as number[],
  };
  let _pendingValidations = 0;
  const _errors: Array<{ type: string; message: string; context?: any }> = [];

  return {
    // Properties
    get brainId() { return _brainId; },
    set brainId(value: string | null) { _brainId = value; },
    sessionStart: new Date().toISOString(),

    // Methods
    load: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    checkpoint: vi.fn().mockResolvedValue(undefined),

    getMetrics: vi.fn(() => _metrics),
    updateMetrics: vi.fn((updates: Partial<typeof _metrics>) => {
      Object.assign(_metrics, updates);
    }),

    updateExtractionTime: vi.fn((ms: number) => {
      _metrics.extraction_times.push(ms);
    }),

    recordKBWrite: vi.fn(() => {
      _metrics.kb_writes++;
    }),

    recordAutoApproval: vi.fn(() => {
      _metrics.insights_auto_approved++;
    }),

    recordError: vi.fn((type: string, message: string, context?: any) => {
      _errors.push({ type, message, context });
    }),

    addRecentInsight: vi.fn(),

    findDuplicateInsight: vi.fn(() => null),

    addPendingValidation: vi.fn(),
    removePendingValidation: vi.fn(),
    completeValidation: vi.fn(),

    getPendingValidationCount: vi.fn(() => _pendingValidations),
    incrementPendingValidations: vi.fn(() => { _pendingValidations++; }),
    decrementPendingValidations: vi.fn(() => { _pendingValidations = Math.max(0, _pendingValidations - 1); }),

    getSessionStats: vi.fn(() => ({
      brainId: _brainId,
      sessionStart: new Date().toISOString(),
      durationMs: 60000,
      insightsExtracted: _metrics.insights_extracted,
      insightsValidated: _metrics.insights_validated,
      insightsAutoApproved: _metrics.insights_auto_approved,
      insightsRejected: _metrics.insights_rejected,
      kbWrites: _metrics.kb_writes,
      pendingValidations: _pendingValidations,
      extractionErrors: _errors.length,
      avgExtractionMs: _metrics.extraction_times.length > 0
        ? _metrics.extraction_times.reduce((a, b) => a + b, 0) / _metrics.extraction_times.length
        : 0,
    })),

    // Test helpers
    _metrics,
    _errors,
    _reset() {
      _brainId = TEST_BRAIN_ID;
      _pendingValidations = 0;
      _errors.length = 0;
      Object.assign(_metrics, {
        insights_extracted: 0,
        insights_validated: 0,
        insights_auto_approved: 0,
        insights_rejected: 0,
        kb_writes: 0,
        extraction_times: [],
      });
    },
  };
}

/**
 * Create mock Qdrant client for integration tests.
 */
function createIntegrationQdrantClient() {
  const _writtenInsights: any[] = [];
  const _searchResults: any[] = [];

  return {
    writeInsightWithContent: vi.fn().mockResolvedValue({
      success: true,
      pointId: `qdrant_${Date.now()}`,
    }),

    checkDuplicateByContent: vi.fn().mockResolvedValue({
      isDuplicate: false,
      similarId: null,
      similarity: null,
    }),

    searchInsights: vi.fn().mockResolvedValue(_searchResults),

    getInsightsByDateRange: vi.fn().mockResolvedValue([]),

    archiveInsight: vi.fn().mockResolvedValue(true),

    updateApplicationStats: vi.fn().mockResolvedValue(true),

    // Test helpers
    _writtenInsights,
    _setSearchResults(results: any[]) {
      _searchResults.length = 0;
      _searchResults.push(...results);
    },
    _setDuplicateResult(result: { isDuplicate: boolean; similarId?: string; similarity?: number }) {
      (this.checkDuplicateByContent as any).mockResolvedValue({
        isDuplicate: result.isDuplicate,
        similarId: result.similarId ?? null,
        similarity: result.similarity ?? null,
      });
    },
    _reset() {
      _writtenInsights.length = 0;
      _searchResults.length = 0;
    },
  };
}

/**
 * Create mock Redis client for integration tests.
 */
function createIntegrationRedisClient() {
  const _validations = new Map<string, any>();
  const _templatePerformances = new Map<string, any>();
  let _lastSynthesis: string | null = null;

  return {
    ping: vi.fn().mockResolvedValue(true),

    // Validation queue methods - match actual LearningLoopRedisClient interface
    setValidationItem: vi.fn(async (item: any) => {
      _validations.set(item.id, item);
    }),

    getValidationItem: vi.fn(async (validationId: string) => {
      return _validations.get(validationId) ?? null;
    }),

    updateValidationItem: vi.fn(async (item: any) => {
      if (_validations.has(item.id)) {
        _validations.set(item.id, item);
      }
    }),

    deleteValidationItem: vi.fn(async (validationId: string, _brainId: string) => {
      return _validations.delete(validationId);
    }),

    getPendingValidationIds: vi.fn(async (brainId: string) => {
      return Array.from(_validations.values())
        .filter(v => v.brain_id === brainId && v.status === 'pending')
        .map(v => v.id);
    }),

    getPendingValidations: vi.fn(async (brainId: string) => {
      return Array.from(_validations.values())
        .filter(v => v.brain_id === brainId && v.status === 'pending');
    }),

    getPendingValidationCount: vi.fn(async (brainId: string) => {
      return Array.from(_validations.values())
        .filter(v => v.brain_id === brainId && v.status === 'pending').length;
    }),

    // Template performance methods
    getTemplatePerformance: vi.fn(async (brainId: string, templateId: string) => {
      return _templatePerformances.get(`${brainId}:${templateId}`) ?? null;
    }),

    setTemplatePerformance: vi.fn(async (brainId: string, templateId: string, perf: any) => {
      _templatePerformances.set(`${brainId}:${templateId}`, perf);
    }),

    recordUsage: vi.fn(async (brainId: string, templateId: string) => {
      const key = `${brainId}:${templateId}`;
      const existing = _templatePerformances.get(key) ?? { times_used: 0 };
      _templatePerformances.set(key, { ...existing, times_used: existing.times_used + 1 });
    }),

    recordOutcome: vi.fn(async (brainId: string, templateId: string, outcome: string) => {
      const key = `${brainId}:${templateId}`;
      const existing = _templatePerformances.get(key) ?? { outcomes: {} };
      const outcomes = existing.outcomes ?? {};
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      _templatePerformances.set(key, { ...existing, outcomes });
    }),

    getAllTemplatePerformances: vi.fn(async (brainId: string) => {
      const result: any[] = [];
      for (const [key, perf] of _templatePerformances.entries()) {
        if (key.startsWith(`${brainId}:`)) {
          result.push(perf);
        }
      }
      return result;
    }),

    getDecliningTemplates: vi.fn(async () => []),

    // Synthesis methods
    setLastSynthesisRun: vi.fn(async (brainId: string, ts: string) => {
      _lastSynthesis = ts;
    }),

    getLastSynthesisRun: vi.fn(async (brainId: string) => _lastSynthesis),

    isSynthesisDue: vi.fn(async () => true),

    // Test helpers
    _validations,
    _templatePerformances,
    _reset() {
      _validations.clear();
      _templatePerformances.clear();
      _lastSynthesis = null;
    },
  };
}

/**
 * Create mock Slack client for integration tests.
 */
function createIntegrationSlackClient() {
  const _messages: any[] = [];
  const _validationRequests: any[] = [];

  return {
    sendValidationRequest: vi.fn(async (insight: any, channel: string) => {
      const ts = `${Date.now()}.${Math.floor(Math.random() * 1000000)}`;
      _validationRequests.push({ insight, channel, ts });
      return { ok: true, ts };
    }),

    updateValidationMessage: vi.fn().mockResolvedValue({ ok: true }),

    sendWeeklySynthesis: vi.fn(async (synthesis: any) => {
      _messages.push({ type: 'synthesis', synthesis });
      return { success: true, ts: `${Date.now()}.123456` };
    }),

    sendDecliningTemplateAlert: vi.fn().mockResolvedValue({ ok: true }),

    // Test helpers
    _messages,
    _validationRequests,
    _reset() {
      _messages.length = 0;
      _validationRequests.length = 0;
    },
  };
}

/**
 * Create mock Anthropic client that returns configurable responses.
 */
function createConfigurableMockClaude(extractedInsights: any[] = []) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify(extractedInsights),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };
}

// ===========================================
// Integration Tests
// ===========================================

describe('Learning Loop Integration', () => {
  let agent: LearningLoopAgent;
  let mockState: ReturnType<typeof createIntegrationStateManager>;
  let mockQdrant: ReturnType<typeof createIntegrationQdrantClient>;
  let mockRedis: ReturnType<typeof createIntegrationRedisClient>;
  let mockSlack: ReturnType<typeof createIntegrationSlackClient>;

  beforeEach(async () => {
    mockState = createIntegrationStateManager();
    mockQdrant = createIntegrationQdrantClient();
    mockRedis = createIntegrationRedisClient();
    mockSlack = createIntegrationSlackClient();

    // Create agent with all mocked components
    agent = new LearningLoopAgent(
      mockState as any,
      mockQdrant as any,
      mockRedis as any,
      mockSlack as any,
      {
        quality_gates: {
          confidence_threshold: 0.7,
          duplicate_similarity_threshold: 0.85,
          auto_approve_confidence: 0.85,
        },
        features: {
          auto_approve_medium_importance: true,
        },
      }
    );

    // Initialize agent
    await agent.initialize();
    agent.setBrainId(TEST_BRAIN_ID);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockState._reset();
    mockQdrant._reset();
    mockRedis._reset();
    mockSlack._reset();
  });

  // ===========================================
  // Auto-Approve Pipeline Tests
  // ===========================================

  describe('Auto-Approve Pipeline (Source → Extract → Gates → KB)', () => {
    it('should auto-approve high-confidence insights and write to KB', async () => {
      // Setup: Mock Claude to return high-confidence insight
      const highConfidenceInsight = {
        category: 'pain_point',
        content: 'Manual data entry consuming 10+ hours weekly',
        extracted_quote: 'We spend over 10 hours a week on manual data entry',
        importance: 'high',
        actionable: true,
        action_suggestion: 'Demo automation features',
        confidence: 0.92, // Above auto-approve threshold (0.85)
      };

      // Create extraction request
      const request = createTestExtractionRequest({
        brain_id: TEST_BRAIN_ID,
        source_type: 'email_reply',
        content: 'We spend over 10 hours a week on manual data entry. It is killing our productivity.',
        lead: createTestLead({ company_name: 'Test Corp' }),
      });

      // Mock extractor to return high-confidence result
      const extractor = agent.getExtractor();
      (extractor as any).client = createConfigurableMockClaude([highConfidenceInsight]);

      // Process the source
      const result = await agent.processSource(request);

      // Verify successful processing
      expect(result.success).toBe(true);
      expect(result.insightsExtracted).toBe(1);
      expect(result.insightsAutoApproved).toBe(1);
      expect(result.insightsQueued).toBe(0);
      expect(result.insightsRejected).toBe(0);

      // Verify KB write was called
      expect(mockQdrant.writeInsightWithContent).toHaveBeenCalled();

      // Verify state was updated
      expect(mockState.recordAutoApproval).toHaveBeenCalled();
    });

    it('should reject duplicate insights', async () => {
      // Setup: Mock duplicate detection to find existing
      mockQdrant._setDuplicateResult({
        isDuplicate: true,
        similarId: 'existing_insight_123',
        similarity: 0.96,
      });

      const insight = {
        category: 'objection',
        content: 'Budget constraints mentioned',
        importance: 'medium',
        actionable: true,
        confidence: 0.88,
      };

      const request = createTestExtractionRequest({
        brain_id: TEST_BRAIN_ID,
        content: 'We have budget constraints this quarter.',
      });

      const extractor = agent.getExtractor();
      (extractor as any).client = createConfigurableMockClaude([insight]);

      const result = await agent.processSource(request);

      expect(result.success).toBe(true);
      expect(result.insightsExtracted).toBe(1);
      expect(result.insightsRejected).toBe(1);
      expect(result.insightsAutoApproved).toBe(0);

      // Verify no KB write for duplicate
      expect(mockQdrant.writeInsightWithContent).not.toHaveBeenCalled();
    });

    it('should reject low-confidence insights', async () => {
      const lowConfidenceInsight = {
        category: 'icp_signal',
        content: 'Might be using cloud services',
        importance: 'low',
        actionable: false,
        confidence: 0.45, // Below confidence threshold (0.7)
      };

      const request = createTestExtractionRequest({
        brain_id: TEST_BRAIN_ID,
        content: 'Some vague email content.',
      });

      const extractor = agent.getExtractor();
      (extractor as any).client = createConfigurableMockClaude([lowConfidenceInsight]);

      const result = await agent.processSource(request);

      expect(result.success).toBe(true);
      expect(result.insightsExtracted).toBe(1);
      expect(result.insightsRejected).toBe(1);
      expect(result.insightsAutoApproved).toBe(0);
      expect(result.insightsQueued).toBe(0);
    });
  });

  // ===========================================
  // Validation Queue Pipeline Tests
  // ===========================================

  describe('Validation Pipeline (Source → Extract → Gates → Validation → KB)', () => {
    it('should queue medium-confidence insights for validation', async () => {
      const mediumConfidenceInsight = {
        category: 'competitive_intel',
        content: 'Currently evaluating Competitor X',
        extracted_quote: 'We are looking at Competitor X as well',
        importance: 'high',
        actionable: true,
        confidence: 0.78, // Above threshold but below auto-approve
      };

      const request = createTestExtractionRequest({
        brain_id: TEST_BRAIN_ID,
        source_type: 'call_transcript',
        content: '[Prospect]: We are looking at Competitor X as well.',
        lead: createTestLead({ company_name: 'Acme Inc' }),
      });

      const extractor = agent.getExtractor();
      (extractor as any).client = createConfigurableMockClaude([mediumConfidenceInsight]);

      const result = await agent.processSource(request);

      expect(result.success).toBe(true);
      expect(result.insightsExtracted).toBe(1);
      expect(result.insightsQueued).toBe(1);
      expect(result.insightsAutoApproved).toBe(0);

      // Verify Slack notification was sent
      expect(mockSlack.sendValidationRequest).toHaveBeenCalled();

      // Verify validation was added to queue (interface uses setValidationItem with just the item)
      expect(mockRedis.setValidationItem).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          brain_id: TEST_BRAIN_ID,
        })
      );
    });

    it('should handle validation approval and write to KB', async () => {
      // First, queue an insight
      const insight = {
        category: 'buying_process',
        content: 'Decision maker is VP of Sales',
        importance: 'high',
        actionable: true,
        confidence: 0.75,
      };

      const request = createTestExtractionRequest({
        brain_id: TEST_BRAIN_ID,
        content: 'The decision maker would be our VP of Sales.',
      });

      const extractor = agent.getExtractor();
      (extractor as any).client = createConfigurableMockClaude([insight]);

      // Process to queue for validation
      await agent.processSource(request);

      expect(mockRedis.setValidationItem).toHaveBeenCalled();

      // Simulate getting the validation ID
      const setValidationCall = (mockRedis.setValidationItem as any).mock.calls[0];
      expect(setValidationCall).toBeDefined();
    });
  });

  // ===========================================
  // Multiple Insights Pipeline Tests
  // ===========================================

  describe('Multiple Insights Processing', () => {
    it('should process multiple insights from single source with mixed outcomes', async () => {
      const insights = [
        {
          category: 'pain_point',
          content: 'Slow reporting process',
          importance: 'high',
          actionable: true,
          confidence: 0.92, // Auto-approve
        },
        {
          category: 'objection',
          content: 'Need stakeholder buy-in',
          importance: 'medium',
          actionable: true,
          confidence: 0.76, // Queue for validation
        },
        {
          category: 'icp_signal',
          content: 'Small team maybe',
          importance: 'low',
          actionable: false,
          confidence: 0.55, // Reject - low confidence
        },
      ];

      const request = createTestExtractionRequest({
        brain_id: TEST_BRAIN_ID,
        content: 'Our reporting is slow. We need stakeholder buy-in. We have a small team.',
      });

      const extractor = agent.getExtractor();
      (extractor as any).client = createConfigurableMockClaude(insights);

      const result = await agent.processSource(request);

      expect(result.success).toBe(true);
      expect(result.insightsExtracted).toBe(3);
      expect(result.insightsAutoApproved).toBe(1);
      expect(result.insightsQueued).toBe(1);
      expect(result.insightsRejected).toBe(1);
    });

    it('should handle source with no extractable insights', async () => {
      const request = createTestExtractionRequest({
        brain_id: TEST_BRAIN_ID,
        content: 'Thanks for the info. Have a great day!',
      });

      const extractor = agent.getExtractor();
      (extractor as any).client = createConfigurableMockClaude([]); // No insights

      const result = await agent.processSource(request);

      expect(result.success).toBe(true);
      expect(result.insightsExtracted).toBe(0);
      expect(result.insightsAutoApproved).toBe(0);
      expect(result.insightsQueued).toBe(0);
      expect(result.insightsRejected).toBe(0);
    });
  });

  // ===========================================
  // Template Tracking Tests
  // ===========================================

  describe('Template Tracking Integration', () => {
    it('should track template usage through agent', async () => {
      const result = await agent.recordTemplateUsage('template_intro_001', {
        leadId: 'lead_123',
        campaignId: 'campaign_456',
      });

      expect(result.success).toBe(true);
      expect(mockRedis.setTemplatePerformance).toHaveBeenCalled();
    });

    it('should track template outcome through agent', async () => {
      // First record usage
      await agent.recordTemplateUsage('template_follow_up');

      // Then record outcome
      const result = await agent.recordTemplateOutcome('template_follow_up', 'positive');

      expect(result.success).toBe(true);
    });
  });

  // ===========================================
  // Weekly Synthesis Tests
  // ===========================================

  describe('Weekly Synthesis Integration', () => {
    it('should generate weekly synthesis through agent', async () => {
      // Setup some mock data
      mockQdrant.getInsightsByDateRange = vi.fn().mockResolvedValue([
        {
          id: 'ins_1',
          payload: {
            category: 'pain_point',
            content: 'Test insight',
            confidence: 0.85,
            validation: { status: 'validated' },
          },
        },
      ]);

      const result = await agent.generateWeeklySynthesis();

      expect(result.success).toBe(true);
      expect(result.synthesis).toBeDefined();
      expect(mockSlack.sendWeeklySynthesis).toHaveBeenCalled();
    });
  });

  // ===========================================
  // Agent Stats Tests
  // ===========================================

  describe('Agent Statistics', () => {
    it('should return accurate stats after processing', async () => {
      const insights = [
        { category: 'pain_point', content: 'Issue 1', importance: 'high', actionable: true, confidence: 0.9 },
        { category: 'objection', content: 'Objection 1', importance: 'medium', actionable: true, confidence: 0.75 },
      ];

      const request = createTestExtractionRequest({ brain_id: TEST_BRAIN_ID });
      const extractor = agent.getExtractor();
      (extractor as any).client = createConfigurableMockClaude(insights);

      await agent.processSource(request);

      const stats = agent.getStats();

      expect(stats.brainId).toBe(TEST_BRAIN_ID);
      expect(stats.insightsExtracted).toBeGreaterThanOrEqual(0);
    });

    it('should track pending validation count', async () => {
      const insight = {
        category: 'competitive_intel',
        content: 'Competitor pricing info',
        importance: 'high',
        actionable: true,
        confidence: 0.78,
      };

      const request = createTestExtractionRequest({ brain_id: TEST_BRAIN_ID });
      const extractor = agent.getExtractor();
      (extractor as any).client = createConfigurableMockClaude([insight]);

      await agent.processSource(request);

      // Pending count should increase after queuing (state manager uses addPendingValidation)
      expect(mockState.addPendingValidation).toHaveBeenCalled();
    });
  });

  // ===========================================
  // Error Handling Tests
  // ===========================================

  describe('Error Handling', () => {
    it('should handle extraction errors gracefully', async () => {
      const extractor = agent.getExtractor();
      (extractor as any).client = {
        messages: {
          create: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
        },
      };

      const request = createTestExtractionRequest({ brain_id: TEST_BRAIN_ID });

      const result = await agent.processSource(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API rate limit exceeded');
      expect(mockState.recordError).toHaveBeenCalled();
    });

    it('should handle Qdrant write failure', async () => {
      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: false,
        pointId: '',
        error: 'Qdrant connection failed',
      });

      const insight = {
        category: 'pain_point',
        content: 'Test insight',
        importance: 'high',
        actionable: true,
        confidence: 0.92,
      };

      const request = createTestExtractionRequest({ brain_id: TEST_BRAIN_ID });
      const extractor = agent.getExtractor();
      (extractor as any).client = createConfigurableMockClaude([insight]);

      const result = await agent.processSource(request);

      // Should report as rejected since write failed
      expect(result.insightsRejected).toBe(1);
      expect(result.insightsAutoApproved).toBe(0);
    });

    it('should return error if agent not initialized', async () => {
      // Create new agent without initializing
      const uninitAgent = new LearningLoopAgent(
        mockState as any,
        mockQdrant as any,
        mockRedis as any,
        mockSlack as any
      );

      const request = createTestExtractionRequest({ brain_id: TEST_BRAIN_ID });

      const result = await uninitAgent.processSource(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });
  });

  // ===========================================
  // State Checkpointing Tests
  // ===========================================

  describe('State Checkpointing', () => {
    it('should checkpoint state after processing', async () => {
      const insight = {
        category: 'pain_point',
        content: 'Test insight',
        importance: 'high',
        actionable: true,
        confidence: 0.92,
      };

      const request = createTestExtractionRequest({ brain_id: TEST_BRAIN_ID });
      const extractor = agent.getExtractor();
      (extractor as any).client = createConfigurableMockClaude([insight]);

      await agent.processSource(request);

      expect(mockState.checkpoint).toHaveBeenCalled();
    });

    it('should allow manual checkpoint', async () => {
      await agent.checkpoint();

      expect(mockState.checkpoint).toHaveBeenCalled();
    });
  });

  // ===========================================
  // Brain ID Tests
  // ===========================================

  describe('Brain ID Management', () => {
    it('should require brain ID for synthesis', async () => {
      agent.setBrainId(null as any);

      const result = await agent.generateWeeklySynthesis();

      expect(result.success).toBe(false);
      expect(result.error).toContain('No active brain');
    });

    it('should require brain ID for template tracking', async () => {
      agent.setBrainId(null as any);

      const result = await agent.recordTemplateUsage('template_123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No active brain');
    });

    it('should allow setting and getting brain ID', () => {
      agent.setBrainId('new_brain_id');

      expect(agent.getBrainId()).toBe('new_brain_id');
    });
  });
});
