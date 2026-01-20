/**
 * Learning Loop State Manager Tests
 *
 * Tests for session state management:
 * - Save/load state file
 * - Checkpoint during processing
 * - Resume from checkpoint
 * - Handle corrupted state
 * - Pending extraction/validation tracking
 * - Error tracking
 * - Metrics tracking
 *
 * Note: Uses actual temp file operations instead of vi.mock because
 * Bun's test runner doesn't support hoisted mocks.
 *
 * @module __tests__/learning-loop/state.test
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  LearningLoopStateManager,
  createStateManager,
  loadStateManager,
} from '../../learning-loop/state';
import { TEST_BRAIN_ID } from './fixtures';

// Create a unique temp directory for test state files
const TEST_DIR = join(tmpdir(), `learning-loop-test-${Date.now()}`);
const TEST_STATE_PATH = join(TEST_DIR, 'test-state.json');

describe('LearningLoopStateManager', () => {
  let stateManager: LearningLoopStateManager;

  beforeEach(async () => {
    // Ensure test directory exists and is clean
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors if directory doesn't exist
    }
    await mkdir(TEST_DIR, { recursive: true });

    stateManager = createStateManager(TEST_BRAIN_ID, TEST_STATE_PATH);
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===========================================
  // Initialization Tests
  // ===========================================

  describe('Initialization', () => {
    it('should create with default initial state', () => {
      const manager = createStateManager(TEST_BRAIN_ID);

      expect(manager.brainId).toBe(TEST_BRAIN_ID);
      expect(manager.getPendingExtractionCount()).toBe(0);
      expect(manager.getPendingValidationCount()).toBe(0);
    });

    it('should create without brain ID', () => {
      const manager = createStateManager();

      expect(manager.brainId).toBeNull();
    });

    it('should allow setting brain ID after creation', () => {
      const manager = createStateManager();
      manager.brainId = TEST_BRAIN_ID;

      expect(manager.brainId).toBe(TEST_BRAIN_ID);
    });
  });

  // ===========================================
  // Save / Load Tests
  // ===========================================

  describe('Save / Load', () => {
    it('should save state to file', async () => {
      stateManager.brainId = TEST_BRAIN_ID;

      await stateManager.save();

      // Load and verify file was written
      const manager = await loadStateManager(TEST_BRAIN_ID, TEST_STATE_PATH);
      expect(manager.brainId).toBe(TEST_BRAIN_ID);
    });

    it('should create directory if not exists on save', async () => {
      const nestedPath = join(TEST_DIR, 'nested', 'subdir', 'state.json');
      const manager = createStateManager(TEST_BRAIN_ID, nestedPath);

      // Should not throw
      await manager.save();

      // Verify we can load it back
      const loaded = await loadStateManager(TEST_BRAIN_ID, nestedPath);
      expect(loaded.brainId).toBe(TEST_BRAIN_ID);
    });

    it('should load existing state from file', async () => {
      const existingState = {
        version: 1,
        active_brain_id: TEST_BRAIN_ID,
        session_start: '2024-01-01T00:00:00.000Z',
        last_checkpoint: '2024-01-01T01:00:00.000Z',
        last_activity: '2024-01-01T01:00:00.000Z',
        pending_extractions: [],
        pending_validations: [],
        recent_insights: [],
        errors: [],
        metrics: {
          insights_extracted: 10,
          insights_validated: 8,
          insights_auto_approved: 5,
          insights_rejected: 2,
          kb_writes: 8,
          extraction_errors: 1,
          avg_extraction_ms: 150,
        },
      };

      // Write existing state file
      await writeFile(TEST_STATE_PATH, JSON.stringify(existingState), 'utf-8');

      const manager = await loadStateManager(TEST_BRAIN_ID, TEST_STATE_PATH);

      expect(manager.getMetrics().insights_extracted).toBe(10);
      expect(manager.getMetrics().insights_validated).toBe(8);
    });

    it('should ignore state with different version', async () => {
      const oldVersionState = {
        version: 0, // Old version
        active_brain_id: TEST_BRAIN_ID,
        session_start: '2024-01-01T00:00:00.000Z',
        last_checkpoint: '2024-01-01T00:00:00.000Z',
        last_activity: '2024-01-01T00:00:00.000Z',
        pending_extractions: [],
        pending_validations: [],
        recent_insights: [],
        errors: [],
        metrics: {
          insights_extracted: 100,
          insights_validated: 0,
          insights_auto_approved: 0,
          insights_rejected: 0,
          kb_writes: 0,
          extraction_errors: 0,
          avg_extraction_ms: 0,
        },
      };

      await writeFile(TEST_STATE_PATH, JSON.stringify(oldVersionState), 'utf-8');

      const manager = await loadStateManager(TEST_BRAIN_ID, TEST_STATE_PATH);

      // Should start fresh, not load old metrics
      expect(manager.getMetrics().insights_extracted).toBe(0);
    });

    it('should ignore state for different brain_id', async () => {
      const differentBrainState = {
        version: 1,
        active_brain_id: 'different_brain',
        session_start: '2024-01-01T00:00:00.000Z',
        last_checkpoint: '2024-01-01T00:00:00.000Z',
        last_activity: '2024-01-01T00:00:00.000Z',
        pending_extractions: [],
        pending_validations: [],
        recent_insights: [],
        errors: [],
        metrics: {
          insights_extracted: 50,
          insights_validated: 0,
          insights_auto_approved: 0,
          insights_rejected: 0,
          kb_writes: 0,
          extraction_errors: 0,
          avg_extraction_ms: 0,
        },
      };

      await writeFile(TEST_STATE_PATH, JSON.stringify(differentBrainState), 'utf-8');

      const manager = await loadStateManager(TEST_BRAIN_ID, TEST_STATE_PATH);

      // Should start fresh for different brain
      expect(manager.getMetrics().insights_extracted).toBe(0);
    });

    it('should handle corrupted state file gracefully', async () => {
      await writeFile(TEST_STATE_PATH, 'invalid json {{{', 'utf-8');

      const manager = await loadStateManager(TEST_BRAIN_ID, TEST_STATE_PATH);

      // Should start fresh
      expect(manager.getMetrics().insights_extracted).toBe(0);
    });
  });

  // ===========================================
  // Checkpoint Tests
  // ===========================================

  describe('Checkpoint', () => {
    it('should checkpoint state', async () => {
      stateManager.addRecentInsight({
        insight_id: 'insight_1',
        content_hash: 'hash_1',
        category: 'pain_point',
        created_at: new Date().toISOString(),
      });

      await stateManager.checkpoint();

      // Load and verify checkpoint was saved
      const loaded = await loadStateManager(TEST_BRAIN_ID, TEST_STATE_PATH);
      expect(loaded.getRecentInsights()).toHaveLength(1);
    });

    it('should update last_checkpoint timestamp on save', async () => {
      const beforeSave = new Date().toISOString();

      await stateManager.save();

      // Load and check
      const loaded = await loadStateManager(TEST_BRAIN_ID, TEST_STATE_PATH);
      const state = loaded.getState();
      expect(new Date(state.last_checkpoint).getTime())
        .toBeGreaterThanOrEqual(new Date(beforeSave).getTime());
    });
  });

  // ===========================================
  // Pending Extraction Tests
  // ===========================================

  describe('Pending Extractions', () => {
    it('should queue extraction job', () => {
      stateManager.queueExtraction({
        job_id: 'job_1',
        source_type: 'email_reply',
        source_id: 'email_123',
        brain_id: TEST_BRAIN_ID,
      });

      expect(stateManager.getPendingExtractionCount()).toBe(1);
    });

    it('should not queue duplicate extractions', () => {
      stateManager.queueExtraction({
        job_id: 'job_1',
        source_type: 'email_reply',
        source_id: 'email_123',
        brain_id: TEST_BRAIN_ID,
      });

      stateManager.queueExtraction({
        job_id: 'job_1', // Same job_id
        source_type: 'email_reply',
        source_id: 'email_123',
        brain_id: TEST_BRAIN_ID,
      });

      expect(stateManager.getPendingExtractionCount()).toBe(1);
    });

    it('should get next pending extraction', () => {
      stateManager.queueExtraction({
        job_id: 'job_1',
        source_type: 'email_reply',
        source_id: 'email_123',
        brain_id: TEST_BRAIN_ID,
      });

      stateManager.queueExtraction({
        job_id: 'job_2',
        source_type: 'call_transcript',
        source_id: 'call_456',
        brain_id: TEST_BRAIN_ID,
      });

      const next = stateManager.getNextPendingExtraction();

      expect(next?.job_id).toBe('job_1');
    });

    it('should mark extraction as started', () => {
      stateManager.queueExtraction({
        job_id: 'job_1',
        source_type: 'email_reply',
        source_id: 'email_123',
        brain_id: TEST_BRAIN_ID,
      });

      stateManager.startExtraction('job_1');

      // Started extraction should not be in pending count
      const next = stateManager.getNextPendingExtraction();
      expect(next).toBeUndefined();
    });

    it('should complete extraction and remove from queue', () => {
      stateManager.queueExtraction({
        job_id: 'job_1',
        source_type: 'email_reply',
        source_id: 'email_123',
        brain_id: TEST_BRAIN_ID,
      });

      stateManager.completeExtraction('job_1');

      expect(stateManager.getPendingExtractionCount()).toBe(0);
    });

    it('should fail extraction and track error', () => {
      stateManager.queueExtraction({
        job_id: 'job_1',
        source_type: 'email_reply',
        source_id: 'email_123',
        brain_id: TEST_BRAIN_ID,
      });

      stateManager.failExtraction('job_1', 'API error');

      expect(stateManager.getMetrics().extraction_errors).toBe(1);
    });
  });

  // ===========================================
  // Pending Validation Tests
  // ===========================================

  describe('Pending Validations', () => {
    it('should add pending validation', () => {
      stateManager.addPendingValidation({
        validation_id: 'val_1',
        insight_id: 'insight_1',
        brain_id: TEST_BRAIN_ID,
      });

      expect(stateManager.getPendingValidationCount()).toBe(1);
    });

    it('should not add duplicate validations', () => {
      stateManager.addPendingValidation({
        validation_id: 'val_1',
        insight_id: 'insight_1',
        brain_id: TEST_BRAIN_ID,
      });

      stateManager.addPendingValidation({
        validation_id: 'val_1', // Same validation_id
        insight_id: 'insight_1',
        brain_id: TEST_BRAIN_ID,
      });

      expect(stateManager.getPendingValidationCount()).toBe(1);
    });

    it('should get pending validation by ID', () => {
      stateManager.addPendingValidation({
        validation_id: 'val_1',
        insight_id: 'insight_1',
        brain_id: TEST_BRAIN_ID,
      });

      const validation = stateManager.getPendingValidation('val_1');

      expect(validation).toBeDefined();
      expect(validation?.insight_id).toBe('insight_1');
    });

    it('should record reminder sent', () => {
      stateManager.addPendingValidation({
        validation_id: 'val_1',
        insight_id: 'insight_1',
        brain_id: TEST_BRAIN_ID,
      });

      stateManager.recordReminderSent('val_1');

      const validation = stateManager.getPendingValidation('val_1');
      expect(validation?.reminder_count).toBe(1);
      expect(validation?.last_reminder_at).toBeDefined();
    });

    it('should complete validation and update metrics (approved)', () => {
      stateManager.addPendingValidation({
        validation_id: 'val_1',
        insight_id: 'insight_1',
        brain_id: TEST_BRAIN_ID,
      });

      stateManager.completeValidation('val_1', true);

      expect(stateManager.getPendingValidationCount()).toBe(0);
      expect(stateManager.getMetrics().insights_validated).toBe(1);
    });

    it('should complete validation and update metrics (rejected)', () => {
      stateManager.addPendingValidation({
        validation_id: 'val_1',
        insight_id: 'insight_1',
        brain_id: TEST_BRAIN_ID,
      });

      stateManager.completeValidation('val_1', false);

      expect(stateManager.getPendingValidationCount()).toBe(0);
      expect(stateManager.getMetrics().insights_rejected).toBe(1);
    });

    it('should get validations needing reminder', () => {
      // Add old validation (created 49 hours ago)
      stateManager.addPendingValidation({
        validation_id: 'val_old',
        insight_id: 'insight_old',
        brain_id: TEST_BRAIN_ID,
      });

      // Manually adjust created_at
      const state = stateManager.getState() as any;
      state.pending_validations[0].created_at = new Date(
        Date.now() - 49 * 60 * 60 * 1000
      ).toISOString();

      const needingReminder = stateManager.getValidationsNeedingReminder(48, 2);

      expect(needingReminder).toHaveLength(1);
      expect(needingReminder[0].validation_id).toBe('val_old');
    });
  });

  // ===========================================
  // Recent Insight Tracking Tests
  // ===========================================

  describe('Recent Insight Tracking', () => {
    it('should add recent insight', () => {
      stateManager.addRecentInsight({
        insight_id: 'insight_1',
        content_hash: 'hash_1',
        category: 'pain_point',
        created_at: new Date().toISOString(),
      });

      expect(stateManager.getRecentInsights()).toHaveLength(1);
      expect(stateManager.getMetrics().insights_extracted).toBe(1);
    });

    it('should find duplicate insight by content hash', () => {
      stateManager.addRecentInsight({
        insight_id: 'insight_1',
        content_hash: 'hash_123',
        category: 'objection',
        created_at: new Date().toISOString(),
      });

      const duplicate = stateManager.findDuplicateInsight('hash_123');

      expect(duplicate).toBeDefined();
      expect(duplicate?.insight_id).toBe('insight_1');
    });

    it('should return undefined for non-existent hash', () => {
      const duplicate = stateManager.findDuplicateInsight('non_existent');

      expect(duplicate).toBeUndefined();
    });

    it('should limit recent insights to max size', () => {
      // Add 110 insights
      for (let i = 0; i < 110; i++) {
        stateManager.addRecentInsight({
          insight_id: `insight_${i}`,
          content_hash: `hash_${i}`,
          category: 'pain_point',
          created_at: new Date().toISOString(),
        });
      }

      // Should be limited to 100
      expect(stateManager.getRecentInsights().length).toBeLessThanOrEqual(100);
    });
  });

  // ===========================================
  // Error Tracking Tests
  // ===========================================

  describe('Error Tracking', () => {
    it('should record error', () => {
      stateManager.recordError(
        'api_error',
        'Anthropic API failed',
        { attempt: 1 }
      );

      const errors = stateManager.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].error_type).toBe('api_error');
      expect(errors[0].context).toEqual({ attempt: 1 });
    });

    it('should track unrecovered errors', () => {
      stateManager.recordError('error_1', 'First error');
      stateManager.recordError('error_2', 'Second error');

      expect(stateManager.getUnrecoveredErrors()).toHaveLength(2);
    });

    it('should mark error as recovered', () => {
      stateManager.recordError('recoverable_error', 'Temporary failure');
      stateManager.markErrorRecovered('recoverable_error');

      expect(stateManager.getUnrecoveredErrors()).toHaveLength(0);
    });

    it('should limit errors to max size', () => {
      // Add 110 errors
      for (let i = 0; i < 110; i++) {
        stateManager.recordError(`error_${i}`, `Error ${i}`);
      }

      expect(stateManager.getErrors().length).toBeLessThanOrEqual(100);
    });
  });

  // ===========================================
  // Metrics Tests
  // ===========================================

  describe('Metrics', () => {
    it('should record auto approval', () => {
      stateManager.recordAutoApproval();

      expect(stateManager.getMetrics().insights_auto_approved).toBe(1);
      expect(stateManager.getMetrics().insights_validated).toBe(1);
    });

    it('should record KB write', () => {
      stateManager.recordKBWrite();
      stateManager.recordKBWrite();

      expect(stateManager.getMetrics().kb_writes).toBe(2);
    });

    it('should update extraction time running average', () => {
      // First extraction
      stateManager.addRecentInsight({
        insight_id: 'insight_1',
        content_hash: 'hash_1',
        category: 'pain_point',
        created_at: new Date().toISOString(),
      });
      stateManager.updateExtractionTime(100);

      expect(stateManager.getMetrics().avg_extraction_ms).toBe(100);

      // Second extraction
      stateManager.addRecentInsight({
        insight_id: 'insight_2',
        content_hash: 'hash_2',
        category: 'objection',
        created_at: new Date().toISOString(),
      });
      stateManager.updateExtractionTime(200);

      // Running average: (100 + 200) / 2 = 150
      expect(stateManager.getMetrics().avg_extraction_ms).toBe(150);
    });

    it('should get session stats summary', () => {
      stateManager.addRecentInsight({
        insight_id: 'insight_1',
        content_hash: 'hash_1',
        category: 'pain_point',
        created_at: new Date().toISOString(),
      });
      stateManager.recordAutoApproval();
      stateManager.recordKBWrite();

      const stats = stateManager.getSessionStats();

      expect(stats.brainId).toBe(TEST_BRAIN_ID);
      expect(stats.insightsExtracted).toBe(1);
      expect(stats.insightsAutoApproved).toBe(1);
      expect(stats.kbWrites).toBe(1);
    });
  });

  // ===========================================
  // Session Reset Tests
  // ===========================================

  describe('Session Reset', () => {
    it('should reset session while keeping brain ID', () => {
      stateManager.addRecentInsight({
        insight_id: 'insight_1',
        content_hash: 'hash_1',
        category: 'pain_point',
        created_at: new Date().toISOString(),
      });

      stateManager.resetSession();

      expect(stateManager.brainId).toBe(TEST_BRAIN_ID);
      expect(stateManager.getRecentInsights()).toHaveLength(0);
      expect(stateManager.getMetrics().insights_extracted).toBe(0);
    });

    it('should clear queues only', () => {
      stateManager.queueExtraction({
        job_id: 'job_1',
        source_type: 'email_reply',
        source_id: 'email_123',
        brain_id: TEST_BRAIN_ID,
      });

      stateManager.addPendingValidation({
        validation_id: 'val_1',
        insight_id: 'insight_1',
        brain_id: TEST_BRAIN_ID,
      });

      stateManager.addRecentInsight({
        insight_id: 'insight_1',
        content_hash: 'hash_1',
        category: 'pain_point',
        created_at: new Date().toISOString(),
      });

      stateManager.clearQueues();

      expect(stateManager.getPendingExtractionCount()).toBe(0);
      expect(stateManager.getPendingValidationCount()).toBe(0);
      // Recent insights should still be there
      expect(stateManager.getRecentInsights()).toHaveLength(1);
    });
  });
});
