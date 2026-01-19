/**
 * Reply Handler Agent - State Management
 *
 * Manages session state persistence for the reply handler agent.
 * State is saved to state/reply-handler-state.json for session continuity.
 *
 * @module reply-handler/state
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ReplyHandlerState,
  ActiveThread,
  ProcessedReply,
  SessionError,
  Draft,
  DraftStatus,
} from './types';
import type { Classification, ExtractedInsight, LeadContext } from './contracts';

// ===========================================
// Constants
// ===========================================

const STATE_DIR = 'state';
const STATE_FILE = 'reply-handler-state.json';
const STATE_PATH = join(STATE_DIR, STATE_FILE);

// ===========================================
// State Manager Class
// ===========================================

export class ReplyHandlerStateManager {
  private state: ReplyHandlerState;
  private drafts: Map<string, Draft> = new Map();
  private readonly statePath: string;

  constructor(brainId: string, statePath?: string) {
    this.statePath = statePath ?? STATE_PATH;
    this.state = this.createInitialState(brainId);
  }

  // ===========================================
  // Initialization
  // ===========================================

  private createInitialState(brainId: string): ReplyHandlerState {
    return {
      session_id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      brain_id: brainId,
      started_at: new Date().toISOString(),
      checkpoint_at: new Date().toISOString(),
      active_threads: [],
      processed_this_session: [],
      insights_extracted: [],
      errors_this_session: [],
    };
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
      const loadedState = JSON.parse(content) as ReplyHandlerState;

      // Validate brain_id matches
      if (loadedState.brain_id === this.state.brain_id) {
        // Resume existing session
        this.state = loadedState;
      }
      // Different brain_id means new session for different vertical
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

    this.state.checkpoint_at = new Date().toISOString();
    const content = JSON.stringify(this.state, null, 2);
    await writeFile(this.statePath, content, 'utf-8');
  }

  /**
   * Checkpoint state (save at task boundaries)
   */
  async checkpoint(): Promise<void> {
    await this.save();
  }

  // ===========================================
  // Session Accessors
  // ===========================================

  get sessionId(): string {
    return this.state.session_id;
  }

  get brainId(): string {
    return this.state.brain_id;
  }

  get startedAt(): string {
    return this.state.started_at;
  }

  getState(): Readonly<ReplyHandlerState> {
    return this.state;
  }

  // ===========================================
  // Active Thread Management
  // ===========================================

  /**
   * Start processing a thread
   */
  startThread(threadId: string, leadId: string): void {
    const existing = this.state.active_threads.find(t => t.thread_id === threadId);
    if (existing) {
      existing.status = 'processing';
      existing.started_at = new Date().toISOString();
    } else {
      this.state.active_threads.push({
        thread_id: threadId,
        lead_id: leadId,
        status: 'processing',
        started_at: new Date().toISOString(),
      });
    }
  }

  /**
   * Update thread status to pending approval
   */
  setThreadPendingApproval(threadId: string, draftId: string): void {
    const thread = this.state.active_threads.find(t => t.thread_id === threadId);
    if (thread) {
      thread.status = 'pending_approval';
      thread.draft_id = draftId;
    }
  }

  /**
   * Mark thread as escalated
   */
  setThreadEscalated(threadId: string): void {
    const thread = this.state.active_threads.find(t => t.thread_id === threadId);
    if (thread) {
      thread.status = 'escalated';
    }
  }

  /**
   * Complete processing a thread
   */
  completeThread(threadId: string): void {
    this.state.active_threads = this.state.active_threads.filter(
      t => t.thread_id !== threadId
    );
  }

  /**
   * Get active thread by ID
   */
  getActiveThread(threadId: string): ActiveThread | undefined {
    return this.state.active_threads.find(t => t.thread_id === threadId);
  }

  /**
   * Get all active threads
   */
  getActiveThreads(): readonly ActiveThread[] {
    return this.state.active_threads;
  }

  // ===========================================
  // Processed Reply Tracking
  // ===========================================

  /**
   * Record a processed reply
   */
  recordProcessedReply(reply: ProcessedReply): void {
    this.state.processed_this_session.push(reply);
  }

  /**
   * Get count of processed replies by tier
   */
  getProcessedCountByTier(): { tier1: number; tier2: number; tier3: number } {
    const counts = { tier1: 0, tier2: 0, tier3: 0 };
    for (const reply of this.state.processed_this_session) {
      if (reply.tier === 1) counts.tier1++;
      else if (reply.tier === 2) counts.tier2++;
      else if (reply.tier === 3) counts.tier3++;
    }
    return counts;
  }

  /**
   * Check if reply was already processed (idempotency)
   */
  isReplyProcessed(replyId: string): boolean {
    return this.state.processed_this_session.some(r => r.reply_id === replyId);
  }

  // ===========================================
  // Draft Management
  // ===========================================

  /**
   * Create a new draft for Tier 2 approval
   */
  createDraft(params: {
    replyId: string;
    responseText: string;
    templateId?: string;
    slackChannel: string;
    slackMessageTs: string;
    leadContext: LeadContext;
    classification: Classification;
    timeoutMinutes?: number;
  }): Draft {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (params.timeoutMinutes ?? 30) * 60 * 1000);

    const draft: Draft = {
      id: `draft_${params.replyId}_${Date.now()}`,
      reply_id: params.replyId,
      response_text: params.responseText,
      original_template_id: params.templateId,
      slack_channel: params.slackChannel,
      slack_message_ts: params.slackMessageTs,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
      lead_context: params.leadContext,
      classification: params.classification,
    };

    this.drafts.set(draft.id, draft);
    return draft;
  }

  /**
   * Get draft by ID
   */
  getDraft(draftId: string): Draft | undefined {
    return this.drafts.get(draftId);
  }

  /**
   * Get draft by Slack message timestamp
   */
  getDraftBySlackTs(messageTs: string): Draft | undefined {
    for (const draft of this.drafts.values()) {
      if (draft.slack_message_ts === messageTs) {
        return draft;
      }
    }
    return undefined;
  }

  /**
   * Get draft by reply ID
   */
  getDraftByReplyId(replyId: string): Draft | undefined {
    for (const draft of this.drafts.values()) {
      if (draft.reply_id === replyId) {
        return draft;
      }
    }
    return undefined;
  }

  /**
   * Update draft status
   */
  updateDraftStatus(
    draftId: string,
    status: DraftStatus,
    options?: {
      approvedBy?: string;
      editedText?: string;
    }
  ): Draft | undefined {
    const draft = this.drafts.get(draftId);
    if (!draft) return undefined;

    draft.status = status;
    if (status !== 'pending' && status !== 'expired') {
      draft.approved_at = new Date().toISOString();
      draft.approved_by = options?.approvedBy;
    }
    if (options?.editedText) {
      draft.edited_text = options.editedText;
    }

    return draft;
  }

  /**
   * Get all pending drafts
   */
  getPendingDrafts(): Draft[] {
    const pending: Draft[] = [];
    const now = new Date();

    for (const draft of this.drafts.values()) {
      if (draft.status === 'pending') {
        // Check if expired
        if (new Date(draft.expires_at) <= now) {
          draft.status = 'expired';
        } else {
          pending.push(draft);
        }
      }
    }

    return pending;
  }

  /**
   * Get expired drafts that need processing
   */
  getExpiredDrafts(): Draft[] {
    const expired: Draft[] = [];
    const now = new Date();

    for (const draft of this.drafts.values()) {
      if (draft.status === 'pending' && new Date(draft.expires_at) <= now) {
        draft.status = 'expired';
        expired.push(draft);
      }
    }

    return expired;
  }

  /**
   * Delete draft
   */
  deleteDraft(draftId: string): boolean {
    return this.drafts.delete(draftId);
  }

  // ===========================================
  // Insight Tracking
  // ===========================================

  /**
   * Record an extracted insight
   */
  recordInsight(insight: ExtractedInsight): void {
    this.state.insights_extracted.push(insight);
  }

  /**
   * Get insights extracted this session
   */
  getExtractedInsights(): readonly ExtractedInsight[] {
    return this.state.insights_extracted;
  }

  // ===========================================
  // Error Tracking
  // ===========================================

  /**
   * Record a processing error
   */
  recordError(error: SessionError): void {
    this.state.errors_this_session.push(error);
  }

  /**
   * Create error from exception
   */
  createError(
    replyId: string,
    error: Error | unknown,
    recovered: boolean = false
  ): SessionError {
    const sessionError: SessionError = {
      reply_id: replyId,
      error_code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      error_message: error instanceof Error ? error.message : String(error),
      occurred_at: new Date().toISOString(),
      recovered,
    };

    this.recordError(sessionError);
    return sessionError;
  }

  /**
   * Get error count this session
   */
  getErrorCount(): number {
    return this.state.errors_this_session.length;
  }

  /**
   * Get errors for a specific reply
   */
  getErrorsForReply(replyId: string): SessionError[] {
    return this.state.errors_this_session.filter(e => e.reply_id === replyId);
  }

  // ===========================================
  // Session Statistics
  // ===========================================

  /**
   * Get session statistics
   */
  getSessionStats(): {
    sessionId: string;
    brainId: string;
    startedAt: string;
    durationMs: number;
    processed: number;
    byTier: { tier1: number; tier2: number; tier3: number };
    pendingDrafts: number;
    insightsExtracted: number;
    errors: number;
    avgProcessingTimeMs: number;
  } {
    const now = new Date();
    const started = new Date(this.state.started_at);
    const durationMs = now.getTime() - started.getTime();

    const byTier = this.getProcessedCountByTier();
    const pendingDrafts = this.getPendingDrafts().length;

    // Calculate average processing time
    let totalProcessingTime = 0;
    for (const reply of this.state.processed_this_session) {
      totalProcessingTime += reply.processing_time_ms;
    }
    const avgProcessingTimeMs =
      this.state.processed_this_session.length > 0
        ? totalProcessingTime / this.state.processed_this_session.length
        : 0;

    return {
      sessionId: this.state.session_id,
      brainId: this.state.brain_id,
      startedAt: this.state.started_at,
      durationMs,
      processed: this.state.processed_this_session.length,
      byTier,
      pendingDrafts,
      insightsExtracted: this.state.insights_extracted.length,
      errors: this.state.errors_this_session.length,
      avgProcessingTimeMs: Math.round(avgProcessingTimeMs),
    };
  }

  // ===========================================
  // Session Reset
  // ===========================================

  /**
   * Reset session (clear all transient state)
   */
  resetSession(): void {
    const brainId = this.state.brain_id;
    this.state = this.createInitialState(brainId);
    this.drafts.clear();
  }
}

// ===========================================
// Factory Functions
// ===========================================

/**
 * Load or create state manager
 */
export async function loadStateManager(
  brainId: string,
  statePath?: string
): Promise<ReplyHandlerStateManager> {
  const manager = new ReplyHandlerStateManager(brainId, statePath);
  await manager.load();
  return manager;
}

/**
 * Create fresh state manager (no load)
 */
export function createStateManager(
  brainId: string,
  statePath?: string
): ReplyHandlerStateManager {
  return new ReplyHandlerStateManager(brainId, statePath);
}
