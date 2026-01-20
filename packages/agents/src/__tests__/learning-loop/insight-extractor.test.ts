/**
 * Learning Loop Insight Extractor Tests
 *
 * Tests for FR-001 through FR-005:
 * - FR-001: Extract insights from email replies
 * - FR-002: Extract insights from call transcripts
 * - FR-003: Category classification
 * - FR-004: Confidence scoring
 * - FR-005: Source attribution
 *
 * @module __tests__/learning-loop/insight-extractor.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InsightExtractor } from '../../learning-loop/insight-extractor';
import type { ExtractionRequest } from '../../learning-loop/types';
import {
  createTestExtractionRequest,
  createTestLead,
  TEST_BRAIN_ID,
} from './fixtures';
import { createMockAnthropicClient } from './fixtures/mock-clients';

// Note: We don't use vi.mock for @anthropic-ai/sdk because Bun's test runner
// doesn't support hoisted mocks. Instead, we inject the mock client directly
// via (extractor as any).client = mockAnthropicClient in beforeEach.

describe('InsightExtractor', () => {
  let extractor: InsightExtractor;
  let mockAnthropicClient: ReturnType<typeof createMockAnthropicClient>;

  beforeEach(() => {
    mockAnthropicClient = createMockAnthropicClient();

    // Create extractor with mocked client
    extractor = new InsightExtractor({
      apiKey: 'test-api-key',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      temperature: 0.2,
    });

    // Replace the internal client with our mock
    (extractor as any).client = mockAnthropicClient;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================
  // Basic Extraction Tests (FR-001, FR-002)
  // ===========================================

  describe('Basic Extraction', () => {
    it('should extract insights from email reply text', async () => {
      const request = createTestExtractionRequest({
        source_type: 'email_reply',
        content: `Hi John,

Thanks for reaching out. We've been struggling with our current solution -
it takes our team over 2 hours every day just entering data manually.
We're definitely interested in hearing more about how you could help.

The main decision maker would be our VP of Operations, Sarah Chen.
We typically make purchasing decisions on a quarterly basis.

Best,
Mike`,
      });

      const result = await extractor.extract(request);

      expect(result.success).toBe(true);
      expect(result.insights.length).toBeGreaterThan(0);
      expect(result.extraction_time_ms).toBeDefined();
    });

    it('should extract insights from call transcript text', async () => {
      const request = createTestExtractionRequest({
        source_type: 'call_transcript',
        content: `[00:05:23] Prospect: We looked at Competitor X last quarter, but their pricing was too high for what we needed.

[00:06:45] Prospect: Our biggest pain point is the integration with Salesforce. Everything is manual right now.

[00:08:12] You: How does that affect your team's productivity?

[00:08:30] Prospect: Honestly, we're losing at least 10 hours a week on manual data entry.`,
      });

      const result = await extractor.extract(request);

      expect(result.success).toBe(true);
      expect(result.insights.length).toBeGreaterThan(0);
    });

    it('should include thread context in extraction request', async () => {
      const request = createTestExtractionRequest({
        thread_context: 'Previous email discussed pricing concerns and timeline for Q2 implementation.',
        content: 'Looking forward to our call next week to discuss further.',
      });

      await extractor.extract(request);

      // Verify thread context was passed to Claude
      expect(mockAnthropicClient.messages.create).toHaveBeenCalled();
      const callArgs = mockAnthropicClient.messages.create.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain('Thread Context');
    });
  });

  // ===========================================
  // Category Classification Tests (FR-003)
  // ===========================================

  describe('Category Classification (FR-003)', () => {
    it('should classify pain_point insights correctly', async () => {
      const painPointResponse = JSON.stringify([
        {
          category: 'pain_point',
          content: 'Manual data entry consuming 10+ hours weekly',
          extracted_quote: 'we spend 10 hours a week on manual entry',
          importance: 'high',
          actionable: true,
          action_suggestion: 'Emphasize automation capabilities',
          confidence: 0.92,
        },
      ]);

      mockAnthropicClient = createMockAnthropicClient({
        responseContent: painPointResponse,
      });
      (extractor as any).client = mockAnthropicClient;

      const request = createTestExtractionRequest({
        content: 'We spend 10 hours a week on manual entry.',
      });

      const result = await extractor.extract(request);

      expect(result.success).toBe(true);
      expect(result.insights[0].category).toBe('pain_point');
    });

    it('should classify objection insights correctly', async () => {
      const objectionResponse = JSON.stringify([
        {
          category: 'objection',
          content: 'Budget constraints for Q1',
          extracted_quote: 'Our budget is frozen until Q2',
          importance: 'high',
          actionable: true,
          action_suggestion: 'Propose Q2 start with preliminary planning now',
          confidence: 0.88,
        },
      ]);

      mockAnthropicClient = createMockAnthropicClient({
        responseContent: objectionResponse,
      });
      (extractor as any).client = mockAnthropicClient;

      const request = createTestExtractionRequest({
        content: 'Our budget is frozen until Q2, so we cannot proceed right now.',
      });

      const result = await extractor.extract(request);

      expect(result.success).toBe(true);
      expect(result.insights[0].category).toBe('objection');
    });

    it('should classify competitive_intel insights correctly', async () => {
      const competitorResponse = JSON.stringify([
        {
          category: 'competitive_intel',
          content: 'Competitor X pricing is $500/month',
          extracted_quote: 'We pay Competitor X about $500 per month',
          importance: 'medium',
          actionable: true,
          action_suggestion: 'Highlight value differential vs Competitor X',
          confidence: 0.85,
        },
      ]);

      mockAnthropicClient = createMockAnthropicClient({
        responseContent: competitorResponse,
      });
      (extractor as any).client = mockAnthropicClient;

      const request = createTestExtractionRequest({
        content: 'We currently pay Competitor X about $500 per month.',
      });

      const result = await extractor.extract(request);

      expect(result.success).toBe(true);
      expect(result.insights[0].category).toBe('competitive_intel');
    });

    it('should handle unknown category by defaulting to pain_point', async () => {
      const unknownCategoryResponse = JSON.stringify([
        {
          category: 'unknown_category',
          content: 'Some insight',
          importance: 'medium',
          actionable: false,
          confidence: 0.7,
        },
      ]);

      mockAnthropicClient = createMockAnthropicClient({
        responseContent: unknownCategoryResponse,
      });
      (extractor as any).client = mockAnthropicClient;

      const request = createTestExtractionRequest();

      const result = await extractor.extract(request);

      expect(result.success).toBe(true);
      expect(result.insights[0].category).toBe('pain_point');
    });
  });

  // ===========================================
  // Response Parsing Tests
  // ===========================================

  describe('Response Parsing', () => {
    it('should parse JSON response without code blocks', async () => {
      const plainJsonResponse = JSON.stringify([
        {
          category: 'buying_process',
          content: 'Decision maker is VP of Sales',
          importance: 'high',
          actionable: true,
          confidence: 0.9,
        },
      ]);

      mockAnthropicClient = createMockAnthropicClient({
        responseContent: plainJsonResponse,
      });
      (extractor as any).client = mockAnthropicClient;

      const request = createTestExtractionRequest();
      const result = await extractor.extract(request);

      expect(result.success).toBe(true);
      expect(result.insights).toHaveLength(1);
    });

    it('should parse JSON response with markdown code blocks', async () => {
      const markdownResponse = `\`\`\`json
[
  {
    "category": "icp_signal",
    "content": "Company uses Salesforce CRM",
    "importance": "medium",
    "actionable": false,
    "confidence": 0.85
  }
]
\`\`\``;

      mockAnthropicClient = createMockAnthropicClient({
        responseContent: markdownResponse,
      });
      (extractor as any).client = mockAnthropicClient;

      const request = createTestExtractionRequest();
      const result = await extractor.extract(request);

      expect(result.success).toBe(true);
      expect(result.insights).toHaveLength(1);
      expect(result.insights[0].category).toBe('icp_signal');
    });

    it('should handle empty array response', async () => {
      mockAnthropicClient = createMockAnthropicClient({
        responseContent: '[]',
      });
      (extractor as any).client = mockAnthropicClient;

      const request = createTestExtractionRequest({
        content: 'Thanks for the info.',
      });

      const result = await extractor.extract(request);

      expect(result.success).toBe(true);
      expect(result.insights).toHaveLength(0);
    });

    it('should handle malformed JSON response gracefully', async () => {
      mockAnthropicClient = createMockAnthropicClient({
        responseContent: 'This is not valid JSON',
      });
      (extractor as any).client = mockAnthropicClient;

      const request = createTestExtractionRequest();
      const result = await extractor.extract(request);

      expect(result.success).toBe(true);
      expect(result.insights).toHaveLength(0);
    });

    it('should normalize confidence values to 0-1 range', async () => {
      const outOfRangeResponse = JSON.stringify([
        {
          category: 'pain_point',
          content: 'Test insight',
          importance: 'medium',
          actionable: true,
          confidence: 1.5, // Out of range
        },
        {
          category: 'objection',
          content: 'Another insight',
          importance: 'low',
          actionable: false,
          confidence: -0.5, // Negative
        },
      ]);

      mockAnthropicClient = createMockAnthropicClient({
        responseContent: outOfRangeResponse,
      });
      (extractor as any).client = mockAnthropicClient;

      const request = createTestExtractionRequest();
      const result = await extractor.extract(request);

      expect(result.success).toBe(true);
      expect(result.insights[0].initial_confidence).toBeLessThanOrEqual(1);
      expect(result.insights[1].initial_confidence).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================
  // Error Handling Tests
  // ===========================================

  describe('Error Handling', () => {
    it('should handle API failure gracefully', async () => {
      mockAnthropicClient = createMockAnthropicClient({
        shouldFail: true,
        errorMessage: 'API rate limit exceeded',
      });
      (extractor as any).client = mockAnthropicClient;

      const request = createTestExtractionRequest();
      const result = await extractor.extract(request);

      expect(result.success).toBe(false);
      expect(result.insights).toHaveLength(0);
      expect(result.error).toContain('API rate limit exceeded');
    });

    it('should include extraction time even on failure', async () => {
      mockAnthropicClient = createMockAnthropicClient({
        shouldFail: true,
      });
      (extractor as any).client = mockAnthropicClient;

      const request = createTestExtractionRequest();
      const result = await extractor.extract(request);

      expect(result.extraction_time_ms).toBeDefined();
      expect(result.extraction_time_ms).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================
  // createInsights Method Tests (FR-005)
  // ===========================================

  describe('createInsights (FR-005 Source Attribution)', () => {
    it('should create ExtractedInsight objects with proper source attribution', async () => {
      const extractionResult = {
        success: true,
        insights: [
          {
            category: 'pain_point' as const,
            content: 'Manual data entry problem',
            extracted_quote: 'We spend hours on data entry',
            importance: 'high' as const,
            actionable: true,
            action_suggestion: 'Demo automation features',
            initial_confidence: 0.9,
          },
        ],
        extraction_time_ms: 150,
      };

      const request = createTestExtractionRequest({
        brain_id: TEST_BRAIN_ID,
        source_id: 'email_thread_123',
        lead: createTestLead({
          id: 'lead_456',
          company_id: 'company_789',
          company_name: 'Test Corp',
        }),
      });

      const insights = extractor.createInsights(request, extractionResult);

      expect(insights).toHaveLength(1);

      const insight = insights[0];
      expect(insight.brain_id).toBe(TEST_BRAIN_ID);
      expect(insight.source.type).toBe('email_reply');
      expect(insight.source.source_id).toBe('email_thread_123');
      expect(insight.source.lead_id).toBe('lead_456');
      expect(insight.source.company_id).toBe('company_789');
      expect(insight.source.company_name).toBe('Test Corp');
      expect(insight.source.extracted_quote).toBe('We spend hours on data entry');
    });

    it('should handle null company_id in lead', async () => {
      const extractionResult = {
        success: true,
        insights: [
          {
            category: 'objection' as const,
            content: 'Budget concern',
            extracted_quote: null,
            importance: 'medium' as const,
            actionable: true,
            action_suggestion: null,
            initial_confidence: 0.8,
          },
        ],
        extraction_time_ms: 100,
      };

      const request = createTestExtractionRequest({
        lead: createTestLead({
          company_id: undefined,
          company_name: undefined,
        }),
      });

      const insights = extractor.createInsights(request, extractionResult);

      expect(insights[0].source.company_id).toBeNull();
      expect(insights[0].source.company_name).toBeNull();
    });

    it('should include thread_context in conversation_context field', async () => {
      const extractionResult = {
        success: true,
        insights: [
          {
            category: 'buying_process' as const,
            content: 'Q2 evaluation timeline',
            extracted_quote: null,
            importance: 'high' as const,
            actionable: true,
            action_suggestion: 'Schedule demo for early Q2',
            initial_confidence: 0.85,
          },
        ],
        extraction_time_ms: 120,
      };

      const request = createTestExtractionRequest({
        thread_context: 'Previous discussion about Q1 budget constraints',
        content: 'Let us revisit in Q2 when budget opens up.',
      });

      const insights = extractor.createInsights(request, extractionResult);

      expect(insights[0].source.conversation_context).toBe(
        'Previous discussion about Q1 budget constraints'
      );
    });
  });
});
