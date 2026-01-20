/**
 * Learning Loop Validation Queue
 *
 * Manages the human validation workflow for insights:
 * 1. Queue insights for validation (FR-011)
 * 2. Send Slack notifications (FR-012, FR-013)
 * 3. Track reminders (FR-014, FR-015)
 * 4. Handle validation callbacks (FR-016, FR-017)
 *
 * @module learning-loop/validation-queue
 */

import type {
  ExtractedInsight,
  ValidationItem,
  ValidationDecision,
  InsightSummary,
  SlackInteractionPayload,
} from './contracts';
import { createValidationItem, applyValidationDecision, shouldSendReminder, recordReminderSent } from './contracts';
import type { LearningLoopRedisClient } from './redis-client';
import type { LearningLoopSlackClient, SlackMessageResult } from './slack-client';
import type { LearningLoopStateManager } from './state';
import { getLogger } from './logger';

// ===========================================
// Types
// ===========================================

export interface ValidationQueueConfig {
  /** Hours before sending reminder */
  reminderHours: number;
  /** Maximum reminders to send */
  maxReminders: number;
  /** Hours before auto-expiring unvalidated items */
  expirationHours: number;
  /** Slack channel for validations */
  validationChannel: string;
}

export const DEFAULT_VALIDATION_QUEUE_CONFIG: ValidationQueueConfig = {
  reminderHours: 48,
  maxReminders: 2,
  expirationHours: 72,
  validationChannel: 'learning-loop-validations',
};

export interface QueueResult {
  success: boolean;
  validationId: string;
  slackMessageTs?: string;
  error?: string;
}

export interface ValidationResult {
  success: boolean;
  validationId: string;
  decision: 'approved' | 'rejected';
  validator: string;
  insightId: string;
  error?: string;
}

// ===========================================
// Validation Queue Class
// ===========================================

export class ValidationQueue {
  private readonly config: ValidationQueueConfig;
  private readonly redisClient: LearningLoopRedisClient;
  private readonly slackClient: LearningLoopSlackClient;
  private readonly stateManager: LearningLoopStateManager;

  constructor(
    redisClient: LearningLoopRedisClient,
    slackClient: LearningLoopSlackClient,
    stateManager: LearningLoopStateManager,
    config?: Partial<ValidationQueueConfig>
  ) {
    this.config = { ...DEFAULT_VALIDATION_QUEUE_CONFIG, ...config };
    this.redisClient = redisClient;
    this.slackClient = slackClient;
    this.stateManager = stateManager;
  }

  // ===========================================
  // Queue Operations
  // ===========================================

  /**
   * Queue an insight for human validation (FR-011).
   */
  async queueForValidation(insight: ExtractedInsight): Promise<QueueResult> {
    const logger = getLogger();

    try {
      // Create insight summary for Slack display
      const summary: InsightSummary = {
        id: insight.id,
        category: insight.category,
        content: insight.content,
        importance: insight.importance,
        confidence: insight.initial_confidence,
        extracted_quote: insight.extracted_quote,
        source_type: insight.source.type,
        company_name: insight.source.company_name,
      };

      // Create validation item (placeholder values for Slack, will be updated after sending)
      const validationItem = createValidationItem({
        insightId: insight.id,
        brainId: insight.brain_id,
        insightSummary: summary,
        slackChannelId: this.config.validationChannel,
        slackMessageTs: '', // Will be updated after Slack message is sent
      });

      // Store in Redis
      await this.redisClient.setValidationItem(validationItem);

      // Track in state manager
      this.stateManager.addPendingValidation({
        validation_id: validationItem.id,
        insight_id: insight.id,
        brain_id: insight.brain_id,
      });

      // Send Slack notification (FR-012, FR-013)
      const slackResult = await this.slackClient.sendValidationRequest(validationItem);

      if (!slackResult.success) {
        logger.warn('Failed to send Slack notification, validation still queued', {
          validation_id: validationItem.id,
          error: slackResult.error,
        });
      } else if (slackResult.ts && slackResult.channel) {
        // Update with Slack message info
        validationItem.slack.message_ts = slackResult.ts;
        validationItem.slack.channel_id = slackResult.channel;
        await this.redisClient.updateValidationItem(validationItem);
      }

      logger.info('Insight queued for validation', {
        validation_id: validationItem.id,
        insight_id: insight.id,
        brain_id: insight.brain_id,
        slack_sent: slackResult.success,
      });

      return {
        success: true,
        validationId: validationItem.id,
        slackMessageTs: slackResult.ts,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to queue insight for validation', {
        insight_id: insight.id,
        error: errorMessage,
      });

      return {
        success: false,
        validationId: '',
        error: errorMessage,
      };
    }
  }

  /**
   * Handle validation callback from Slack (FR-016, FR-017).
   */
  async handleValidationCallback(
    validationId: string,
    decision: 'approved' | 'rejected',
    validator: string,
    feedback?: string
  ): Promise<ValidationResult> {
    const logger = getLogger();

    try {
      // Get validation item from Redis
      const validationItem = await this.redisClient.getValidationItem(validationId);

      if (!validationItem) {
        logger.warn('Validation item not found', { validation_id: validationId });
        return {
          success: false,
          validationId,
          decision,
          validator,
          insightId: '',
          error: 'Validation item not found or expired',
        };
      }

      // Apply decision using the helper function
      const updatedItem = applyValidationDecision(
        validationItem,
        decision,
        validator,
        validator, // Use validator as both ID and name for now
        feedback
      );

      // Update Redis (will be removed shortly, but good for audit trail)
      await this.redisClient.updateValidationItem(updatedItem);

      // Remove from pending
      await this.redisClient.deleteValidationItem(validationId, validationItem.brain_id);

      // Update state manager
      this.stateManager.completeValidation(validationId, decision === 'approved');

      // Update Slack message
      if (validationItem.slack.message_ts && validationItem.slack.channel_id) {
        await this.slackClient.updateValidationProcessed(
          validationItem.slack.channel_id,
          validationItem.slack.message_ts,
          decision,
          validator,
          validationItem
        );
      }

      logger.info('Validation completed', {
        validation_id: validationId,
        insight_id: validationItem.insight_id,
        decision,
        validator,
      });

      return {
        success: true,
        validationId,
        decision,
        validator,
        insightId: validationItem.insight_id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to process validation callback', {
        validation_id: validationId,
        error: errorMessage,
      });

      return {
        success: false,
        validationId,
        decision,
        validator,
        insightId: '',
        error: errorMessage,
      };
    }
  }

  /**
   * Parse Slack interaction payload and handle validation.
   */
  async handleSlackInteraction(payload: SlackInteractionPayload): Promise<ValidationResult> {
    const logger = getLogger();

    // Extract action details
    const action = payload.actions[0];
    if (!action) {
      return {
        success: false,
        validationId: '',
        decision: 'rejected',
        validator: payload.user.id,
        insightId: '',
        error: 'No action in payload',
      };
    }

    // Parse action_id to determine decision
    const decision: 'approved' | 'rejected' =
      action.action_id === 'insight_approve' ? 'approved' : 'rejected';

    // The value contains the validation ID
    const validationId = action.value;

    logger.debug('Processing Slack interaction', {
      validation_id: validationId,
      action_id: action.action_id,
      user_id: payload.user.id,
    });

    return this.handleValidationCallback(
      validationId,
      decision,
      payload.user.id
    );
  }

  // ===========================================
  // Reminder Operations
  // ===========================================

  /**
   * Check and send reminders for pending validations (FR-014, FR-015).
   */
  async processReminders(brainId: string): Promise<number> {
    const logger = getLogger();
    let remindersSent = 0;

    try {
      // Get pending validations from Redis
      const pendingItems = await this.redisClient.getPendingValidations(brainId);

      for (const item of pendingItems) {
        // Check if reminder is needed (uses contract's built-in 48hr/2 reminder thresholds)
        if (shouldSendReminder(item)) {
          // Send reminder
          const result = await this.slackClient.sendValidationReminder(
            item,
            item.reminders.count + 1
          );

          if (result.success) {
            // Update reminder tracking
            const updatedItem = recordReminderSent(item);
            await this.redisClient.updateValidationItem(updatedItem);
            this.stateManager.recordReminderSent(item.id);
            remindersSent++;

            logger.info('Validation reminder sent', {
              validation_id: item.id,
              reminder_number: updatedItem.reminders.count,
            });
          } else {
            logger.warn('Failed to send reminder', {
              validation_id: item.id,
              error: result.error,
            });
          }
        }
      }

      return remindersSent;
    } catch (error) {
      logger.error('Failed to process reminders', {
        brain_id: brainId,
        error: error instanceof Error ? error.message : String(error),
      });
      return remindersSent;
    }
  }

  /**
   * Expire old validations that have exceeded the expiration window.
   */
  async expireOldValidations(brainId: string): Promise<number> {
    const logger = getLogger();
    const now = Date.now();
    const expirationMs = this.config.expirationHours * 60 * 60 * 1000;
    let expiredCount = 0;

    try {
      const pendingItems = await this.redisClient.getPendingValidations(brainId);

      for (const item of pendingItems) {
        const createdAt = new Date(item.created_at).getTime();
        if (now - createdAt > expirationMs) {
          // Expire the item (treat as rejected)
          await this.handleValidationCallback(
            item.id,
            'rejected',
            'system',
            'Auto-expired after timeout'
          );
          expiredCount++;

          logger.info('Validation expired', {
            validation_id: item.id,
            insight_id: item.insight_id,
            age_hours: Math.round((now - createdAt) / (60 * 60 * 1000)),
          });
        }
      }

      return expiredCount;
    } catch (error) {
      logger.error('Failed to expire old validations', {
        brain_id: brainId,
        error: error instanceof Error ? error.message : String(error),
      });
      return expiredCount;
    }
  }

  // ===========================================
  // Query Operations
  // ===========================================

  /**
   * Get pending validation count for a brain.
   */
  async getPendingCount(brainId: string): Promise<number> {
    return this.redisClient.getPendingValidationCount(brainId);
  }

  /**
   * Get all pending validations for a brain.
   */
  async getPendingValidations(brainId: string): Promise<ValidationItem[]> {
    return this.redisClient.getPendingValidations(brainId);
  }

  /**
   * Get a specific validation item.
   */
  async getValidation(validationId: string): Promise<ValidationItem | null> {
    return this.redisClient.getValidationItem(validationId);
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a ValidationQueue instance.
 */
export function createValidationQueue(
  redisClient: LearningLoopRedisClient,
  slackClient: LearningLoopSlackClient,
  stateManager: LearningLoopStateManager,
  config?: Partial<ValidationQueueConfig>
): ValidationQueue {
  return new ValidationQueue(redisClient, slackClient, stateManager, config);
}
