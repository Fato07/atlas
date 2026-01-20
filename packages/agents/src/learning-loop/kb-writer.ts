/**
 * Learning Loop KB Writer
 *
 * Writes validated insights to Qdrant knowledge base:
 * 1. Generate embeddings (FR-018)
 * 2. Store with provenance tracking (FR-019)
 * 3. Handle deduplication (FR-020)
 * 4. Track application stats (FR-021)
 *
 * @module learning-loop/kb-writer
 */

import type {
  ExtractedInsight,
  StoredInsightPayload,
  InsightValidation,
  InsightValidationStatus,
} from './contracts';
import { prepareInsightForStorage } from './contracts';
import type { LearningLoopQdrantClient, WriteResult } from './qdrant-client';
import type { LearningLoopStateManager } from './state';
import type { KBWriteResult } from './types';
import { getLogger } from './logger';

// ===========================================
// Types
// ===========================================

export interface KBWriterConfig {
  /** Collection name for insights */
  insightsCollection: string;
  /** Retry attempts for writes */
  maxRetries: number;
  /** Delay between retries (ms) */
  retryDelayMs: number;
}

export const DEFAULT_KB_WRITER_CONFIG: KBWriterConfig = {
  insightsCollection: 'insights',
  maxRetries: 3,
  retryDelayMs: 1000,
};

export interface WriteOptions {
  /** Skip duplicate check (already verified) */
  skipDuplicateCheck?: boolean;
  /** Validation status to set */
  validationStatus?: InsightValidationStatus;
  /** Validator ID (if human validated) */
  validatorId?: string;
  /** Vertical for the insight */
  vertical?: string;
}

// ===========================================
// KB Writer Class
// ===========================================

export class KBWriter {
  private readonly config: KBWriterConfig;
  private readonly qdrantClient: LearningLoopQdrantClient;
  private readonly stateManager: LearningLoopStateManager;

  constructor(
    qdrantClient: LearningLoopQdrantClient,
    stateManager: LearningLoopStateManager,
    config?: Partial<KBWriterConfig>
  ) {
    this.config = { ...DEFAULT_KB_WRITER_CONFIG, ...config };
    this.qdrantClient = qdrantClient;
    this.stateManager = stateManager;
  }

  // ===========================================
  // Write Operations
  // ===========================================

  /**
   * Write an insight to the knowledge base.
   */
  async write(insight: ExtractedInsight, options: WriteOptions = {}): Promise<KBWriteResult> {
    const logger = getLogger();
    const startTime = Date.now();

    logger.debug('Writing insight to KB', {
      insight_id: insight.id,
      category: insight.category,
      brain_id: insight.brain_id,
    });

    try {
      // Check for duplicates unless skipped
      if (!options.skipDuplicateCheck) {
        const duplicateCheck = await this.qdrantClient.checkDuplicateByContent(
          insight.brain_id,
          insight.content
        );

        if (duplicateCheck.isDuplicate) {
          logger.info('Duplicate insight detected, skipping write', {
            insight_id: insight.id,
            similar_id: duplicateCheck.similarId,
            similarity: duplicateCheck.similarity,
          });

          return {
            success: false,
            insight_id: insight.id,
            qdrant_id: '',
            error: `Duplicate of ${duplicateCheck.similarId}`,
          };
        }
      }

      // Create InsightValidation object
      const validation: InsightValidation = {
        status: options.validationStatus ?? 'auto_approved',
        validated_by: options.validatorId ?? null,
        validation_date: new Date().toISOString(),
        validation_note: null,
      };

      // Prepare payload for storage
      const vertical = options.vertical ?? 'default';
      const payloadData = prepareInsightForStorage(insight, validation, vertical);

      // Add timestamps for full StoredInsightPayload
      const now = new Date().toISOString();
      const payload: StoredInsightPayload = {
        ...payloadData,
        created_at: now,
        updated_at: now,
      };

      // Write to Qdrant with retry
      const writeResult = await this.writeWithRetry(insight, payload);

      if (!writeResult.success) {
        throw new Error(writeResult.error ?? 'Write failed');
      }

      // Generate a content key for duplicate tracking
      const contentKey = this.generateContentKey(insight.content, insight.category);

      // Update state manager
      this.stateManager.recordKBWrite();
      this.stateManager.addRecentInsight({
        insight_id: insight.id,
        content_hash: contentKey,
        category: insight.category,
        created_at: now,
      });

      const durationMs = Date.now() - startTime;
      logger.info('Insight written to KB', {
        insight_id: insight.id,
        qdrant_id: writeResult.pointId,
        duration_ms: durationMs,
      });

      return {
        success: true,
        insight_id: insight.id,
        qdrant_id: writeResult.pointId ?? '',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startTime;

      logger.error('Failed to write insight to KB', {
        insight_id: insight.id,
        error: errorMessage,
        duration_ms: durationMs,
      });

      return {
        success: false,
        insight_id: insight.id,
        qdrant_id: '',
        error: errorMessage,
      };
    }
  }

  /**
   * Generate a content key for duplicate tracking.
   */
  private generateContentKey(content: string, category: string): string {
    const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
    return `${category}:${normalized.slice(0, 100)}`;
  }

  /**
   * Write with retry logic.
   */
  private async writeWithRetry(
    insight: ExtractedInsight,
    payload: StoredInsightPayload
  ): Promise<WriteResult> {
    const logger = getLogger();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Use writeInsightWithContent which generates embedding internally
        const result = await this.qdrantClient.writeInsightWithContent(
          insight.brain_id,
          payload
        );

        if (result.success) {
          return result;
        }

        lastError = new Error(result.error ?? 'Write failed');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      if (attempt < this.config.maxRetries) {
        const delay = this.config.retryDelayMs * attempt;
        logger.debug('Retrying KB write', {
          insight_id: insight.id,
          attempt,
          delay_ms: delay,
        });
        await this.delay(delay);
      }
    }

    return {
      success: false,
      pointId: '',
      error: lastError?.message ?? 'Max retries exceeded',
    };
  }

  /**
   * Write multiple insights in batch.
   */
  async writeBatch(
    insights: ExtractedInsight[],
    options: WriteOptions = {}
  ): Promise<Map<string, KBWriteResult>> {
    const logger = getLogger();
    const results = new Map<string, KBWriteResult>();

    logger.info('Writing batch of insights to KB', {
      count: insights.length,
    });

    for (const insight of insights) {
      const result = await this.write(insight, options);
      results.set(insight.id, result);
    }

    const successCount = Array.from(results.values()).filter(r => r.success).length;
    logger.info('Batch write complete', {
      total: insights.length,
      success: successCount,
      failed: insights.length - successCount,
    });

    return results;
  }

  // ===========================================
  // Auto-Approved Insights
  // ===========================================

  /**
   * Write an auto-approved insight.
   */
  async writeAutoApproved(insight: ExtractedInsight): Promise<KBWriteResult> {
    this.stateManager.recordAutoApproval();

    return this.write(insight, {
      validationStatus: 'auto_approved',
      skipDuplicateCheck: false,
    });
  }

  /**
   * Write a human-validated insight.
   */
  async writeValidated(
    insight: ExtractedInsight,
    validatorId: string
  ): Promise<KBWriteResult> {
    return this.write(insight, {
      validationStatus: 'validated',
      validatorId,
      skipDuplicateCheck: true, // Already checked during validation
    });
  }

  // ===========================================
  // Update Operations
  // ===========================================

  /**
   * Update application stats for an insight (FR-021).
   * Uses the qdrantClient.updateApplicationStats method.
   */
  async updateApplicationStats(
    pointId: string,
    stats: {
      applied_count: number;
      success_rate: number;
      last_applied_at: string;
    }
  ): Promise<boolean> {
    const logger = getLogger();

    try {
      const success = await this.qdrantClient.updateApplicationStats(pointId, stats);

      if (success) {
        logger.info('Application stats updated', {
          point_id: pointId,
          stats,
        });
      }

      return success;
    } catch (error) {
      logger.error('Failed to update application stats', {
        point_id: pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ===========================================
  // Archive Operations
  // ===========================================

  /**
   * Archive an insight by its Qdrant point ID.
   */
  async archiveInsight(pointId: string): Promise<boolean> {
    const logger = getLogger();

    try {
      const success = await this.qdrantClient.archiveInsight(pointId);

      if (success) {
        logger.info('Insight archived', { point_id: pointId });
      }

      return success;
    } catch (error) {
      logger.error('Failed to archive insight', {
        point_id: pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ===========================================
  // Utilities
  // ===========================================

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a KBWriter instance.
 */
export function createKBWriter(
  qdrantClient: LearningLoopQdrantClient,
  stateManager: LearningLoopStateManager,
  config?: Partial<KBWriterConfig>
): KBWriter {
  return new KBWriter(qdrantClient, stateManager, config);
}
