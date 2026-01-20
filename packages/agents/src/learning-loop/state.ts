/**
 * Learning Loop Agent - State Management
 *
 * Manages session state persistence for the learning loop agent.
 * State is saved to state/learning-loop-state.json for session continuity.
 *
 * @module learning-loop/state
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BrainId } from '@atlas-gtm/lib';
import type {
  LearningLoopState,
  PendingExtraction,
  PendingValidation,
  RecentInsight,
  SessionError,
  SessionMetrics,
} from './types';
import { createInitialState } from './types';

// ===========================================
// Constants
// ===========================================

const STATE_DIR = 'state';
const STATE_FILE = 'learning-loop-state.json';
const STATE_PATH = join(STATE_DIR, STATE_FILE);

const MAX_RECENT_INSIGHTS = 100; // For dedup checking (last 24h worth)
const MAX_ERRORS = 100;
const STATE_VERSION = 1;

// ===========================================
// State Manager Class
// ===========================================

export class LearningLoopStateManager {
  private state: LearningLoopState;
  private readonly statePath: string;

  constructor(brainId?: string, statePath?: string) {
    this.statePath = statePath ?? STATE_PATH;
    this.state = createInitialState(brainId);
  }

  // ===========================================
  // Load / Save
  // ===========================================

  /**
   * Load state from file or create new session
   */
  async load(): Promise<void> {
    if (!existsSync(this.statePath)) {
      // No existing state, use initial state
      return;
    }

    try {
      const content = await readFile(this.statePath, 'utf-8');
      const loadedState = JSON.parse(content) as LearningLoopState;

      // Validate version
      if (loadedState.version !== STATE_VERSION) {
        console.warn(
          `State version mismatch: got ${loadedState.version}, expected ${STATE_VERSION}. Starting fresh.`
        );
        return;
      }

      // Validate brain_id matches if we have one set
      if (this.state.active_brain_id && loadedState.active_brain_id !== this.state.active_brain_id) {
        // Different brain_id means new session for different vertical
        return;
      }

      // Resume existing session
      this.state = loadedState;
      this.cleanupStaleInsights();
    } catch (error) {
      // Corrupted state file, start fresh
      console.warn('Failed to load state file, starting fresh session:', error);
    }
  }

  /**
   * Save current state to file
   */
  async save(): Promise<void> {
    // Ensure directory exists
    const dir = dirname(this.statePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    this.state.last_checkpoint = new Date().toISOString();
    this.state.last_activity = new Date().toISOString();
    const content = JSON.stringify(this.state, null, 2);
    await writeFile(this.statePath, content, 'utf-8');
  }

  /**
   * Checkpoint state (save at task boundaries)
   */
  async checkpoint(): Promise<void> {
    await this.save();
  }

  /**
   * Remove insights older than 24 hours (not needed for dedup)
   */
  private cleanupStaleInsights(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
    this.state.recent_insights = this.state.recent_insights.filter(
      insight => new Date(insight.created_at).getTime() > cutoff
    );
  }

  // ===========================================
  // Session Accessors
  // ===========================================

  get brainId(): string | null {
    return this.state.active_brain_id;
  }

  set brainId(id: string | null) {
    this.state.active_brain_id = id;
  }

  /**
   * Get brain ID (method form for compatibility)
   */
  getBrainId(): string | null {
    return this.state.active_brain_id;
  }

  get sessionStart(): string {
    return this.state.session_start;
  }

  getState(): Readonly<LearningLoopState> {
    return this.state;
  }

  // ===========================================
  // Pending Extraction Management
  // ===========================================

  /**
   * Add extraction job to queue
   */
  queueExtraction(extraction: Omit<PendingExtraction, 'queued_at' | 'started_at' | 'status' | 'error'>): void {
    // Don't add duplicates
    if (this.state.pending_extractions.some(e => e.job_id === extraction.job_id)) {
      return;
    }

    this.state.pending_extractions.push({
      ...extraction,
      queued_at: new Date().toISOString(),
      started_at: null,
      status: 'queued',
      error: null,
    });
  }

  /**
   * Get next queued extraction
   */
  getNextPendingExtraction(): PendingExtraction | undefined {
    return this.state.pending_extractions.find(e => e.status === 'queued');
  }

  /**
   * Mark extraction as started
   */
  startExtraction(jobId: string): void {
    const extraction = this.state.pending_extractions.find(e => e.job_id === jobId);
    if (extraction) {
      extraction.status = 'processing';
      extraction.started_at = new Date().toISOString();
    }
  }

  /**
   * Mark extraction as completed
   */
  completeExtraction(jobId: string): void {
    this.state.pending_extractions = this.state.pending_extractions.filter(
      e => e.job_id !== jobId
    );
  }

  /**
   * Mark extraction as failed
   */
  failExtraction(jobId: string, error: string): void {
    const extraction = this.state.pending_extractions.find(e => e.job_id === jobId);
    if (extraction) {
      extraction.status = 'failed';
      extraction.error = error;
    }
    this.state.metrics.extraction_errors++;
  }

  /**
   * Get pending extractions count
   */
  getPendingExtractionCount(): number {
    return this.state.pending_extractions.filter(e => e.status === 'queued').length;
  }

  // ===========================================
  // Pending Validation Management
  // ===========================================

  /**
   * Add validation to pending list
   */
  addPendingValidation(validation: Omit<PendingValidation, 'created_at' | 'reminder_count' | 'last_reminder_at'>): void {
    // Don't add duplicates
    if (this.state.pending_validations.some(v => v.validation_id === validation.validation_id)) {
      return;
    }

    this.state.pending_validations.push({
      ...validation,
      created_at: new Date().toISOString(),
      reminder_count: 0,
      last_reminder_at: null,
    });
  }

  /**
   * Get pending validation by ID
   */
  getPendingValidation(validationId: string): PendingValidation | undefined {
    return this.state.pending_validations.find(v => v.validation_id === validationId);
  }

  /**
   * Update reminder sent for validation
   */
  recordReminderSent(validationId: string): void {
    const validation = this.state.pending_validations.find(v => v.validation_id === validationId);
    if (validation) {
      validation.reminder_count++;
      validation.last_reminder_at = new Date().toISOString();
    }
  }

  /**
   * Remove completed validation
   */
  completeValidation(validationId: string, approved: boolean): void {
    this.state.pending_validations = this.state.pending_validations.filter(
      v => v.validation_id !== validationId
    );

    if (approved) {
      this.state.metrics.insights_validated++;
    } else {
      this.state.metrics.insights_rejected++;
    }
  }

  /**
   * Get validations needing reminders
   */
  getValidationsNeedingReminder(reminderHours: number, maxReminders: number): PendingValidation[] {
    const now = Date.now();
    const reminderThreshold = reminderHours * 60 * 60 * 1000;

    return this.state.pending_validations.filter(v => {
      if (v.reminder_count >= maxReminders) return false;

      const lastCheck = v.last_reminder_at ? new Date(v.last_reminder_at).getTime() : new Date(v.created_at).getTime();
      return now - lastCheck >= reminderThreshold;
    });
  }

  /**
   * Get pending validation count
   */
  getPendingValidationCount(): number {
    return this.state.pending_validations.length;
  }

  // ===========================================
  // Recent Insight Tracking (for dedup)
  // ===========================================

  /**
   * Add insight to recent list
   */
  addRecentInsight(insight: RecentInsight): void {
    this.state.recent_insights.unshift(insight);

    // Keep only last N insights
    if (this.state.recent_insights.length > MAX_RECENT_INSIGHTS) {
      this.state.recent_insights = this.state.recent_insights.slice(0, MAX_RECENT_INSIGHTS);
    }

    // Update metrics
    this.state.metrics.insights_extracted++;
  }

  /**
   * Check if content hash exists in recent insights (for dedup)
   */
  findDuplicateInsight(contentHash: string): RecentInsight | undefined {
    return this.state.recent_insights.find(i => i.content_hash === contentHash);
  }

  /**
   * Get recent insights
   */
  getRecentInsights(): readonly RecentInsight[] {
    return this.state.recent_insights;
  }

  // ===========================================
  // Error Tracking
  // ===========================================

  /**
   * Record an error
   */
  recordError(
    errorType: string,
    message: string,
    context: Record<string, unknown> = {},
    recovered = false
  ): void {
    const error: SessionError = {
      error_type: errorType,
      message,
      occurred_at: new Date().toISOString(),
      context,
      recovered,
    };

    this.state.errors.unshift(error);

    // Keep only last N errors
    if (this.state.errors.length > MAX_ERRORS) {
      this.state.errors = this.state.errors.slice(0, MAX_ERRORS);
    }
  }

  /**
   * Mark error as recovered
   */
  markErrorRecovered(errorType: string): void {
    const error = this.state.errors.find(
      e => e.error_type === errorType && !e.recovered
    );
    if (error) {
      error.recovered = true;
    }
  }

  /**
   * Get all errors
   */
  getErrors(): readonly SessionError[] {
    return this.state.errors;
  }

  /**
   * Get unrecovered errors
   */
  getUnrecoveredErrors(): SessionError[] {
    return this.state.errors.filter(e => !e.recovered);
  }

  // ===========================================
  // Metrics
  // ===========================================

  /**
   * Record auto-approved insight
   */
  recordAutoApproval(): void {
    this.state.metrics.insights_auto_approved++;
    this.state.metrics.insights_validated++;
  }

  /**
   * Record KB write
   */
  recordKBWrite(): void {
    this.state.metrics.kb_writes++;
  }

  /**
   * Update average extraction time
   */
  updateExtractionTime(durationMs: number): void {
    const count = this.state.metrics.insights_extracted;
    if (count === 0) {
      this.state.metrics.avg_extraction_ms = durationMs;
    } else {
      // Running average
      this.state.metrics.avg_extraction_ms =
        (this.state.metrics.avg_extraction_ms * (count - 1) + durationMs) / count;
    }
  }

  /**
   * Get session metrics
   */
  getMetrics(): Readonly<SessionMetrics> {
    return this.state.metrics;
  }

  /**
   * Get session statistics summary
   */
  getSessionStats(): {
    brainId: string | null;
    sessionStart: string;
    durationMs: number;
    pendingExtractions: number;
    pendingValidations: number;
    insightsExtracted: number;
    insightsValidated: number;
    insightsAutoApproved: number;
    insightsRejected: number;
    kbWrites: number;
    extractionErrors: number;
    avgExtractionMs: number;
    errorsCount: number;
    unrecoveredErrors: number;
  } {
    const now = new Date();
    const started = new Date(this.state.session_start);
    const durationMs = now.getTime() - started.getTime();

    return {
      brainId: this.state.active_brain_id,
      sessionStart: this.state.session_start,
      durationMs,
      pendingExtractions: this.getPendingExtractionCount(),
      pendingValidations: this.getPendingValidationCount(),
      insightsExtracted: this.state.metrics.insights_extracted,
      insightsValidated: this.state.metrics.insights_validated,
      insightsAutoApproved: this.state.metrics.insights_auto_approved,
      insightsRejected: this.state.metrics.insights_rejected,
      kbWrites: this.state.metrics.kb_writes,
      extractionErrors: this.state.metrics.extraction_errors,
      avgExtractionMs: Math.round(this.state.metrics.avg_extraction_ms),
      errorsCount: this.state.errors.length,
      unrecoveredErrors: this.getUnrecoveredErrors().length,
    };
  }

  // ===========================================
  // Session Reset
  // ===========================================

  /**
   * Reset session (clear all transient state)
   */
  resetSession(): void {
    const brainId = this.state.active_brain_id;
    this.state = createInitialState(brainId ?? undefined);
  }

  /**
   * Clear queues only (keep history)
   */
  clearQueues(): void {
    this.state.pending_extractions = [];
    this.state.pending_validations = [];
  }
}

// ===========================================
// Factory Functions
// ===========================================

/**
 * Load or create state manager
 */
export async function loadStateManager(
  brainId?: string,
  statePath?: string
): Promise<LearningLoopStateManager> {
  const manager = new LearningLoopStateManager(brainId, statePath);
  await manager.load();
  return manager;
}

/**
 * Create fresh state manager (no load)
 */
export function createStateManager(
  brainId?: string,
  statePath?: string
): LearningLoopStateManager {
  return new LearningLoopStateManager(brainId, statePath);
}
