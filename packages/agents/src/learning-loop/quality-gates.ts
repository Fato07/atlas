/**
 * Learning Loop Quality Gates
 *
 * Validates extracted insights through multiple quality gates:
 * 1. Confidence gate (FR-006)
 * 2. Duplicate detection gate (FR-007)
 * 3. Importance-based routing gate (FR-008, FR-009, FR-010)
 *
 * @module learning-loop/quality-gates
 */

import type {
  ExtractedInsight,
  InsightImportance,
  ConfidenceGateResult,
  DuplicateGateResult,
  ImportanceGateResult,
  QualityGateResults,
} from './contracts';
import type { QualityGateEvaluation, LearningLoopConfig } from './types';
import type { LearningLoopQdrantClient, DuplicateCheckResult } from './qdrant-client';
import type { LearningLoopStateManager } from './state';
import { getLogger } from './logger';

// ===========================================
// Types
// ===========================================

export interface QualityGatesConfig {
  /** Minimum confidence to pass gate */
  confidenceThreshold: number;
  /** Similarity threshold for duplicate detection */
  duplicateSimilarityThreshold: number;
  /** Confidence threshold for auto-approval */
  autoApproveConfidence: number;
  /** Auto-approve medium importance insights */
  autoApproveMediumImportance: boolean;
}

export const DEFAULT_QUALITY_GATES_CONFIG: QualityGatesConfig = {
  confidenceThreshold: 0.7,
  duplicateSimilarityThreshold: 0.85,
  autoApproveConfidence: 0.8,
  autoApproveMediumImportance: true,
};

// ===========================================
// Quality Gates Class
// ===========================================

export class QualityGates {
  private readonly config: QualityGatesConfig;
  private readonly qdrantClient: LearningLoopQdrantClient;
  private readonly stateManager: LearningLoopStateManager;

  constructor(
    qdrantClient: LearningLoopQdrantClient,
    stateManager: LearningLoopStateManager,
    config?: Partial<QualityGatesConfig>
  ) {
    this.config = { ...DEFAULT_QUALITY_GATES_CONFIG, ...config };
    this.qdrantClient = qdrantClient;
    this.stateManager = stateManager;
  }

  // ===========================================
  // Main Evaluation Method
  // ===========================================

  /**
   * Evaluate an insight through all quality gates.
   */
  async evaluate(insight: ExtractedInsight): Promise<QualityGateEvaluation> {
    const logger = getLogger();

    logger.debug('Evaluating insight through quality gates', {
      insight_id: insight.id,
      category: insight.category,
      importance: insight.importance,
      confidence: insight.initial_confidence,
    });

    // Run all gates
    const confidenceResult = this.evaluateConfidenceGate(insight);
    const duplicateResult = await this.evaluateDuplicateGate(insight);
    const importanceResult = this.evaluateImportanceGate(insight);

    // Determine overall result
    const passed = confidenceResult.passed && duplicateResult.passed;
    const requiresValidation = passed && importanceResult.requires_validation;
    const autoApproved = passed && !requiresValidation && this.canAutoApprove(insight);

    const evaluation: QualityGateEvaluation = {
      passed,
      requires_validation: requiresValidation,
      auto_approved: autoApproved,
      gates: {
        confidence: {
          passed: confidenceResult.passed,
          score: confidenceResult.score,
          threshold: confidenceResult.threshold,
        },
        duplicate: {
          passed: duplicateResult.passed,
          is_duplicate: duplicateResult.is_duplicate,
          similar_id: duplicateResult.similar_insight_id ?? null,
          similarity: duplicateResult.similarity_score ?? null,
        },
        importance: {
          level: importanceResult.importance,
          requires_validation: importanceResult.requires_validation,
          reason: importanceResult.reason,
        },
      },
    };

    logger.info('Quality gate evaluation complete', {
      insight_id: insight.id,
      passed,
      requires_validation: requiresValidation,
      auto_approved: autoApproved,
    });

    return evaluation;
  }

  // ===========================================
  // Individual Gates
  // ===========================================

  /**
   * Evaluate confidence gate (FR-006).
   * Insights with confidence < threshold are rejected.
   */
  private evaluateConfidenceGate(insight: ExtractedInsight): ConfidenceGateResult {
    const passed = insight.initial_confidence >= this.config.confidenceThreshold;

    return {
      passed,
      score: insight.initial_confidence,
      threshold: this.config.confidenceThreshold,
    };
  }

  /**
   * Evaluate duplicate gate (FR-007).
   * Check both local cache and Qdrant for similar insights.
   */
  private async evaluateDuplicateGate(insight: ExtractedInsight): Promise<DuplicateGateResult> {
    // First check local cache using content as key (fast path)
    const contentKey = this.generateContentKey(insight.content, insight.category);
    const cachedDuplicate = this.stateManager.findDuplicateInsight(contentKey);
    if (cachedDuplicate) {
      return {
        passed: false,
        is_duplicate: true,
        similar_insight_id: cachedDuplicate.insight_id,
        similarity_score: 1.0,
      };
    }

    // Check Qdrant for semantic duplicates using content-based check
    try {
      const qdrantResult = await this.qdrantClient.checkDuplicateByContent(
        insight.brain_id,
        insight.content
      );

      if (qdrantResult.isDuplicate) {
        return {
          passed: false,
          is_duplicate: true,
          similar_insight_id: qdrantResult.similarId,
          similarity_score: qdrantResult.similarity,
        };
      }

      return {
        passed: true,
        is_duplicate: false,
        similar_insight_id: null,
        similarity_score: null,
      };
    } catch (error) {
      // Log error but don't block - assume not duplicate
      getLogger().warn('Duplicate check failed, assuming not duplicate', {
        insight_id: insight.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        passed: true,
        is_duplicate: false,
        similar_insight_id: null,
        similarity_score: null,
      };
    }
  }

  /**
   * Generate a content key for local duplicate checking.
   */
  private generateContentKey(content: string, category: string): string {
    // Normalize content for comparison
    const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
    return `${category}:${normalized.slice(0, 100)}`;
  }

  /**
   * Evaluate importance gate (FR-008, FR-009, FR-010).
   * Determines if insight needs human validation.
   */
  private evaluateImportanceGate(insight: ExtractedInsight): ImportanceGateResult {
    const { importance, initial_confidence: confidence } = insight;

    // High importance always requires validation unless very high confidence
    if (importance === 'high') {
      const requiresValidation = confidence < this.config.autoApproveConfidence;
      return {
        importance,
        requires_validation: requiresValidation,
        reason: requiresValidation
          ? 'High importance insight requires human validation'
          : 'High confidence allows auto-approval',
      };
    }

    // Medium importance - check config and confidence
    if (importance === 'medium') {
      if (this.config.autoApproveMediumImportance && confidence >= this.config.autoApproveConfidence) {
        return {
          importance,
          requires_validation: false,
          reason: 'Medium importance with high confidence - auto-approve eligible',
        };
      }

      return {
        importance,
        requires_validation: true,
        reason: 'Medium importance insight requires validation',
      };
    }

    // Low importance - auto-approve if confidence is reasonable
    return {
      importance,
      requires_validation: false,
      reason: 'Low importance insight - auto-approve eligible',
    };
  }

  /**
   * Check if insight can be auto-approved.
   */
  private canAutoApprove(insight: ExtractedInsight): boolean {
    const { importance, initial_confidence: confidence } = insight;

    // Low importance with reasonable confidence
    if (importance === 'low' && confidence >= this.config.confidenceThreshold) {
      return true;
    }

    // Medium importance with high confidence (if configured)
    if (
      importance === 'medium' &&
      this.config.autoApproveMediumImportance &&
      confidence >= this.config.autoApproveConfidence
    ) {
      return true;
    }

    // High importance only with very high confidence
    if (importance === 'high' && confidence >= this.config.autoApproveConfidence) {
      return true;
    }

    return false;
  }

  // ===========================================
  // Batch Evaluation
  // ===========================================

  /**
   * Evaluate multiple insights through quality gates.
   */
  async evaluateBatch(insights: ExtractedInsight[]): Promise<Map<string, QualityGateEvaluation>> {
    const results = new Map<string, QualityGateEvaluation>();

    for (const insight of insights) {
      const evaluation = await this.evaluate(insight);
      results.set(insight.id, evaluation);
    }

    return results;
  }

  /**
   * Filter insights by gate outcome.
   */
  filterByOutcome(
    insights: ExtractedInsight[],
    evaluations: Map<string, QualityGateEvaluation>,
    outcome: 'passed' | 'rejected' | 'needs_validation' | 'auto_approved'
  ): ExtractedInsight[] {
    return insights.filter(insight => {
      const evaluation = evaluations.get(insight.id);
      if (!evaluation) return false;

      switch (outcome) {
        case 'passed':
          return evaluation.passed;
        case 'rejected':
          return !evaluation.passed;
        case 'needs_validation':
          return evaluation.passed && evaluation.requires_validation;
        case 'auto_approved':
          return evaluation.passed && evaluation.auto_approved;
        default:
          return false;
      }
    });
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a QualityGates instance.
 */
export function createQualityGates(
  qdrantClient: LearningLoopQdrantClient,
  stateManager: LearningLoopStateManager,
  config?: Partial<QualityGatesConfig>
): QualityGates {
  return new QualityGates(qdrantClient, stateManager, config);
}
