/**
 * Learning Loop Agent - Internal Types
 *
 * Internal type definitions for the learning loop agent.
 * These types are not exported publicly and are used within the module.
 *
 * @module learning-loop/types
 */

import type { InsightCategory, InsightImportance, ValidationStatus } from './contracts';

// ===========================================
// Agent Configuration
// ===========================================

/**
 * Learning loop agent configuration
 */
export interface LearningLoopConfig {
  // Context limits
  context_budget_tokens: number; // Default: 60000 (per spec)

  // Quality gate thresholds
  quality_gates: {
    confidence_threshold: number; // Default: 0.7 (FR-006)
    duplicate_similarity_threshold: number; // Default: 0.85 (FR-007)
    auto_approve_confidence: number; // Default: 0.8 (FR-010)
  };

  // Validation settings
  validation: {
    reminder_hours: number; // Default: 48 (FR-015)
    max_reminders: number; // Default: 2
  };

  // Slack configuration
  slack: {
    validation_channel: string;
    synthesis_channel: string;
  };

  // Weekly synthesis
  synthesis: {
    schedule_cron: string; // Default: '0 9 * * 1' (Monday 9am)
    lookback_days: number; // Default: 7
  };

  // Feature flags
  features: {
    auto_approve_medium_importance: boolean;
    track_template_performance: boolean;
    send_weekly_synthesis: boolean;
    archive_old_insights: boolean;
  };
}

/**
 * Default agent configuration
 */
export const DEFAULT_CONFIG: LearningLoopConfig = {
  context_budget_tokens: 60000,
  quality_gates: {
    confidence_threshold: 0.7,
    duplicate_similarity_threshold: 0.85,
    auto_approve_confidence: 0.8,
  },
  validation: {
    reminder_hours: 48,
    max_reminders: 2,
  },
  slack: {
    validation_channel: 'learning-loop-validations',
    synthesis_channel: 'learning-loop-reports',
  },
  synthesis: {
    schedule_cron: '0 9 * * 1', // Monday 9am
    lookback_days: 7,
  },
  features: {
    auto_approve_medium_importance: true,
    track_template_performance: true,
    send_weekly_synthesis: true,
    archive_old_insights: true,
  },
};

// ===========================================
// Session State Types
// ===========================================

/**
 * Pending insight in extraction queue
 */
export interface PendingExtraction {
  job_id: string;
  source_type: 'email_reply' | 'call_transcript';
  source_id: string;
  brain_id: string;
  queued_at: string;
  started_at: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  error: string | null;
}

/**
 * Pending validation tracking
 */
export interface PendingValidation {
  validation_id: string;
  insight_id: string;
  brain_id: string;
  created_at: string;
  reminder_count: number;
  last_reminder_at: string | null;
}

/**
 * Recent insight for dedup check cache
 */
export interface RecentInsight {
  insight_id: string;
  content_hash: string;
  category: InsightCategory;
  created_at: string;
}

/**
 * Session error tracking
 */
export interface SessionError {
  error_type: string;
  message: string;
  occurred_at: string;
  context: Record<string, unknown>;
  recovered: boolean;
}

/**
 * Session metrics
 */
export interface SessionMetrics {
  insights_extracted: number;
  insights_validated: number;
  insights_auto_approved: number;
  insights_rejected: number;
  kb_writes: number;
  extraction_errors: number;
  avg_extraction_ms: number;
  session_start: string;
}

/**
 * Learning loop session state (persisted to state/learning-loop-state.json)
 */
export interface LearningLoopState {
  // Version for state migration
  version: number;

  // Current brain context
  active_brain_id: string | null;

  // Processing queues
  pending_extractions: PendingExtraction[];
  pending_validations: PendingValidation[];

  // Recent insights for dedup (last 24 hours)
  recent_insights: RecentInsight[];

  // Session tracking
  session_start: string;
  last_activity: string;
  errors: SessionError[];
  metrics: SessionMetrics;

  // Checkpoint for recovery
  last_checkpoint: string;
}

// ===========================================
// Processing Types
// ===========================================

/**
 * Extraction request from upstream agents
 */
export interface ExtractionRequest {
  source_type: 'email_reply' | 'call_transcript';
  source_id: string;
  content: string;
  thread_context?: string;
  lead: {
    id: string;
    company_id?: string;
    company_name?: string;
    industry?: string;
  };
  brain_id: string;
  template_used_id?: string;
}

/**
 * Extraction result from Claude
 */
export interface ExtractionResult {
  success: boolean;
  insights: Array<{
    category: InsightCategory;
    content: string;
    extracted_quote: string | null;
    importance: InsightImportance;
    actionable: boolean;
    action_suggestion: string | null;
    initial_confidence: number;
  }>;
  extraction_time_ms: number;
  error?: string;
}

/**
 * Quality gate evaluation result
 */
export interface QualityGateEvaluation {
  passed: boolean;
  requires_validation: boolean;
  auto_approved: boolean;
  gates: {
    confidence: {
      passed: boolean;
      score: number;
      threshold: number;
    };
    duplicate: {
      passed: boolean;
      is_duplicate: boolean;
      similar_id: string | null;
      similarity: number | null;
    };
    importance: {
      level: InsightImportance;
      requires_validation: boolean;
      reason: string;
    };
  };
}

/**
 * KB write result
 */
export interface KBWriteResult {
  success: boolean;
  insight_id: string;
  qdrant_id: string;
  error?: string;
}

// ===========================================
// Logging Types
// ===========================================

/**
 * Log event types (FR-032)
 */
export type LogEventType =
  | 'insight_extracted'
  | 'quality_gate_passed'
  | 'quality_gate_failed'
  | 'validation_requested'
  | 'validation_completed'
  | 'kb_write_success'
  | 'kb_write_failed'
  | 'synthesis_started'
  | 'synthesis_completed'
  | 'template_outcome_recorded';

/**
 * Base log event
 */
export interface BaseLogEvent {
  event: LogEventType;
  brain_id: string;
  timestamp: string;
  duration_ms?: number;
}

/**
 * Insight extracted event
 */
export interface InsightExtractedEvent extends BaseLogEvent {
  event: 'insight_extracted';
  source_type: 'email_reply' | 'call_transcript';
  source_id: string;
  insight_count: number;
  categories: InsightCategory[];
}

/**
 * Quality gate passed event
 */
export interface QualityGatePassedEvent extends BaseLogEvent {
  event: 'quality_gate_passed';
  insight_id: string;
  confidence: number;
  auto_approved: boolean;
}

/**
 * Quality gate failed event
 */
export interface QualityGateFailedEvent extends BaseLogEvent {
  event: 'quality_gate_failed';
  insight_id: string;
  reason: 'low_confidence' | 'duplicate' | 'rejected';
  details: string;
}

/**
 * Validation requested event
 */
export interface ValidationRequestedEvent extends BaseLogEvent {
  event: 'validation_requested';
  insight_id: string;
  validation_id: string;
  importance: InsightImportance;
  slack_channel: string;
}

/**
 * Validation completed event
 */
export interface ValidationCompletedEvent extends BaseLogEvent {
  event: 'validation_completed';
  validation_id: string;
  insight_id: string;
  decision: 'approved' | 'rejected';
  validator: string;
  decision_time_ms: number;
}

/**
 * KB write success event
 */
export interface KBWriteSuccessEvent extends BaseLogEvent {
  event: 'kb_write_success';
  insight_id: string;
  qdrant_id: string;
  category: InsightCategory;
}

/**
 * KB write failed event
 */
export interface KBWriteFailedEvent extends BaseLogEvent {
  event: 'kb_write_failed';
  insight_id: string;
  error: string;
  retry_count: number;
}

/**
 * All log event types
 */
export type LogEvent =
  | InsightExtractedEvent
  | QualityGatePassedEvent
  | QualityGateFailedEvent
  | ValidationRequestedEvent
  | ValidationCompletedEvent
  | KBWriteSuccessEvent
  | KBWriteFailedEvent;

// ===========================================
// State Creation Helper
// ===========================================

/**
 * Create initial state for new session
 */
export function createInitialState(brainId?: string): LearningLoopState {
  const now = new Date().toISOString();

  return {
    version: 1,
    active_brain_id: brainId ?? null,
    pending_extractions: [],
    pending_validations: [],
    recent_insights: [],
    session_start: now,
    last_activity: now,
    errors: [],
    metrics: {
      insights_extracted: 0,
      insights_validated: 0,
      insights_auto_approved: 0,
      insights_rejected: 0,
      kb_writes: 0,
      extraction_errors: 0,
      avg_extraction_ms: 0,
      session_start: now,
    },
    last_checkpoint: now,
  };
}
