/**
 * Learning Loop Validation Queue Tests
 *
 * Tests for FR-011 through FR-017:
 * - FR-011: Queue insights for validation
 * - FR-012, FR-013: Send Slack notifications
 * - FR-014, FR-015: Track reminders
 * - FR-016, FR-017: Handle validation callbacks
 *
 * @module __tests__/learning-loop/validation-queue.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ValidationQueue,
  createValidationQueue,
  DEFAULT_VALIDATION_QUEUE_CONFIG,
} from '../../learning-loop/validation-queue';
import type { ValidationItem, SlackInteractionPayload } from '../../learning-loop/contracts';
import {
  createTestInsight,
  createTestValidationItem,
  TEST_BRAIN_ID,
} from './fixtures';
import {
  createMockRedisClient,
  createMockSlackClient,
  createMockStateManager,
} from './fixtures/mock-clients';

// Create a mock Redis client for validation queue
function createMockValidationRedisClient() {
  const validationStore = new Map<string, ValidationItem>();
  const _setValidationCalls: ValidationItem[] = [];
  const _updateValidationCalls: ValidationItem[] = [];
  const _deleteValidationCalls: Array<{ id: string; brainId: string }> = [];

  return {
    setValidationItem: vi.fn(async (item: ValidationItem) => {
      validationStore.set(item.id, item);
      _setValidationCalls.push(item);
    }),

    getValidationItem: vi.fn(async (id: string): Promise<ValidationItem | null> => {
      return validationStore.get(id) ?? null;
    }),

    updateValidationItem: vi.fn(async (item: ValidationItem) => {
      validationStore.set(item.id, item);
      _updateValidationCalls.push(item);
    }),

    deleteValidationItem: vi.fn(async (id: string, brainId: string) => {
      validationStore.delete(id);
      _deleteValidationCalls.push({ id, brainId });
    }),

    getPendingValidations: vi.fn(async (brainId: string): Promise<ValidationItem[]> => {
      return Array.from(validationStore.values()).filter(
        item => item.brain_id === brainId && item.status === 'pending'
      );
    }),

    getPendingValidationCount: vi.fn(async (brainId: string): Promise<number> => {
      return Array.from(validationStore.values()).filter(
        item => item.brain_id === brainId && item.status === 'pending'
      ).length;
    }),

    // Test helpers
    _store: validationStore,
    _setValidationCalls,
    _updateValidationCalls,
    _deleteValidationCalls,
    _addTestItem: (item: ValidationItem) => {
      validationStore.set(item.id, item);
    },
    _reset: () => {
      validationStore.clear();
      _setValidationCalls.length = 0;
      _updateValidationCalls.length = 0;
      _deleteValidationCalls.length = 0;
    },
  };
}

// Create a mock Slack client for validation queue
function createMockValidationSlackClient() {
  const _sendValidationCalls: ValidationItem[] = [];
  const _sendReminderCalls: Array<{ item: ValidationItem; reminderNumber: number }> = [];
  const _updateValidationCalls: Array<{
    channelId: string;
    messageTs: string;
    decision: 'approved' | 'rejected';
    validator: string;
  }> = [];

  return {
    sendValidationRequest: vi.fn(async (item: ValidationItem) => {
      _sendValidationCalls.push(item);
      return {
        success: true,
        ts: `${Date.now()}.123456`,
        channel: item.slack.channel_id || 'learning-loop-validations',
      };
    }),

    sendValidationReminder: vi.fn(async (item: ValidationItem, reminderNumber: number) => {
      _sendReminderCalls.push({ item, reminderNumber });
      return {
        success: true,
        ts: `${Date.now()}.654321`,
        channel: item.slack.channel_id,
      };
    }),

    updateValidationProcessed: vi.fn(async (
      channelId: string,
      messageTs: string,
      decision: 'approved' | 'rejected',
      validator: string,
      _item: ValidationItem
    ) => {
      _updateValidationCalls.push({ channelId, messageTs, decision, validator });
      return { success: true };
    }),

    // Test helpers
    _sendValidationCalls,
    _sendReminderCalls,
    _updateValidationCalls,
    _reset: () => {
      _sendValidationCalls.length = 0;
      _sendReminderCalls.length = 0;
      _updateValidationCalls.length = 0;
    },
  };
}

describe('ValidationQueue', () => {
  let validationQueue: ValidationQueue;
  let mockRedis: ReturnType<typeof createMockValidationRedisClient>;
  let mockSlack: ReturnType<typeof createMockValidationSlackClient>;
  let mockStateManager: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    mockRedis = createMockValidationRedisClient();
    mockSlack = createMockValidationSlackClient();
    mockStateManager = createMockStateManager({ brainId: TEST_BRAIN_ID });

    validationQueue = createValidationQueue(
      mockRedis as any,
      mockSlack as any,
      mockStateManager,
      {
        reminderHours: 48,
        maxReminders: 2,
        expirationHours: 72,
        validationChannel: 'test-validations',
      }
    );
  });

  // ===========================================
  // Queue for Validation Tests (FR-011)
  // ===========================================

  describe('Queue for Validation (FR-011)', () => {
    it('should queue an insight for validation', async () => {
      const insight = createTestInsight({
        brain_id: TEST_BRAIN_ID,
        category: 'objection',
        content: 'Budget constraints mentioned',
      });

      const result = await validationQueue.queueForValidation(insight);

      expect(result.success).toBe(true);
      expect(result.validationId).toBeDefined();
      expect(result.slackMessageTs).toBeDefined();
    });

    it('should store validation item in Redis', async () => {
      const insight = createTestInsight({
        brain_id: TEST_BRAIN_ID,
      });

      await validationQueue.queueForValidation(insight);

      expect(mockRedis.setValidationItem).toHaveBeenCalled();
      const storedItem = mockRedis._setValidationCalls[0];
      expect(storedItem.insight_id).toBe(insight.id);
      expect(storedItem.brain_id).toBe(TEST_BRAIN_ID);
    });

    it('should track in state manager', async () => {
      const insight = createTestInsight({
        brain_id: TEST_BRAIN_ID,
      });

      await validationQueue.queueForValidation(insight);

      expect(mockStateManager.addPendingValidation).toHaveBeenCalledWith(
        expect.objectContaining({
          insight_id: insight.id,
          brain_id: TEST_BRAIN_ID,
        })
      );
    });

    it('should handle Redis failure gracefully', async () => {
      mockRedis.setValidationItem = vi.fn().mockRejectedValue(new Error('Redis unavailable'));

      const insight = createTestInsight();
      const result = await validationQueue.queueForValidation(insight);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Redis unavailable');
    });
  });

  // ===========================================
  // Slack Notification Tests (FR-012, FR-013)
  // ===========================================

  describe('Slack Notifications (FR-012, FR-013)', () => {
    it('should send Slack notification when queuing', async () => {
      const insight = createTestInsight({
        brain_id: TEST_BRAIN_ID,
      });

      await validationQueue.queueForValidation(insight);

      expect(mockSlack.sendValidationRequest).toHaveBeenCalled();
    });

    it('should include insight summary in Slack message', async () => {
      const insight = createTestInsight({
        category: 'pain_point',
        content: 'Manual data entry taking 2+ hours daily',
        importance: 'high',
        initial_confidence: 0.85,
        source: {
          type: 'email_reply',
          source_id: 'email_123',
          lead_id: 'lead_456',
          company_id: 'company_789',
          company_name: 'Test Corp',
          conversation_context: null,
          extracted_quote: 'We spend hours on this',
        },
      });

      await validationQueue.queueForValidation(insight);

      const sentItem = mockSlack._sendValidationCalls[0];
      expect(sentItem.insight_summary.category).toBe('pain_point');
      expect(sentItem.insight_summary.importance).toBe('high');
      expect(sentItem.insight_summary.company_name).toBe('Test Corp');
    });

    it('should update validation item with Slack message ts', async () => {
      const insight = createTestInsight();

      await validationQueue.queueForValidation(insight);

      expect(mockRedis.updateValidationItem).toHaveBeenCalled();
      const updatedItem = mockRedis._updateValidationCalls[0];
      expect(updatedItem.slack.message_ts).toBeDefined();
    });

    it('should still queue insight if Slack notification fails', async () => {
      mockSlack.sendValidationRequest = vi.fn().mockResolvedValue({
        success: false,
        error: 'Slack API error',
      });

      const insight = createTestInsight();
      const result = await validationQueue.queueForValidation(insight);

      // Should still succeed, just without Slack message
      expect(result.success).toBe(true);
      expect(result.slackMessageTs).toBeUndefined();
    });
  });

  // ===========================================
  // Validation Callback Tests (FR-016, FR-017)
  // ===========================================

  describe('Validation Callbacks (FR-016, FR-017)', () => {
    it('should handle approve callback', async () => {
      // First queue an insight
      const insight = createTestInsight();
      const queueResult = await validationQueue.queueForValidation(insight);

      // Then approve it
      const result = await validationQueue.handleValidationCallback(
        queueResult.validationId,
        'approved',
        'U123456'
      );

      expect(result.success).toBe(true);
      expect(result.decision).toBe('approved');
      expect(result.validator).toBe('U123456');
      expect(result.insightId).toBe(insight.id);
    });

    it('should handle reject callback', async () => {
      const insight = createTestInsight();
      const queueResult = await validationQueue.queueForValidation(insight);

      const result = await validationQueue.handleValidationCallback(
        queueResult.validationId,
        'rejected',
        'U123456',
        'Not relevant to our ICP'
      );

      expect(result.success).toBe(true);
      expect(result.decision).toBe('rejected');
    });

    it('should delete validation item from Redis after callback', async () => {
      const insight = createTestInsight();
      const queueResult = await validationQueue.queueForValidation(insight);

      await validationQueue.handleValidationCallback(
        queueResult.validationId,
        'approved',
        'U123456'
      );

      expect(mockRedis.deleteValidationItem).toHaveBeenCalledWith(
        queueResult.validationId,
        expect.any(String)
      );
    });

    it('should update state manager on completion', async () => {
      const insight = createTestInsight();
      const queueResult = await validationQueue.queueForValidation(insight);

      await validationQueue.handleValidationCallback(
        queueResult.validationId,
        'approved',
        'U123456'
      );

      expect(mockStateManager.completeValidation).toHaveBeenCalledWith(
        queueResult.validationId,
        true
      );
    });

    it('should update Slack message after callback', async () => {
      const insight = createTestInsight();
      const queueResult = await validationQueue.queueForValidation(insight);

      await validationQueue.handleValidationCallback(
        queueResult.validationId,
        'approved',
        'U123456'
      );

      expect(mockSlack.updateValidationProcessed).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'approved',
        'U123456',
        expect.any(Object)
      );
    });

    it('should return error for non-existent validation', async () => {
      const result = await validationQueue.handleValidationCallback(
        'non_existent_id',
        'approved',
        'U123456'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ===========================================
  // Slack Interaction Handling Tests
  // ===========================================

  describe('Slack Interaction Handling', () => {
    it('should parse approve action from Slack payload', async () => {
      const insight = createTestInsight();
      const queueResult = await validationQueue.queueForValidation(insight);

      const payload: SlackInteractionPayload = {
        type: 'block_actions',
        user: {
          id: 'U123456',
          username: 'testuser',
        },
        actions: [
          {
            action_id: 'insight_approve',
            value: queueResult.validationId,
          },
        ],
        trigger_id: 'trigger_123',
        response_url: 'https://hooks.slack.com/actions/xxx',
      };

      const result = await validationQueue.handleSlackInteraction(payload);

      expect(result.success).toBe(true);
      expect(result.decision).toBe('approved');
      expect(result.validator).toBe('U123456');
    });

    it('should parse reject action from Slack payload', async () => {
      const insight = createTestInsight();
      const queueResult = await validationQueue.queueForValidation(insight);

      const payload: SlackInteractionPayload = {
        type: 'block_actions',
        user: {
          id: 'U789012',
          username: 'reviewer',
        },
        actions: [
          {
            action_id: 'insight_reject',
            value: queueResult.validationId,
          },
        ],
        trigger_id: 'trigger_456',
        response_url: 'https://hooks.slack.com/actions/yyy',
      };

      const result = await validationQueue.handleSlackInteraction(payload);

      expect(result.success).toBe(true);
      expect(result.decision).toBe('rejected');
    });

    it('should handle payload with no actions', async () => {
      const payload: SlackInteractionPayload = {
        type: 'block_actions',
        user: {
          id: 'U123456',
          username: 'testuser',
        },
        actions: [],
        trigger_id: 'trigger_123',
        response_url: 'https://hooks.slack.com/actions/xxx',
      };

      const result = await validationQueue.handleSlackInteraction(payload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No action');
    });
  });

  // ===========================================
  // Reminder Tests (FR-014, FR-015)
  // ===========================================

  describe('Reminders (FR-014, FR-015)', () => {
    it('should send reminder for old pending validations', async () => {
      // Create an old validation item (created 49 hours ago)
      // next_due_at is 48 hours after creation, so 1 hour ago
      const oldItem = createTestValidationItem({
        brain_id: TEST_BRAIN_ID,
        status: 'pending',
        created_at: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(),
        reminders: {
          count: 0,
          last_sent_at: null,
          next_due_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
        },
      });

      mockRedis._addTestItem(oldItem);

      const remindersSent = await validationQueue.processReminders(TEST_BRAIN_ID);

      expect(remindersSent).toBe(1);
      expect(mockSlack.sendValidationReminder).toHaveBeenCalledWith(
        expect.objectContaining({ id: oldItem.id }),
        1
      );
    });

    it('should not send reminder for recent validations', async () => {
      // Create a recent validation item (created 1 hour ago)
      // next_due_at is 48 hours after creation, so 47 hours in the future
      const recentItem = createTestValidationItem({
        brain_id: TEST_BRAIN_ID,
        status: 'pending',
        created_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        reminders: {
          count: 0,
          last_sent_at: null,
          next_due_at: new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString(), // 47 hours from now
        },
      });

      mockRedis._addTestItem(recentItem);

      const remindersSent = await validationQueue.processReminders(TEST_BRAIN_ID);

      expect(remindersSent).toBe(0);
      expect(mockSlack.sendValidationReminder).not.toHaveBeenCalled();
    });

    it('should update reminder tracking after sending', async () => {
      const oldItem = createTestValidationItem({
        brain_id: TEST_BRAIN_ID,
        status: 'pending',
        created_at: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(),
        reminders: {
          count: 0,
          last_sent_at: null,
          next_due_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
        },
      });

      mockRedis._addTestItem(oldItem);

      await validationQueue.processReminders(TEST_BRAIN_ID);

      expect(mockRedis.updateValidationItem).toHaveBeenCalled();
      expect(mockStateManager.recordReminderSent).toHaveBeenCalledWith(oldItem.id);
    });
  });

  // ===========================================
  // Expiration Tests
  // ===========================================

  describe('Expiration', () => {
    it('should expire validations older than expiration window', async () => {
      // Create an old validation item (created 73 hours ago)
      const expiredItem = createTestValidationItem({
        brain_id: TEST_BRAIN_ID,
        status: 'pending',
        created_at: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
      });

      mockRedis._addTestItem(expiredItem);

      const expiredCount = await validationQueue.expireOldValidations(TEST_BRAIN_ID);

      expect(expiredCount).toBe(1);
    });

    it('should not expire recent validations', async () => {
      const recentItem = createTestValidationItem({
        brain_id: TEST_BRAIN_ID,
        status: 'pending',
        created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });

      mockRedis._addTestItem(recentItem);

      const expiredCount = await validationQueue.expireOldValidations(TEST_BRAIN_ID);

      expect(expiredCount).toBe(0);
    });
  });

  // ===========================================
  // Query Operations Tests
  // ===========================================

  describe('Query Operations', () => {
    it('should get pending count for brain', async () => {
      const item1 = createTestValidationItem({
        brain_id: TEST_BRAIN_ID,
        status: 'pending',
      });
      const item2 = createTestValidationItem({
        brain_id: TEST_BRAIN_ID,
        status: 'pending',
      });

      mockRedis._addTestItem(item1);
      mockRedis._addTestItem(item2);

      const count = await validationQueue.getPendingCount(TEST_BRAIN_ID);

      expect(count).toBe(2);
    });

    it('should get all pending validations for brain', async () => {
      const item1 = createTestValidationItem({
        brain_id: TEST_BRAIN_ID,
        status: 'pending',
      });
      const item2 = createTestValidationItem({
        brain_id: 'other_brain',
        status: 'pending',
      });

      mockRedis._addTestItem(item1);
      mockRedis._addTestItem(item2);

      const validations = await validationQueue.getPendingValidations(TEST_BRAIN_ID);

      expect(validations).toHaveLength(1);
      expect(validations[0].brain_id).toBe(TEST_BRAIN_ID);
    });

    it('should get specific validation by ID', async () => {
      const item = createTestValidationItem({
        id: 'val_specific_123',
        brain_id: TEST_BRAIN_ID,
      });

      mockRedis._addTestItem(item);

      const validation = await validationQueue.getValidation('val_specific_123');

      expect(validation).not.toBeNull();
      expect(validation?.id).toBe('val_specific_123');
    });
  });
});
