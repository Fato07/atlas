/**
 * Lead Scorer Agent Types
 *
 * Internal types used by the lead scorer agent.
 * For contract types, see ./contracts/
 *
 * @module lead-scorer/types
 */

import type { BrainId, ScoringTier, MessagingAngle, VerticalRegistry } from '@atlas-gtm/lib';

// ===========================================
// Agent State Types
// ===========================================

/**
 * Session state for batch processing
 * Stored in state/lead-scorer-state.json
 */
export interface LeadScorerState {
  session_id: string;
  brain_id: BrainId;
  started_at: string; // ISO 8601
  checkpoint_at: string; // ISO 8601, updated after each lead

  batch: BatchProgress;
  decisions: ScoringDecision[];
  learnings: string[]; // Insights discovered during session
}

/**
 * Batch processing progress
 */
export interface BatchProgress {
  total_leads: number;
  processed: number;
  remaining_ids: string[];
}

/**
 * Individual scoring decision (lightweight for state)
 */
export interface ScoringDecision {
  lead_id: string;
  score: number;
  tier: ScoringTier;
  angle?: MessagingAngle;
  timestamp: string;
}

// ===========================================
// Configuration Types
// ===========================================

/**
 * Lead scorer agent configuration
 */
export interface LeadScorerConfig {
  /** Context budget in tokens (default: 80,000) */
  contextBudget: number;

  /** Checkpoint interval for batch processing (default: 10 leads) */
  checkpointInterval: number;

  /** Maximum rules to query per attribute (default: 50) */
  maxRulesPerQuery: number;

  /** Enable brain caching (default: true) */
  enableBrainCache: boolean;

  /** Request timeout in ms (default: 10,000) */
  timeoutMs: number;

  /** Anthropic API key for angle inference (optional, uses env var if not set) */
  anthropicApiKey?: string;

  /** Use heuristics only for angle inference (default: true, faster but less accurate) */
  useHeuristicsForAngle?: boolean;

  /** Vertical registry for data-driven vertical detection (optional, creates default if not set) */
  verticalRegistry?: VerticalRegistry;
}

/**
 * Default configuration values
 */
export const DEFAULT_LEAD_SCORER_CONFIG: LeadScorerConfig = {
  contextBudget: 80_000,
  checkpointInterval: 10,
  maxRulesPerQuery: 50,
  enableBrainCache: true,
  timeoutMs: 10_000,
  useHeuristicsForAngle: true,
};

// ===========================================
// Processing Types
// ===========================================

/**
 * Options for batch scoring
 */
export interface BatchScoringOptions {
  /** Checkpoint interval (leads between saves) */
  checkpointInterval?: number;

  /** Progress callback */
  onProgress?: (processed: number, total: number) => void;

  /** Resume from existing state */
  resumeFromState?: LeadScorerState;
}

/**
 * Batch scoring result summary
 */
export interface BatchScoringResult {
  total_processed: number;
  by_tier: Record<ScoringTier, number>;
  avg_processing_time_ms: number;
  errors: BatchScoringError[];
}

/**
 * Error encountered during batch processing
 */
export interface BatchScoringError {
  lead_id: string;
  error_code: string;
  message: string;
}

/**
 * Record of a previously scored lead
 * Used for duplicate detection per FR-014
 */
export interface ScoredLeadRecord {
  lead_id: string;
  score: number;
  scored_at: string;
  data_hash?: string;
}

/**
 * Duplicate check result
 */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingRecord?: ScoredLeadRecord;
  shouldRescore: boolean;
  reason: 'not_found' | 'force_rescore' | 'data_changed' | 'already_scored';
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

// ===========================================
// Vertical Detection Types
// ===========================================

/** Detection method used */
export type VerticalDetectionMethod =
  | 'explicit'      // Explicit vertical field provided
  | 'industry'      // Industry keyword match
  | 'title'         // Title keyword match
  | 'campaign'      // Campaign pattern match
  | 'ai'            // AI classification fallback
  | 'default';      // Default fallback

/**
 * Vertical detection result
 */
export interface VerticalDetectionResult {
  /** Detected vertical slug */
  vertical: string;
  /** Detection confidence (0-1) */
  confidence: number;
  /** All signals considered during detection */
  signals: VerticalSignal[];
  /** Detection method used (optional for backwards compatibility) */
  method?: VerticalDetectionMethod;
  /** Reasoning for the detection (from AI if applicable) */
  reasoning?: string;
}

/**
 * Signal used for vertical detection
 */
export interface VerticalSignal {
  /** Attribute that matched (e.g., "industry", "title") */
  attribute: string;
  /** Value from lead data */
  value: string;
  /** Matched vertical slug */
  matched_vertical: string;
  /** Signal weight/confidence */
  weight: number;
  /** Matched keyword or pattern (optional) */
  matched_keyword?: string;
}

// ===========================================
// Angle Recommendation Types
// ===========================================

/**
 * Context for angle recommendation
 */
export interface AngleRecommendationContext {
  lead_id: string;
  vertical: string;
  top_signals: TopSignal[];
  company_context: {
    size?: number;
    industry?: string;
    funding_stage?: string;
  };
}

/**
 * Top scoring signal for angle inference
 */
export interface TopSignal {
  attribute: string;
  value: unknown;
  score: number;
  reasoning: string;
}

/**
 * Result from angle recommendation
 */
export interface AngleRecommendationResult {
  angle: MessagingAngle;
  confidence: number;
  personalization_hints: string[];
  reasoning: string;
}

// ===========================================
// Logging Event Types
// ===========================================

/**
 * Structured logging event types
 */
export type LogEventType =
  | 'lead_scored'
  | 'scoring_failed'
  | 'rule_evaluated'
  | 'batch_started'
  | 'batch_completed'
  | 'checkpoint_saved'
  | 'vertical_detected'
  | 'angle_recommended'
  | 'webhook_received';

/**
 * Base log event structure
 */
export interface LogEvent {
  event: LogEventType;
  timestamp: string;
  session_id?: string;
  lead_id?: string;
  brain_id?: string;
  metadata?: Record<string, unknown>;
}
