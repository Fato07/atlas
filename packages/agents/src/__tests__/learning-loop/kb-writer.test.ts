/**
 * Learning Loop KB Writer Tests
 *
 * Tests for FR-018 through FR-021:
 * - FR-018: Generate embeddings
 * - FR-019: Store with provenance tracking
 * - FR-020: Handle deduplication
 * - FR-021: Track application stats
 *
 * @module __tests__/learning-loop/kb-writer.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KBWriter, createKBWriter, DEFAULT_KB_WRITER_CONFIG } from '../../learning-loop/kb-writer';
import { createTestInsight, TEST_BRAIN_ID } from './fixtures';
import {
  createMockQdrantClient,
  createMockStateManager,
} from './fixtures/mock-clients';

describe('KBWriter', () => {
  let kbWriter: KBWriter;
  let mockQdrant: ReturnType<typeof createMockQdrantClient>;
  let mockStateManager: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    mockQdrant = createMockQdrantClient();
    mockStateManager = createMockStateManager({ brainId: TEST_BRAIN_ID });
    kbWriter = createKBWriter(mockQdrant, mockStateManager);
  });

  // ===========================================
  // Basic Write Tests (FR-018, FR-019)
  // ===========================================

  describe('Basic Write Operations', () => {
    it('should write insight to Qdrant with correct brain_id', async () => {
      const insight = createTestInsight({
        brain_id: TEST_BRAIN_ID,
        category: 'pain_point',
        content: 'Manual data entry taking 2+ hours daily',
      });

      // Mock the writeInsightWithContent method
      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: true,
        pointId: 'qdrant_point_123',
      });

      const result = await kbWriter.write(insight);

      expect(result.success).toBe(true);
      expect(result.insight_id).toBe(insight.id);
      expect(result.qdrant_id).toBe('qdrant_point_123');

      // Verify brain_id was passed to write
      expect(mockQdrant.writeInsightWithContent).toHaveBeenCalledWith(
        TEST_BRAIN_ID,
        expect.any(Object)
      );
    });

    it('should include provenance tracking in payload', async () => {
      const insight = createTestInsight({
        source: {
          type: 'email_reply',
          source_id: 'email_thread_123',
          lead_id: 'lead_456',
          company_id: 'company_789',
          company_name: 'Test Corp',
          conversation_context: 'Previous discussion about pricing',
          extracted_quote: 'We spend hours on manual entry',
        },
      });

      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: true,
        pointId: 'qdrant_point_123',
      });

      await kbWriter.write(insight);

      // Verify provenance data was included in payload
      const payload = (mockQdrant.writeInsightWithContent as any).mock.calls[0][1];
      expect(payload.source.type).toBe('email_reply');
      expect(payload.source.source_id).toBe('email_thread_123');
      expect(payload.source.lead_id).toBe('lead_456');
    });

    it('should set created_at and updated_at timestamps', async () => {
      const insight = createTestInsight();

      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: true,
        pointId: 'qdrant_point_123',
      });

      const beforeWrite = new Date().toISOString();
      await kbWriter.write(insight);
      const afterWrite = new Date().toISOString();

      const payload = (mockQdrant.writeInsightWithContent as any).mock.calls[0][1];
      expect(payload.created_at).toBeDefined();
      expect(payload.updated_at).toBeDefined();
      expect(payload.created_at >= beforeWrite).toBe(true);
      expect(payload.created_at <= afterWrite).toBe(true);
    });
  });

  // ===========================================
  // Duplicate Handling Tests (FR-020)
  // ===========================================

  describe('Duplicate Handling (FR-020)', () => {
    it('should check for duplicates before writing', async () => {
      const insight = createTestInsight();

      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: true,
        pointId: 'qdrant_point_123',
      });

      await kbWriter.write(insight);

      expect(mockQdrant.checkDuplicateByContent).toHaveBeenCalledWith(
        insight.brain_id,
        insight.content
      );
    });

    it('should reject duplicate insights', async () => {
      const duplicateQdrant = createMockQdrantClient({
        duplicateResult: {
          isDuplicate: true,
          similarId: 'existing_insight_456',
          similarity: 0.95,
        },
      });

      const writer = createKBWriter(duplicateQdrant, mockStateManager);

      const insight = createTestInsight({
        content: 'Duplicate content',
      });

      const result = await writer.write(insight);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Duplicate of existing_insight_456');
    });

    it('should skip duplicate check when option is set', async () => {
      const insight = createTestInsight();

      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: true,
        pointId: 'qdrant_point_123',
      });

      await kbWriter.write(insight, { skipDuplicateCheck: true });

      expect(mockQdrant.checkDuplicateByContent).not.toHaveBeenCalled();
    });

    it('should add written insight to recent insights for local dedup', async () => {
      const insight = createTestInsight({
        content: 'New unique insight',
        category: 'objection',
      });

      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: true,
        pointId: 'qdrant_point_123',
      });

      await kbWriter.write(insight);

      expect(mockStateManager.addRecentInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          insight_id: insight.id,
          category: 'objection',
        })
      );
    });
  });

  // ===========================================
  // Retry Logic Tests
  // ===========================================

  describe('Retry Logic', () => {
    it('should retry on write failure', async () => {
      let attempts = 0;
      mockQdrant.writeInsightWithContent = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Temporary failure');
        }
        return { success: true, pointId: 'qdrant_point_123' };
      });

      const writer = createKBWriter(mockQdrant, mockStateManager, {
        maxRetries: 3,
        retryDelayMs: 10, // Short delay for tests
      });

      const insight = createTestInsight();
      const result = await writer.write(insight);

      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });

    it('should fail after max retries exceeded', async () => {
      mockQdrant.writeInsightWithContent = vi.fn().mockRejectedValue(
        new Error('Persistent failure')
      );

      const writer = createKBWriter(mockQdrant, mockStateManager, {
        maxRetries: 2,
        retryDelayMs: 10,
      });

      const insight = createTestInsight();
      const result = await writer.write(insight);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Persistent failure');
      expect(mockQdrant.writeInsightWithContent).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================
  // Validation Status Tests
  // ===========================================

  describe('Validation Status', () => {
    it('should write auto-approved insight with correct status', async () => {
      const insight = createTestInsight();

      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: true,
        pointId: 'qdrant_point_123',
      });

      await kbWriter.writeAutoApproved(insight);

      const payload = (mockQdrant.writeInsightWithContent as any).mock.calls[0][1];
      expect(payload.validation.status).toBe('auto_approved');
      expect(mockStateManager.recordAutoApproval).toHaveBeenCalled();
    });

    it('should write validated insight with validator ID', async () => {
      const insight = createTestInsight();

      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: true,
        pointId: 'qdrant_point_123',
      });

      await kbWriter.writeValidated(insight, 'U123456');

      const payload = (mockQdrant.writeInsightWithContent as any).mock.calls[0][1];
      expect(payload.validation.status).toBe('validated');
      expect(payload.validation.validated_by).toBe('U123456');
    });

    it('should skip duplicate check for validated insights', async () => {
      const insight = createTestInsight();

      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: true,
        pointId: 'qdrant_point_123',
      });

      await kbWriter.writeValidated(insight, 'U123456');

      expect(mockQdrant.checkDuplicateByContent).not.toHaveBeenCalled();
    });
  });

  // ===========================================
  // Application Stats Tests (FR-021)
  // ===========================================

  describe('Application Stats (FR-021)', () => {
    it('should update application stats for an insight', async () => {
      mockQdrant.updateApplicationStats = vi.fn().mockResolvedValue(true);

      const stats = {
        applied_count: 5,
        success_rate: 0.8,
        last_applied_at: new Date().toISOString(),
      };

      const result = await kbWriter.updateApplicationStats('qdrant_point_123', stats);

      expect(result).toBe(true);
      expect(mockQdrant.updateApplicationStats).toHaveBeenCalledWith(
        'qdrant_point_123',
        stats
      );
    });

    it('should handle stats update failure', async () => {
      mockQdrant.updateApplicationStats = vi.fn().mockRejectedValue(
        new Error('Update failed')
      );

      const stats = {
        applied_count: 5,
        success_rate: 0.8,
        last_applied_at: new Date().toISOString(),
      };

      const result = await kbWriter.updateApplicationStats('qdrant_point_123', stats);

      expect(result).toBe(false);
    });
  });

  // ===========================================
  // Batch Write Tests
  // ===========================================

  describe('Batch Write', () => {
    it('should write multiple insights in batch', async () => {
      const insights = [
        createTestInsight({ id: 'insight_1', content: 'First insight' }),
        createTestInsight({ id: 'insight_2', content: 'Second insight' }),
        createTestInsight({ id: 'insight_3', content: 'Third insight' }),
      ];

      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: true,
        pointId: 'qdrant_point_123',
      });

      const results = await kbWriter.writeBatch(insights);

      expect(results.size).toBe(3);
      expect(results.get('insight_1')?.success).toBe(true);
      expect(results.get('insight_2')?.success).toBe(true);
      expect(results.get('insight_3')?.success).toBe(true);
    });

    it('should continue batch even if one write fails', async () => {
      const insights = [
        createTestInsight({ id: 'insight_1', content: 'First insight that fails' }),
        createTestInsight({ id: 'insight_2', content: 'Second insight' }),
      ];

      // Mock to consistently fail for the first insight (regardless of retry attempts)
      // The writeInsightWithContent receives (brain_id, payload) where payload.content contains the insight content
      mockQdrant.writeInsightWithContent = vi.fn().mockImplementation(
        async (_brainId: string, payload: { content: string }) => {
          if (payload.content === 'First insight that fails') {
            return { success: false, pointId: '', error: 'Write failed' };
          }
          return { success: true, pointId: 'qdrant_point_123' };
        }
      );

      // Need to make the duplicate check consistent
      mockQdrant.checkDuplicateByContent = vi.fn().mockResolvedValue({
        isDuplicate: false,
        similarId: null,
        similarity: null,
      });

      const results = await kbWriter.writeBatch(insights);

      expect(results.size).toBe(2);
      expect(results.get('insight_1')?.success).toBe(false);
      expect(results.get('insight_2')?.success).toBe(true);
    });
  });

  // ===========================================
  // Archive Tests
  // ===========================================

  describe('Archive Operations', () => {
    it('should archive an insight by point ID', async () => {
      mockQdrant.archiveInsight = vi.fn().mockResolvedValue(true);

      const result = await kbWriter.archiveInsight('qdrant_point_123');

      expect(result).toBe(true);
      expect(mockQdrant.archiveInsight).toHaveBeenCalledWith('qdrant_point_123');
    });

    it('should handle archive failure', async () => {
      mockQdrant.archiveInsight = vi.fn().mockRejectedValue(
        new Error('Archive failed')
      );

      const result = await kbWriter.archiveInsight('qdrant_point_123');

      expect(result).toBe(false);
    });
  });

  // ===========================================
  // State Manager Integration Tests
  // ===========================================

  describe('State Manager Integration', () => {
    it('should record KB write in state manager', async () => {
      const insight = createTestInsight();

      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: true,
        pointId: 'qdrant_point_123',
      });

      await kbWriter.write(insight);

      expect(mockStateManager.recordKBWrite).toHaveBeenCalled();
    });

    it('should not record KB write on failure', async () => {
      mockQdrant.writeInsightWithContent = vi.fn().mockResolvedValue({
        success: false,
        pointId: '',
        error: 'Write failed',
      });

      const writer = createKBWriter(mockQdrant, mockStateManager, {
        maxRetries: 1,
        retryDelayMs: 10,
      });

      const insight = createTestInsight();
      await writer.write(insight);

      expect(mockStateManager.recordKBWrite).not.toHaveBeenCalled();
    });
  });
});
