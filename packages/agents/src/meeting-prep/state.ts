/**
 * Meeting Prep Agent - State Management
 *
 * Manages session state persistence for the meeting prep agent.
 * State is saved to state/meeting-prep-state.json for session continuity.
 * Implements FR-013: State persistence for session handoff.
 *
 * @module meeting-prep/state
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BrainId } from '@atlas-gtm/lib';
import type {
  MeetingPrepState,
  UpcomingMeeting,
  BriefQueueEntry,
  AnalysisQueueEntry,
  RecentBrief,
  RecentAnalysis,
  SessionError,
  SessionMetrics,
  SubAgentSuccessRate,
} from './types';
import type { BriefStatus } from './contracts/brief';

// ===========================================
// Constants
// ===========================================

const STATE_DIR = 'state';
const STATE_FILE = 'meeting-prep-state.json';
const STATE_PATH = join(STATE_DIR, STATE_FILE);

const MAX_RECENT_BRIEFS = 20;
const MAX_RECENT_ANALYSES = 20;
const MAX_ERRORS = 100;

// ===========================================
// State Manager Class
// ===========================================

export class MeetingPrepStateManager {
  private state: MeetingPrepState;
  private readonly statePath: string;

  constructor(brainId: BrainId, statePath?: string) {
    this.statePath = statePath ?? STATE_PATH;
    this.state = this.createInitialState(brainId);
  }

  // ===========================================
  // Initialization
  // ===========================================

  private createInitialState(brainId: BrainId): MeetingPrepState {
    return {
      session_id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      brain_id: brainId,
      started_at: new Date().toISOString(),
      checkpoint_at: new Date().toISOString(),
      upcoming_meetings: [],
      brief_queue: [],
      analysis_queue: [],
      recent_briefs: [],
      recent_analyses: [],
      errors: [],
      metrics: {
        briefs_generated: 0,
        briefs_delivered: 0,
        briefs_failed: 0,
        analyses_completed: 0,
        avg_brief_time_ms: 0,
        avg_analysis_time_ms: 0,
        // T040: Context gathering performance metrics
        avg_context_gather_ms: 0,
        context_gather_count: 0,
        cache_hit_rate: 0,
        cache_lookups: 0,
        cache_hits: 0,
        sub_agent_success_rates: {
          instantly: this.createInitialSuccessRate(),
          airtable: this.createInitialSuccessRate(),
          attio: this.createInitialSuccessRate(),
          kb: this.createInitialSuccessRate(),
        },
      },
    };
  }

  /**
   * Create initial sub-agent success rate (T040)
   */
  private createInitialSuccessRate(): SubAgentSuccessRate {
    return {
      attempts: 0,
      successes: 0,
      failures: 0,
      timeouts: 0,
      rate: 0,
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
      const loadedState = JSON.parse(content) as MeetingPrepState;

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

  get brainId(): BrainId {
    return this.state.brain_id;
  }

  get startedAt(): string {
    return this.state.started_at;
  }

  getState(): Readonly<MeetingPrepState> {
    return this.state;
  }

  // ===========================================
  // Upcoming Meeting Management
  // ===========================================

  /**
   * Add or update an upcoming meeting
   */
  addUpcomingMeeting(meeting: UpcomingMeeting): void {
    const existing = this.state.upcoming_meetings.findIndex(
      m => m.meeting_id === meeting.meeting_id
    );

    if (existing >= 0) {
      this.state.upcoming_meetings[existing] = meeting;
    } else {
      this.state.upcoming_meetings.push(meeting);
    }

    // Sort by start time (ascending)
    this.state.upcoming_meetings.sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );
  }

  /**
   * Update meeting brief status
   */
  updateMeetingBriefStatus(
    meetingId: string,
    status: BriefStatus,
    briefId?: string
  ): void {
    const meeting = this.state.upcoming_meetings.find(m => m.meeting_id === meetingId);
    if (meeting) {
      meeting.brief_status = status;
      if (briefId) {
        meeting.brief_id = briefId;
      }
    }
  }

  /**
   * Remove meeting from upcoming (after it's passed or processed)
   */
  removeUpcomingMeeting(meetingId: string): void {
    this.state.upcoming_meetings = this.state.upcoming_meetings.filter(
      m => m.meeting_id !== meetingId
    );
  }

  /**
   * Get upcoming meeting by ID
   */
  getUpcomingMeeting(meetingId: string): UpcomingMeeting | undefined {
    return this.state.upcoming_meetings.find(m => m.meeting_id === meetingId);
  }

  /**
   * Get all upcoming meetings
   */
  getUpcomingMeetings(): readonly UpcomingMeeting[] {
    return this.state.upcoming_meetings;
  }

  /**
   * Get meetings that need briefs generated
   */
  getMeetingsNeedingBriefs(): UpcomingMeeting[] {
    return this.state.upcoming_meetings.filter(m => m.brief_status === 'pending');
  }

  // ===========================================
  // Brief Queue Management
  // ===========================================

  /**
   * Add meeting to brief generation queue
   */
  queueBrief(meetingId: string, priority: number = 100): void {
    // Don't add duplicates
    if (this.state.brief_queue.some(q => q.meeting_id === meetingId)) {
      return;
    }

    this.state.brief_queue.push({
      meeting_id: meetingId,
      queued_at: new Date().toISOString(),
      priority,
    });

    // Sort by priority (ascending - lower = higher priority)
    this.state.brief_queue.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get next brief to generate
   */
  dequeueNextBrief(): BriefQueueEntry | undefined {
    return this.state.brief_queue.shift();
  }

  /**
   * Remove from brief queue
   */
  removeBriefFromQueue(meetingId: string): void {
    this.state.brief_queue = this.state.brief_queue.filter(
      q => q.meeting_id !== meetingId
    );
  }

  /**
   * Get brief queue length
   */
  getBriefQueueLength(): number {
    return this.state.brief_queue.length;
  }

  // ===========================================
  // Analysis Queue Management
  // ===========================================

  /**
   * Add transcript to analysis queue
   */
  queueAnalysis(meetingId: string, transcriptReceivedAt: string): void {
    // Don't add duplicates
    if (this.state.analysis_queue.some(q => q.meeting_id === meetingId)) {
      return;
    }

    this.state.analysis_queue.push({
      meeting_id: meetingId,
      transcript_received_at: transcriptReceivedAt,
      queued_at: new Date().toISOString(),
    });
  }

  /**
   * Get next analysis to process
   */
  dequeueNextAnalysis(): AnalysisQueueEntry | undefined {
    return this.state.analysis_queue.shift();
  }

  /**
   * Remove from analysis queue
   */
  removeAnalysisFromQueue(meetingId: string): void {
    this.state.analysis_queue = this.state.analysis_queue.filter(
      q => q.meeting_id !== meetingId
    );
  }

  /**
   * Get analysis queue length
   */
  getAnalysisQueueLength(): number {
    return this.state.analysis_queue.length;
  }

  // ===========================================
  // Recent Brief Tracking
  // ===========================================

  /**
   * Record a delivered brief
   */
  recordBriefDelivered(brief: RecentBrief): void {
    this.state.recent_briefs.unshift(brief);

    // Keep only last N briefs
    if (this.state.recent_briefs.length > MAX_RECENT_BRIEFS) {
      this.state.recent_briefs = this.state.recent_briefs.slice(0, MAX_RECENT_BRIEFS);
    }

    // Update metrics
    this.state.metrics.briefs_generated++;
    this.state.metrics.briefs_delivered++;
    this.updateAvgBriefTime(brief.processing_time_ms);
  }

  /**
   * Get recent briefs
   */
  getRecentBriefs(): readonly RecentBrief[] {
    return this.state.recent_briefs;
  }

  /**
   * Check if brief was already generated for meeting
   */
  hasBriefForMeeting(meetingId: string): boolean {
    return this.state.recent_briefs.some(b => b.meeting_id === meetingId);
  }

  private updateAvgBriefTime(newTime: number): void {
    const count = this.state.metrics.briefs_generated;
    if (count === 1) {
      this.state.metrics.avg_brief_time_ms = newTime;
    } else {
      // Running average
      this.state.metrics.avg_brief_time_ms =
        (this.state.metrics.avg_brief_time_ms * (count - 1) + newTime) / count;
    }
  }

  // ===========================================
  // Recent Analysis Tracking
  // ===========================================

  /**
   * Record a completed analysis
   */
  recordAnalysisCompleted(analysis: RecentAnalysis): void {
    this.state.recent_analyses.unshift(analysis);

    // Keep only last N analyses
    if (this.state.recent_analyses.length > MAX_RECENT_ANALYSES) {
      this.state.recent_analyses = this.state.recent_analyses.slice(0, MAX_RECENT_ANALYSES);
    }

    // Update metrics
    this.state.metrics.analyses_completed++;
    this.updateAvgAnalysisTime(
      new Date(analysis.analyzed_at).getTime() - Date.now() // Placeholder for duration
    );
  }

  /**
   * Get recent analyses
   */
  getRecentAnalyses(): readonly RecentAnalysis[] {
    return this.state.recent_analyses;
  }

  private updateAvgAnalysisTime(newTime: number): void {
    const count = this.state.metrics.analyses_completed;
    if (count === 1) {
      this.state.metrics.avg_analysis_time_ms = Math.abs(newTime);
    } else {
      this.state.metrics.avg_analysis_time_ms =
        (this.state.metrics.avg_analysis_time_ms * (count - 1) + Math.abs(newTime)) / count;
    }
  }

  // ===========================================
  // Error Tracking
  // ===========================================

  /**
   * Record an error
   */
  recordError(error: Omit<SessionError, 'timestamp'>): void {
    this.state.errors.unshift({
      ...error,
      timestamp: new Date().toISOString(),
    });

    // Keep only last N errors
    if (this.state.errors.length > MAX_ERRORS) {
      this.state.errors = this.state.errors.slice(0, MAX_ERRORS);
    }

    // Update failed count if brief generation failed
    if (error.operation === 'brief_generation') {
      this.state.metrics.briefs_failed++;
    }
  }

  /**
   * Get errors for a meeting
   */
  getErrorsForMeeting(meetingId: string): SessionError[] {
    return this.state.errors.filter(e => e.meeting_id === meetingId);
  }

  /**
   * Get retry count for operation
   */
  getRetryCount(meetingId: string, operation: SessionError['operation']): number {
    const errors = this.state.errors.filter(
      e => e.meeting_id === meetingId && e.operation === operation
    );
    return errors.length > 0 ? Math.max(...errors.map(e => e.retry_count)) : 0;
  }

  /**
   * Get all errors
   */
  getErrors(): readonly SessionError[] {
    return this.state.errors;
  }

  // ===========================================
  // Context Gathering Metrics (T040)
  // ===========================================

  /**
   * Source names for sub-agent tracking
   */
  private static readonly SUB_AGENT_SOURCES = ['instantly', 'airtable', 'attio', 'kb'] as const;

  /**
   * Record context gathering completion with timing and source outcomes
   *
   * @param durationMs - Time taken to gather context
   * @param cacheHit - Whether research cache was hit
   * @param sourcesUsed - Sources that returned data successfully
   * @param sourceFailures - Sources that failed with reason
   */
  recordContextGathering(
    durationMs: number,
    cacheHit: boolean,
    sourcesUsed: string[],
    sourceFailures: Array<{ source: string; reason: 'timeout' | 'error' | 'not_found' | 'unavailable' }>
  ): void {
    const metrics = this.state.metrics;

    // Update context gather timing
    metrics.context_gather_count++;
    this.updateRunningAverage('avg_context_gather_ms', durationMs, metrics.context_gather_count);

    // Update cache metrics
    metrics.cache_lookups++;
    if (cacheHit) {
      metrics.cache_hits++;
    }
    metrics.cache_hit_rate = metrics.cache_hits / metrics.cache_lookups;

    // Update sub-agent success rates
    for (const source of MeetingPrepStateManager.SUB_AGENT_SOURCES) {
      const rates = metrics.sub_agent_success_rates[source];
      rates.attempts++;

      const failure = sourceFailures.find((f) => f.source === source);
      if (failure) {
        if (failure.reason === 'timeout') {
          rates.timeouts++;
        }
        rates.failures++;
      } else if (sourcesUsed.includes(source)) {
        rates.successes++;
      } else {
        // Source wasn't attempted or returned no data
        rates.failures++;
      }

      // Recalculate rate
      rates.rate = rates.attempts > 0 ? rates.successes / rates.attempts : 0;
    }
  }

  /**
   * Record a single sub-agent outcome (alternative to bulk recording)
   */
  recordSubAgentOutcome(
    source: 'instantly' | 'airtable' | 'attio' | 'kb',
    outcome: 'success' | 'failure' | 'timeout'
  ): void {
    const rates = this.state.metrics.sub_agent_success_rates[source];
    rates.attempts++;

    switch (outcome) {
      case 'success':
        rates.successes++;
        break;
      case 'timeout':
        rates.timeouts++;
        rates.failures++;
        break;
      case 'failure':
        rates.failures++;
        break;
    }

    // Recalculate rate
    rates.rate = rates.attempts > 0 ? rates.successes / rates.attempts : 0;
  }

  /**
   * Get performance metrics summary (T040)
   */
  getPerformanceMetrics(): {
    avgContextGatherMs: number;
    cacheHitRate: number;
    subAgentRates: Record<string, number>;
  } {
    const metrics = this.state.metrics;
    return {
      avgContextGatherMs: Math.round(metrics.avg_context_gather_ms),
      cacheHitRate: Number(metrics.cache_hit_rate.toFixed(3)),
      subAgentRates: {
        instantly: Number(metrics.sub_agent_success_rates.instantly.rate.toFixed(3)),
        airtable: Number(metrics.sub_agent_success_rates.airtable.rate.toFixed(3)),
        attio: Number(metrics.sub_agent_success_rates.attio.rate.toFixed(3)),
        kb: Number(metrics.sub_agent_success_rates.kb.rate.toFixed(3)),
      },
    };
  }

  /**
   * Helper to update running average
   */
  private updateRunningAverage(
    field: 'avg_context_gather_ms' | 'avg_brief_time_ms' | 'avg_analysis_time_ms',
    newValue: number,
    count: number
  ): void {
    if (count === 1) {
      this.state.metrics[field] = newValue;
    } else {
      this.state.metrics[field] =
        (this.state.metrics[field] * (count - 1) + newValue) / count;
    }
  }

  // ===========================================
  // Metrics Access
  // ===========================================

  /**
   * Get session metrics
   */
  getMetrics(): Readonly<SessionMetrics> {
    return this.state.metrics;
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    sessionId: string;
    brainId: string;
    startedAt: string;
    durationMs: number;
    upcomingMeetings: number;
    briefQueueLength: number;
    analysisQueueLength: number;
    briefsGenerated: number;
    briefsDelivered: number;
    briefsFailed: number;
    analysesCompleted: number;
    avgBriefTimeMs: number;
    avgAnalysisTimeMs: number;
    errorsCount: number;
    // T040: Context gathering performance
    avgContextGatherMs: number;
    cacheHitRate: number;
    subAgentSuccessRates: Record<string, number>;
  } {
    const now = new Date();
    const started = new Date(this.state.started_at);
    const durationMs = now.getTime() - started.getTime();
    const perfMetrics = this.getPerformanceMetrics();

    return {
      sessionId: this.state.session_id,
      brainId: this.state.brain_id,
      startedAt: this.state.started_at,
      durationMs,
      upcomingMeetings: this.state.upcoming_meetings.length,
      briefQueueLength: this.state.brief_queue.length,
      analysisQueueLength: this.state.analysis_queue.length,
      briefsGenerated: this.state.metrics.briefs_generated,
      briefsDelivered: this.state.metrics.briefs_delivered,
      briefsFailed: this.state.metrics.briefs_failed,
      analysesCompleted: this.state.metrics.analyses_completed,
      avgBriefTimeMs: Math.round(this.state.metrics.avg_brief_time_ms),
      avgAnalysisTimeMs: Math.round(this.state.metrics.avg_analysis_time_ms),
      errorsCount: this.state.errors.length,
      // T040: Context gathering performance
      avgContextGatherMs: perfMetrics.avgContextGatherMs,
      cacheHitRate: perfMetrics.cacheHitRate,
      subAgentSuccessRates: perfMetrics.subAgentRates,
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
  }

  /**
   * Clear queues only (keep history)
   */
  clearQueues(): void {
    this.state.brief_queue = [];
    this.state.analysis_queue = [];
  }
}

// ===========================================
// Factory Functions
// ===========================================

/**
 * Load or create state manager
 */
export async function loadStateManager(
  brainId: BrainId,
  statePath?: string
): Promise<MeetingPrepStateManager> {
  const manager = new MeetingPrepStateManager(brainId, statePath);
  await manager.load();
  return manager;
}

/**
 * Create fresh state manager (no load)
 */
export function createStateManager(
  brainId: BrainId,
  statePath?: string
): MeetingPrepStateManager {
  return new MeetingPrepStateManager(brainId, statePath);
}
