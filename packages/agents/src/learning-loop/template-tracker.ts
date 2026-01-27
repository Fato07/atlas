/**
 * Learning Loop Template Tracker
 *
 * Tracks template performance for A/B optimization:
 * 1. Record template usage (FR-027)
 * 2. Track outcomes (FR-028)
 * 3. Calculate success rates (FR-029)
 * 4. Monitor for declining performance (FR-030)
 * 5. Support A/B testing (FR-031)
 *
 * @module learning-loop/template-tracker
 */

import type {
  TemplatePerformance,
  TemplateOutcome,
  TemplateUsageEvent,
  TemplateOutcomeEvent,
  ABComparison,
} from './contracts';
import {
  createTemplatePerformance,
  recordTemplateUsage,
  recordTemplateOutcome,
  calculateABComparison,
  updateABComparison,
} from './contracts';
import type { LearningLoopRedisClient } from './redis-client';
import type { LearningLoopSlackClient } from './slack-client';
import { getLogger } from './logger';

// ===========================================
// Local Declining Alert Type
// ===========================================

/**
 * Alert for declining template performance.
 * Compatible with DecliningAlert contract but uses different field names
 * for runtime rate comparison.
 */
interface LocalDecliningAlert {
  current_rate: number;
  previous_rate: number;
  decline_amount: number;
}

/**
 * Check if performance has declined below threshold.
 */
function checkDecliningPerformance(
  performance: TemplatePerformance,
  previousRate: number,
  threshold: number
): LocalDecliningAlert | null {
  const decline = previousRate - performance.success_rate;

  if (decline >= threshold) {
    return {
      current_rate: performance.success_rate,
      previous_rate: previousRate,
      decline_amount: decline,
    };
  }

  return null;
}

// ===========================================
// Types
// ===========================================

export interface TemplateTrackerConfig {
  /** Minimum uses before calculating stats */
  minUsesForStats: number;
  /** Minimum uses for A/B significance */
  minUsesForAB: number;
  /** Success rate decline threshold for alerts */
  declineThreshold: number;
  /** Window size for decline comparison (days) */
  declineWindowDays: number;
}

export const DEFAULT_TEMPLATE_TRACKER_CONFIG: TemplateTrackerConfig = {
  minUsesForStats: 5,
  minUsesForAB: 10,
  declineThreshold: 0.2,
  declineWindowDays: 7,
};

export interface UsageResult {
  success: boolean;
  templateId: string;
  timesUsed: number;
  error?: string;
}

export interface OutcomeResult {
  success: boolean;
  templateId: string;
  outcome: TemplateOutcome;
  newSuccessRate: number;
  timesUsed: number;
  error?: string;
}

export interface ABResult {
  templateA: string;
  templateB: string;
  comparison: ABComparison;
  recommendation: 'a' | 'b' | 'continue' | 'inconclusive';
}

// ===========================================
// Template Tracker Class
// ===========================================

export class TemplateTracker {
  private readonly config: TemplateTrackerConfig;
  private readonly redisClient: LearningLoopRedisClient;
  private readonly slackClient: LearningLoopSlackClient;

  constructor(
    redisClient: LearningLoopRedisClient,
    slackClient: LearningLoopSlackClient,
    config?: Partial<TemplateTrackerConfig>
  ) {
    this.config = { ...DEFAULT_TEMPLATE_TRACKER_CONFIG, ...config };
    this.redisClient = redisClient;
    this.slackClient = slackClient;
  }

  // ===========================================
  // Usage Tracking
  // ===========================================

  /**
   * Record template usage (FR-027).
   */
  async recordUsage(
    brainId: string,
    templateId: string,
    metadata?: {
      leadId?: string;
      campaignId?: string;
      abGroup?: string;
      variant?: string;
    }
  ): Promise<UsageResult> {
    const logger = getLogger();

    try {
      // Get or create performance record
      let performance = await this.redisClient.getTemplatePerformance(brainId, templateId);

      if (!performance) {
        performance = createTemplatePerformance(templateId, brainId);
        if (metadata?.abGroup) {
          performance.ab_group = metadata.abGroup;
          performance.variant = metadata.variant ?? null;
        }
      }

      // Record usage
      performance = recordTemplateUsage(performance);

      // Save
      await this.redisClient.setTemplatePerformance(brainId, templateId, performance);

      logger.info('Template usage recorded', {
        brain_id: brainId,
        template_id: templateId,
        times_used: performance.times_used,
      });

      return {
        success: true,
        templateId,
        timesUsed: performance.times_used,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to record template usage', {
        brain_id: brainId,
        template_id: templateId,
        error: errorMessage,
      });

      return {
        success: false,
        templateId,
        timesUsed: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Record template outcome (FR-028).
   */
  async recordOutcome(
    brainId: string,
    templateId: string,
    outcome: TemplateOutcome
  ): Promise<OutcomeResult> {
    const logger = getLogger();

    try {
      // Get performance record
      let performance = await this.redisClient.getTemplatePerformance(brainId, templateId);

      if (!performance) {
        // Create new record with usage = 1
        performance = createTemplatePerformance(templateId, brainId);
        performance = recordTemplateUsage(performance);
      }

      // Record outcome
      const previousRate = performance.success_rate;
      performance = recordTemplateOutcome(performance, outcome);

      // Save
      await this.redisClient.setTemplatePerformance(brainId, templateId, performance);

      // Check for declining performance (FR-030)
      if (performance.times_used >= this.config.minUsesForStats) {
        const alert = checkDecliningPerformance(
          performance,
          previousRate,
          this.config.declineThreshold
        );

        if (alert) {
          await this.handleDecliningPerformance(brainId, templateId, alert);
        }
      }

      logger.info('Template outcome recorded', {
        brain_id: brainId,
        template_id: templateId,
        outcome,
        success_rate: performance.success_rate,
      });

      return {
        success: true,
        templateId,
        outcome,
        newSuccessRate: performance.success_rate,
        timesUsed: performance.times_used,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to record template outcome', {
        brain_id: brainId,
        template_id: templateId,
        outcome,
        error: errorMessage,
      });

      return {
        success: false,
        templateId,
        outcome,
        newSuccessRate: 0,
        timesUsed: 0,
        error: errorMessage,
      };
    }
  }

  // ===========================================
  // A/B Testing (FR-031)
  // ===========================================

  /**
   * Setup A/B test for templates.
   */
  async setupABTest(
    brainId: string,
    templateAId: string,
    templateBId: string,
    testName: string
  ): Promise<boolean> {
    const logger = getLogger();

    try {
      // Get or create both templates
      let performanceA = await this.redisClient.getTemplatePerformance(brainId, templateAId);
      let performanceB = await this.redisClient.getTemplatePerformance(brainId, templateBId);

      if (!performanceA) {
        performanceA = createTemplatePerformance(templateAId, brainId);
      }
      if (!performanceB) {
        performanceB = createTemplatePerformance(templateBId, brainId);
      }

      // Set A/B group
      performanceA.ab_group = testName;
      performanceA.variant = 'A';
      performanceB.ab_group = testName;
      performanceB.variant = 'B';

      // Save
      await Promise.all([
        this.redisClient.setTemplatePerformance(brainId, templateAId, performanceA),
        this.redisClient.setTemplatePerformance(brainId, templateBId, performanceB),
      ]);

      logger.info('A/B test setup', {
        brain_id: brainId,
        test_name: testName,
        template_a: templateAId,
        template_b: templateBId,
      });

      return true;
    } catch (error) {
      logger.error('Failed to setup A/B test', {
        brain_id: brainId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get A/B test comparison.
   */
  async getABComparison(
    brainId: string,
    templateAId: string,
    templateBId: string
  ): Promise<ABResult | null> {
    const logger = getLogger();

    try {
      const [performanceA, performanceB] = await Promise.all([
        this.redisClient.getTemplatePerformance(brainId, templateAId),
        this.redisClient.getTemplatePerformance(brainId, templateBId),
      ]);

      if (!performanceA || !performanceB) {
        return null;
      }

      // Calculate comparison for both templates in the same group
      const groupPerformances = [performanceA, performanceB];
      const comparisonA = calculateABComparison(performanceA, groupPerformances);

      // Determine recommendation based on rank and group average
      let recommendation: ABResult['recommendation'] = 'inconclusive';

      if (
        performanceA.times_used >= this.config.minUsesForAB &&
        performanceB.times_used >= this.config.minUsesForAB
      ) {
        // Use vs_group_average to determine significance
        const diff = Math.abs(performanceA.success_rate - performanceB.success_rate);
        const isSignificant = diff >= 0.1; // 10% difference threshold

        if (isSignificant) {
          recommendation = performanceA.success_rate > performanceB.success_rate ? 'a' : 'b';
        } else {
          recommendation = 'continue';
        }
      }

      return {
        templateA: templateAId,
        templateB: templateBId,
        comparison: comparisonA,
        recommendation,
      };
    } catch (error) {
      logger.error('Failed to get A/B comparison', {
        brain_id: brainId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // ===========================================
  // Performance Monitoring
  // ===========================================

  /**
   * Handle declining performance alert (FR-030).
   */
  private async handleDecliningPerformance(
    brainId: string,
    templateId: string,
    alert: LocalDecliningAlert
  ): Promise<void> {
    const logger = getLogger();

    logger.warn('Template performance declining', {
      brain_id: brainId,
      template_id: templateId,
      current_rate: alert.current_rate,
      previous_rate: alert.previous_rate,
      decline: alert.decline_amount,
    });

    // Send Slack alert
    await this.slackClient.sendDecliningTemplateAlert(
      brainId,
      templateId,
      templateId, // Would fetch actual name
      alert.current_rate,
      alert.previous_rate
    );
  }

  /**
   * Get all declining templates.
   */
  async getDecliningTemplates(brainId: string): Promise<TemplatePerformance[]> {
    return this.redisClient.getDecliningTemplates(brainId, this.config.declineThreshold);
  }

  /**
   * Get top performing templates.
   */
  async getTopTemplates(brainId: string, limit: number = 5): Promise<TemplatePerformance[]> {
    const all = await this.redisClient.getAllTemplatePerformances(brainId);

    // Filter to templates with sufficient usage
    const qualified = all.filter(p => p.times_used >= this.config.minUsesForStats);

    // Sort by success rate
    return qualified
      .sort((a, b) => b.success_rate - a.success_rate)
      .slice(0, limit);
  }

  /**
   * Get template performance.
   */
  async getPerformance(
    brainId: string,
    templateId: string
  ): Promise<TemplatePerformance | null> {
    return this.redisClient.getTemplatePerformance(brainId, templateId);
  }

  /**
   * Get all template performances.
   */
  async getAllPerformances(brainId: string): Promise<TemplatePerformance[]> {
    return this.redisClient.getAllTemplatePerformances(brainId);
  }

  // ===========================================
  // Statistics
  // ===========================================

  /**
   * Get aggregate statistics for all templates.
   */
  async getAggregateStats(brainId: string): Promise<{
    totalTemplates: number;
    totalUsage: number;
    avgSuccessRate: number;
    topTemplate: string | null;
    bottomTemplate: string | null;
    activeABTests: number;
  }> {
    const all = await this.redisClient.getAllTemplatePerformances(brainId);

    if (all.length === 0) {
      return {
        totalTemplates: 0,
        totalUsage: 0,
        avgSuccessRate: 0,
        topTemplate: null,
        bottomTemplate: null,
        activeABTests: 0,
      };
    }

    const qualified = all.filter(p => p.times_used >= this.config.minUsesForStats);
    const totalUsage = all.reduce((sum, p) => sum + p.times_used, 0);
    const avgSuccessRate = qualified.length > 0
      ? qualified.reduce((sum, p) => sum + p.success_rate, 0) / qualified.length
      : 0;

    const sorted = qualified.sort((a, b) => b.success_rate - a.success_rate);
    const abTests = new Set(all.filter(p => p.ab_group).map(p => p.ab_group));

    return {
      totalTemplates: all.length,
      totalUsage,
      avgSuccessRate,
      topTemplate: sorted[0]?.template_id ?? null,
      bottomTemplate: sorted[sorted.length - 1]?.template_id ?? null,
      activeABTests: abTests.size,
    };
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a TemplateTracker instance.
 */
export function createTemplateTracker(
  redisClient: LearningLoopRedisClient,
  slackClient: LearningLoopSlackClient,
  config?: Partial<TemplateTrackerConfig>
): TemplateTracker {
  return new TemplateTracker(redisClient, slackClient, config);
}
