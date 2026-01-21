/**
 * Structured JSON Logger for Lead Scorer
 *
 * Provides structured logging for lead scoring events:
 * - lead_scored: Successful lead scoring
 * - scoring_failed: Error during scoring
 * - rule_evaluated: Individual rule evaluation
 * - batch_started: Batch processing started
 * - batch_completed: Batch processing completed
 * - checkpoint_saved: State checkpoint saved
 * - vertical_detected: Vertical detection result
 * - angle_recommended: Angle recommendation result
 *
 * @module lead-scorer/logger
 */

import type { ScoringTier, MessagingAngle, BrainId } from '@atlas-gtm/lib';
import type { LogEventType, LogEvent } from './types';

// ===========================================
// Logger Configuration
// ===========================================

export interface LoggerConfig {
  /** Minimum log level to output */
  level: 'debug' | 'info' | 'warn' | 'error';

  /** Include timestamps in output */
  includeTimestamp: boolean;

  /** Pretty print JSON (development only) */
  prettyPrint: boolean;

  /** Custom output function (defaults to console.log) */
  output?: (message: string) => void;
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  includeTimestamp: true,
  prettyPrint: process.env.NODE_ENV !== 'production',
};

const LOG_LEVEL_PRIORITY: Record<LoggerConfig['level'], number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ===========================================
// Logger Class
// ===========================================

export class LeadScorerLogger {
  private config: LoggerConfig;
  private sessionId?: string;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set session ID for all subsequent log entries
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Check if log level should be output
   */
  private shouldLog(level: LoggerConfig['level']): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }

  /**
   * Format and output log entry
   */
  private log(
    level: LoggerConfig['level'],
    event: LogEventType,
    data: Record<string, unknown>
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEvent & Record<string, unknown> = {
      event,
      level,
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      ...data,
    };

    // Remove undefined values
    for (const key in entry) {
      if (entry[key] === undefined) {
        delete entry[key];
      }
    }

    const output = this.config.output ?? console.log;
    const message = this.config.prettyPrint
      ? JSON.stringify(entry, null, 2)
      : JSON.stringify(entry);

    output(message);
  }

  // ===========================================
  // Scoring Events
  // ===========================================

  /**
   * Log successful lead scoring
   */
  leadScored(data: {
    lead_id: string;
    score: number;
    tier: ScoringTier;
    angle: MessagingAngle;
    brain_id: string;
    vertical: string;
    rules_evaluated: number;
    processing_time_ms: number;
  }): void {
    this.log('info', 'lead_scored', data);
  }

  /**
   * Log scoring failure
   */
  scoringFailed(data: {
    lead_id: string;
    error_code: string;
    error_message: string;
    brain_id?: string;
    stage?: string;
  }): void {
    this.log('error', 'scoring_failed', data);
  }

  /**
   * Log individual rule evaluation (debug level)
   */
  ruleEvaluated(data: {
    lead_id: string;
    rule_id: string;
    attribute: string;
    value: unknown;
    score: number;
    max_score: number;
    is_knockout?: boolean;
  }): void {
    this.log('debug', 'rule_evaluated', data);
  }

  // ===========================================
  // Batch Events
  // ===========================================

  /**
   * Log batch processing start
   */
  batchStarted(data: {
    batch_id?: string;
    total_leads: number;
    brain_id: string;
  }): void {
    this.log('info', 'batch_started', data);
  }

  /**
   * Log batch processing completion
   */
  batchCompleted(data: {
    batch_id?: string;
    total_processed: number;
    by_tier: Record<ScoringTier, number>;
    avg_processing_time_ms: number;
    errors_count: number;
    total_time_ms: number;
  }): void {
    this.log('info', 'batch_completed', data);
  }

  /**
   * Log state checkpoint saved
   */
  checkpointSaved(data: {
    processed: number;
    remaining: number;
    last_lead_id: string;
  }): void {
    this.log('debug', 'checkpoint_saved', data);
  }

  // ===========================================
  // Detection Events
  // ===========================================

  /**
   * Log vertical detection result
   */
  verticalDetected(data: {
    lead_id: string;
    vertical: string;
    confidence: number;
    method: 'explicit' | 'industry' | 'title' | 'campaign' | 'ai' | 'default';
    signals?: string[];
  }): void {
    this.log('debug', 'vertical_detected', data);
  }

  /**
   * Log angle recommendation
   */
  angleRecommended(data: {
    lead_id: string;
    angle: MessagingAngle;
    confidence: number;
    top_signals: string[];
  }): void {
    this.log('debug', 'angle_recommended', data);
  }

  // ===========================================
  // Webhook Events
  // ===========================================

  /**
   * Log webhook request received
   */
  webhookReceived(data: {
    auth_valid: boolean;
    lead_id?: string;
    status_code: number;
    processing_time_ms?: number;
  }): void {
    const level = data.auth_valid ? 'info' : 'warn';
    this.log(level, 'webhook_received', data);
  }

  // ===========================================
  // Generic Methods
  // ===========================================

  /**
   * Log debug message
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', 'lead_scored', { message, ...data });
  }

  /**
   * Log info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', 'lead_scored', { message, ...data });
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', 'scoring_failed', { message, ...data });
  }

  /**
   * Log error message
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', 'scoring_failed', { message, ...data });
  }
}

// ===========================================
// Default Logger Instance
// ===========================================

/**
 * Default logger instance for the lead scorer module
 */
export const logger = new LeadScorerLogger();

/**
 * Create a new logger with custom configuration
 */
export function createLogger(config?: Partial<LoggerConfig>): LeadScorerLogger {
  return new LeadScorerLogger(config);
}
