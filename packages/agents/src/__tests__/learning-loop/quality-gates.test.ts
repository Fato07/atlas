/**
 * Learning Loop Quality Gates Tests
 *
 * Tests for FR-006 through FR-010:
 * - FR-006: Confidence gate (threshold validation)
 * - FR-007: Duplicate detection gate
 * - FR-008, FR-009, FR-010: Importance-based routing
 *
 * @module __tests__/learning-loop/quality-gates.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QualityGates, DEFAULT_QUALITY_GATES_CONFIG } from '../../learning-loop/quality-gates';
import {
  createTestInsight,
  TEST_BRAIN_ID,
} from './fixtures';
import {
  createMockQdrantClient,
  createMockStateManager,
} from './fixtures/mock-clients';

describe('QualityGates', () => {
  let qualityGates: QualityGates;
  let mockQdrant: ReturnType<typeof createMockQdrantClient>;
  let mockStateManager: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    mockQdrant = createMockQdrantClient();
    mockStateManager = createMockStateManager({ brainId: TEST_BRAIN_ID });
    qualityGates = new QualityGates(mockQdrant, mockStateManager);
  });

  // ===========================================
  // Confidence Gate Tests (FR-006)
  // ===========================================

  describe('Confidence Gate (FR-006)', () => {
    it('should pass insight with confidence >= threshold (0.7)', async () => {
      const insight = createTestInsight({
        initial_confidence: 0.85,
        importance: 'medium',
      });

      const result = await qualityGates.evaluate(insight);

      expect(result.gates.confidence.passed).toBe(true);
      expect(result.gates.confidence.score).toBe(0.85);
      expect(result.gates.confidence.threshold).toBe(DEFAULT_QUALITY_GATES_CONFIG.confidenceThreshold);
    });

    it('should pass insight with confidence exactly at threshold', async () => {
      const insight = createTestInsight({
        initial_confidence: 0.7,
        importance: 'low',
      });

      const result = await qualityGates.evaluate(insight);

      expect(result.gates.confidence.passed).toBe(true);
      expect(result.gates.confidence.score).toBe(0.7);
    });

    it('should reject insight with confidence below threshold', async () => {
      const insight = createTestInsight({
        initial_confidence: 0.65,
        importance: 'medium',
      });

      const result = await qualityGates.evaluate(insight);

      expect(result.gates.confidence.passed).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.gates.confidence.score).toBe(0.65);
    });

    it('should use custom confidence threshold from config', async () => {
      const customGates = new QualityGates(mockQdrant, mockStateManager, {
        confidenceThreshold: 0.5,
      });

      const insight = createTestInsight({
        initial_confidence: 0.55,
        importance: 'medium',
      });

      const result = await customGates.evaluate(insight);

      expect(result.gates.confidence.passed).toBe(true);
      expect(result.gates.confidence.threshold).toBe(0.5);
    });
  });

  // ===========================================
  // Duplicate Detection Gate Tests (FR-007)
  // ===========================================

  describe('Duplicate Detection Gate (FR-007)', () => {
    it('should pass unique insight (no duplicate found)', async () => {
      const insight = createTestInsight({
        initial_confidence: 0.85,
        content: 'Unique insight content about pain points',
      });

      const result = await qualityGates.evaluate(insight);

      expect(result.gates.duplicate.passed).toBe(true);
      expect(result.gates.duplicate.is_duplicate).toBe(false);
      expect(result.gates.duplicate.similar_id).toBeNull();
    });

    it('should detect duplicate from local cache', async () => {
      const existingInsightId = 'insight_existing_123';
      const duplicateContent = 'Manual data entry taking 2+ hours daily';
      const contentKey = `pain_point:${duplicateContent.toLowerCase().slice(0, 100)}`;

      // Add to cache via state manager
      mockStateManager.addRecentInsight(existingInsightId, contentKey, 'pain_point');

      const insight = createTestInsight({
        initial_confidence: 0.9,
        content: duplicateContent,
        category: 'pain_point',
      });

      const result = await qualityGates.evaluate(insight);

      expect(result.gates.duplicate.passed).toBe(false);
      expect(result.gates.duplicate.is_duplicate).toBe(true);
      expect(result.gates.duplicate.similar_id).toBe(existingInsightId);
      expect(result.gates.duplicate.similarity).toBe(1.0);
      expect(result.passed).toBe(false);
    });

    it('should detect duplicate from Qdrant semantic search', async () => {
      const duplicateQdrant = createMockQdrantClient({
        duplicateResult: {
          isDuplicate: true,
          similarId: 'qdrant_similar_456',
          similarity: 0.92,
        },
      });

      const gates = new QualityGates(duplicateQdrant, mockStateManager);

      const insight = createTestInsight({
        initial_confidence: 0.85,
        content: 'Similar content to existing insight',
      });

      const result = await gates.evaluate(insight);

      expect(result.gates.duplicate.passed).toBe(false);
      expect(result.gates.duplicate.is_duplicate).toBe(true);
      expect(result.gates.duplicate.similar_id).toBe('qdrant_similar_456');
      expect(result.gates.duplicate.similarity).toBe(0.92);
    });

    it('should handle Qdrant search failure gracefully (assume not duplicate)', async () => {
      const failingQdrant = createMockQdrantClient({
        searchShouldFail: true,
      });

      const gates = new QualityGates(failingQdrant, mockStateManager);

      const insight = createTestInsight({
        initial_confidence: 0.85,
      });

      const result = await gates.evaluate(insight);

      // Should pass duplicate gate on error (fail open)
      expect(result.gates.duplicate.passed).toBe(true);
      expect(result.gates.duplicate.is_duplicate).toBe(false);
    });

    it('should check Qdrant with correct brain_id', async () => {
      const insight = createTestInsight({
        brain_id: TEST_BRAIN_ID,
        initial_confidence: 0.85,
      });

      await qualityGates.evaluate(insight);

      expect(mockQdrant.checkDuplicateByContent).toHaveBeenCalledWith(
        TEST_BRAIN_ID,
        insight.content
      );
    });
  });

  // ===========================================
  // Importance Gate Tests (FR-008, FR-009, FR-010)
  // ===========================================

  describe('Importance Gate (FR-008, FR-009, FR-010)', () => {
    describe('High Importance (FR-008)', () => {
      it('should require validation for high importance with moderate confidence', async () => {
        const insight = createTestInsight({
          importance: 'high',
          initial_confidence: 0.75,
        });

        const result = await qualityGates.evaluate(insight);

        expect(result.gates.importance.level).toBe('high');
        expect(result.gates.importance.requires_validation).toBe(true);
        expect(result.requires_validation).toBe(true);
        expect(result.auto_approved).toBe(false);
      });

      it('should auto-approve high importance with very high confidence (>=0.8)', async () => {
        const insight = createTestInsight({
          importance: 'high',
          initial_confidence: 0.85,
        });

        const result = await qualityGates.evaluate(insight);

        expect(result.gates.importance.level).toBe('high');
        expect(result.gates.importance.requires_validation).toBe(false);
        expect(result.auto_approved).toBe(true);
      });
    });

    describe('Medium Importance (FR-009)', () => {
      it('should require validation for medium importance with moderate confidence', async () => {
        const insight = createTestInsight({
          importance: 'medium',
          initial_confidence: 0.75,
        });

        const result = await qualityGates.evaluate(insight);

        expect(result.gates.importance.level).toBe('medium');
        expect(result.gates.importance.requires_validation).toBe(true);
        expect(result.requires_validation).toBe(true);
      });

      it('should auto-approve medium importance with high confidence when configured', async () => {
        const insight = createTestInsight({
          importance: 'medium',
          initial_confidence: 0.85,
        });

        const result = await qualityGates.evaluate(insight);

        expect(result.gates.importance.level).toBe('medium');
        expect(result.gates.importance.requires_validation).toBe(false);
        expect(result.auto_approved).toBe(true);
      });

      it('should require validation for medium importance when auto-approve disabled', async () => {
        const strictGates = new QualityGates(mockQdrant, mockStateManager, {
          autoApproveMediumImportance: false,
        });

        const insight = createTestInsight({
          importance: 'medium',
          initial_confidence: 0.9,
        });

        const result = await strictGates.evaluate(insight);

        expect(result.gates.importance.requires_validation).toBe(true);
        expect(result.auto_approved).toBe(false);
      });
    });

    describe('Low Importance (FR-010)', () => {
      it('should auto-approve low importance with reasonable confidence', async () => {
        const insight = createTestInsight({
          importance: 'low',
          initial_confidence: 0.75,
        });

        const result = await qualityGates.evaluate(insight);

        expect(result.gates.importance.level).toBe('low');
        expect(result.gates.importance.requires_validation).toBe(false);
        expect(result.auto_approved).toBe(true);
      });

      it('should auto-approve low importance at threshold confidence', async () => {
        const insight = createTestInsight({
          importance: 'low',
          initial_confidence: 0.7,
        });

        const result = await qualityGates.evaluate(insight);

        expect(result.auto_approved).toBe(true);
      });
    });
  });

  // ===========================================
  // Overall Evaluation Tests
  // ===========================================

  describe('Overall Evaluation', () => {
    it('should pass insight that passes all gates', async () => {
      const insight = createTestInsight({
        initial_confidence: 0.85,
        importance: 'medium',
      });

      const result = await qualityGates.evaluate(insight);

      expect(result.passed).toBe(true);
      expect(result.gates.confidence.passed).toBe(true);
      expect(result.gates.duplicate.passed).toBe(true);
    });

    it('should reject if confidence gate fails (even with other gates passing)', async () => {
      const insight = createTestInsight({
        initial_confidence: 0.5,
        importance: 'low',
      });

      const result = await qualityGates.evaluate(insight);

      expect(result.passed).toBe(false);
      expect(result.gates.confidence.passed).toBe(false);
    });

    it('should reject if duplicate gate fails (even with high confidence)', async () => {
      const duplicateQdrant = createMockQdrantClient({
        duplicateResult: {
          isDuplicate: true,
          similarId: 'existing_insight',
          similarity: 0.95,
        },
      });

      const gates = new QualityGates(duplicateQdrant, mockStateManager);

      const insight = createTestInsight({
        initial_confidence: 0.95,
        importance: 'high',
      });

      const result = await gates.evaluate(insight);

      expect(result.passed).toBe(false);
      expect(result.gates.confidence.passed).toBe(true);
      expect(result.gates.duplicate.passed).toBe(false);
    });
  });

  // ===========================================
  // Batch Evaluation Tests
  // ===========================================

  describe('Batch Evaluation', () => {
    it('should evaluate multiple insights and return map of results', async () => {
      const insights = [
        createTestInsight({ id: 'insight_1', initial_confidence: 0.85 }),
        createTestInsight({ id: 'insight_2', initial_confidence: 0.6 }),
        createTestInsight({ id: 'insight_3', initial_confidence: 0.9 }),
      ];

      const results = await qualityGates.evaluateBatch(insights);

      expect(results.size).toBe(3);
      expect(results.get('insight_1')?.passed).toBe(true);
      expect(results.get('insight_2')?.passed).toBe(false);
      expect(results.get('insight_3')?.passed).toBe(true);
    });

    it('should filter insights by outcome', async () => {
      const insights = [
        createTestInsight({ id: 'insight_pass_1', initial_confidence: 0.85, importance: 'low' }),
        createTestInsight({ id: 'insight_fail', initial_confidence: 0.5, importance: 'medium' }),
        createTestInsight({ id: 'insight_pass_2', initial_confidence: 0.9, importance: 'high' }),
      ];

      const evaluations = await qualityGates.evaluateBatch(insights);

      const passed = qualityGates.filterByOutcome(insights, evaluations, 'passed');
      const rejected = qualityGates.filterByOutcome(insights, evaluations, 'rejected');
      const autoApproved = qualityGates.filterByOutcome(insights, evaluations, 'auto_approved');

      expect(passed).toHaveLength(2);
      expect(rejected).toHaveLength(1);
      expect(autoApproved.length).toBeGreaterThanOrEqual(1);
    });
  });
});
