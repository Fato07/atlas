/**
 * Meeting Prep Agent - Structured Logger
 *
 * Implements structured JSON logging per FR-015 with all required event types.
 * Events include: brief_requested, context_gathered, brief_generated, brief_delivered,
 * brief_failed, analysis_requested, analysis_completed, crm_updated.
 *
 * @module meeting-prep/logger
 */

import type {
  LogEvent,
  LogEventType,
  BriefRequestedEvent,
  ContextGatheredEvent,
  BriefGeneratedEvent,
  BriefDeliveredEvent,
  BriefFailedEvent,
  AnalysisRequestedEvent,
  AnalysisFailedEvent,
  AnalysisCompletedEvent,
  CRMUpdatedEvent,
} from './types';

// ===========================================
// Logger Configuration
// ===========================================

export interface LoggerConfig {
  /** Minimum log level to output */
  level: 'debug' | 'info' | 'warn' | 'error';

  /** Output format */
  format: 'json' | 'pretty';

  /** Include stack traces in errors */
  includeStack: boolean;

  /** Additional metadata to include in all logs */
  metadata?: Record<string, unknown>;
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  format: 'json',
  includeStack: true,
};

// ===========================================
// Log Level Utilities
// ===========================================

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

function shouldLog(
  currentLevel: LoggerConfig['level'],
  targetLevel: LoggerConfig['level']
): boolean {
  return LOG_LEVELS[currentLevel] <= LOG_LEVELS[targetLevel];
}

// ===========================================
// Logger Class
// ===========================================

export class MeetingPrepLogger {
  private config: LoggerConfig;
  private sessionId?: string;
  private brainId?: string;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================
  // Configuration
  // ===========================================

  /**
   * Set session context for all subsequent logs
   */
  setSession(sessionId: string, brainId: string): void {
    this.sessionId = sessionId;
    this.brainId = brainId;
  }

  /**
   * Update logger configuration
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ===========================================
  // Core Logging Methods
  // ===========================================

  private formatOutput(event: LogEvent): string {
    const enriched = {
      ...event,
      session_id: this.sessionId,
      ...this.config.metadata,
    };

    if (this.config.format === 'json') {
      return JSON.stringify(enriched);
    }

    // Pretty format
    const { event: eventType, timestamp, meeting_id, brain_id, ...rest } = enriched;
    const time = new Date(timestamp).toISOString().split('T')[1];
    return `[${time}] ${eventType.toUpperCase()} meeting=${meeting_id} brain=${brain_id} ${JSON.stringify(rest)}`;
  }

  private output(level: 'debug' | 'info' | 'warn' | 'error', event: LogEvent): void {
    if (!shouldLog(this.config.level, level)) {
      return;
    }

    const formatted = this.formatOutput(event);

    switch (level) {
      case 'debug':
        console.debug(formatted);
        break;
      case 'info':
        console.log(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }
  }

  // ===========================================
  // Event Logging Methods (FR-015)
  // ===========================================

  /**
   * Log brief_requested event
   */
  briefRequested(params: {
    meeting_id: string;
    brain_id: string;
    source: 'calendar_webhook' | 'manual_request';
    attendee_email: string;
    meeting_start: string;
  }): void {
    const event: BriefRequestedEvent = {
      event: 'brief_requested',
      timestamp: new Date().toISOString(),
      meeting_id: params.meeting_id,
      brain_id: params.brain_id,
      source: params.source,
      attendee_email: params.attendee_email,
      meeting_start: params.meeting_start,
    };

    this.output('info', event);
  }

  /**
   * Log context_gathered event
   */
  contextGathered(params: {
    meeting_id: string;
    brain_id: string;
    brief_id: string;
    sources_used: string[];
    duration_ms: number;
    cache_hit: boolean;
  }): void {
    const event: ContextGatheredEvent = {
      event: 'context_gathered',
      timestamp: new Date().toISOString(),
      meeting_id: params.meeting_id,
      brain_id: params.brain_id,
      brief_id: params.brief_id,
      sources_used: params.sources_used,
      duration_ms: params.duration_ms,
      cache_hit: params.cache_hit,
    };

    this.output('info', event);
  }

  /**
   * Log brief_generated event
   */
  briefGenerated(params: {
    meeting_id: string;
    brain_id: string;
    brief_id: string;
    sections_generated: string[];
    tokens_used: number;
    duration_ms: number;
  }): void {
    const event: BriefGeneratedEvent = {
      event: 'brief_generated',
      timestamp: new Date().toISOString(),
      meeting_id: params.meeting_id,
      brain_id: params.brain_id,
      brief_id: params.brief_id,
      sections_generated: params.sections_generated,
      tokens_used: params.tokens_used,
      duration_ms: params.duration_ms,
    };

    this.output('info', event);
  }

  /**
   * Log brief_delivered event
   */
  briefDelivered(params: {
    meeting_id: string;
    brain_id: string;
    brief_id: string;
    slack_channel: string;
    slack_message_ts: string;
    total_processing_ms: number;
  }): void {
    const event: BriefDeliveredEvent = {
      event: 'brief_delivered',
      timestamp: new Date().toISOString(),
      meeting_id: params.meeting_id,
      brain_id: params.brain_id,
      brief_id: params.brief_id,
      slack_channel: params.slack_channel,
      slack_message_ts: params.slack_message_ts,
      total_processing_ms: params.total_processing_ms,
    };

    this.output('info', event);
  }

  /**
   * Log brief_failed event
   */
  briefFailed(params: {
    meeting_id: string;
    brain_id: string;
    brief_id?: string;
    error_code: string;
    error_message: string;
    retry_count: number;
    recoverable: boolean;
  }): void {
    const event: BriefFailedEvent = {
      event: 'brief_failed',
      timestamp: new Date().toISOString(),
      meeting_id: params.meeting_id,
      brain_id: params.brain_id,
      brief_id: params.brief_id,
      error_code: params.error_code,
      error_message: params.error_message,
      retry_count: params.retry_count,
      recoverable: params.recoverable,
    };

    this.output('error', event);
  }

  /**
   * Log analysis_requested event
   */
  analysisRequested(params: {
    meeting_id: string;
    brain_id: string;
    transcript_source: 'fireflies' | 'otter' | 'manual' | 'slack_form';
    transcript_length: number;
  }): void {
    const event: AnalysisRequestedEvent = {
      event: 'analysis_requested',
      timestamp: new Date().toISOString(),
      meeting_id: params.meeting_id,
      brain_id: params.brain_id,
      transcript_source: params.transcript_source,
      transcript_length: params.transcript_length,
    };

    this.output('info', event);
  }

  /**
   * Log analysis_failed event
   */
  analysisFailed(params: {
    meeting_id: string;
    brain_id: string;
    analysis_id?: string;
    error_code: string;
    error_message: string;
    retry_count: number;
    recoverable: boolean;
  }): void {
    const event: AnalysisFailedEvent = {
      event: 'analysis_failed',
      timestamp: new Date().toISOString(),
      meeting_id: params.meeting_id,
      brain_id: params.brain_id,
      analysis_id: params.analysis_id,
      error_code: params.error_code,
      error_message: params.error_message,
      retry_count: params.retry_count,
      recoverable: params.recoverable,
    };

    this.output('error', event);
  }

  /**
   * Log analysis_completed event
   */
  analysisCompleted(params: {
    meeting_id: string;
    brain_id: string;
    analysis_id: string;
    bant_score: number;
    recommendation: 'hot' | 'warm' | 'nurture' | 'disqualify';
    objections_count: number;
    action_items_count: number;
    duration_ms: number;
  }): void {
    const event: AnalysisCompletedEvent = {
      event: 'analysis_completed',
      timestamp: new Date().toISOString(),
      meeting_id: params.meeting_id,
      brain_id: params.brain_id,
      analysis_id: params.analysis_id,
      bant_score: params.bant_score,
      recommendation: params.recommendation,
      objections_count: params.objections_count,
      action_items_count: params.action_items_count,
      duration_ms: params.duration_ms,
    };

    this.output('info', event);
  }

  /**
   * Log crm_updated event
   */
  crmUpdated(params: {
    meeting_id: string;
    brain_id: string;
    analysis_id: string;
    attio_updated: boolean;
    attio_tasks_created: number;
    airtable_updated: boolean;
    pipeline_stage?: string;
  }): void {
    const event: CRMUpdatedEvent = {
      event: 'crm_updated',
      timestamp: new Date().toISOString(),
      meeting_id: params.meeting_id,
      brain_id: params.brain_id,
      analysis_id: params.analysis_id,
      attio_updated: params.attio_updated,
      attio_tasks_created: params.attio_tasks_created,
      airtable_updated: params.airtable_updated,
      pipeline_stage: params.pipeline_stage,
    };

    this.output('info', event);
  }

  // ===========================================
  // Convenience Methods
  // ===========================================

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog(this.config.level, 'debug')) return;

    const logEntry = {
      level: 'debug',
      message,
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      brain_id: this.brainId,
      ...context,
    };

    if (this.config.format === 'json') {
      console.debug(JSON.stringify(logEntry));
    } else {
      console.debug(`[DEBUG] ${message}`, context ?? '');
    }
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog(this.config.level, 'info')) return;

    const logEntry = {
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      brain_id: this.brainId,
      ...context,
    };

    if (this.config.format === 'json') {
      console.log(JSON.stringify(logEntry));
    } else {
      console.log(`[INFO] ${message}`, context ?? '');
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog(this.config.level, 'warn')) return;

    const logEntry = {
      level: 'warn',
      message,
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      brain_id: this.brainId,
      ...context,
    };

    if (this.config.format === 'json') {
      console.warn(JSON.stringify(logEntry));
    } else {
      console.warn(`[WARN] ${message}`, context ?? '');
    }
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    const logEntry: Record<string, unknown> = {
      level: 'error',
      message,
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      brain_id: this.brainId,
      ...context,
    };

    if (error instanceof Error) {
      logEntry.error_name = error.name;
      logEntry.error_message = error.message;
      if (this.config.includeStack) {
        logEntry.stack = error.stack;
      }
    } else if (error !== undefined) {
      logEntry.error = String(error);
    }

    if (this.config.format === 'json') {
      console.error(JSON.stringify(logEntry));
    } else {
      console.error(`[ERROR] ${message}`, error ?? '', context ?? '');
    }
  }

  // ===========================================
  // Metrics Helpers
  // ===========================================

  /**
   * Create a timer for measuring durations
   */
  startTimer(): () => number {
    const start = performance.now();
    return () => Math.round(performance.now() - start);
  }

  /**
   * Log with timing
   */
  timed<T>(
    operation: string,
    fn: () => T | Promise<T>,
    context?: Record<string, unknown>
  ): T | Promise<T> {
    const timer = this.startTimer();

    const handleResult = (result: T): T => {
      this.debug(`${operation} completed`, {
        ...context,
        duration_ms: timer(),
      });
      return result;
    };

    const handleError = (error: Error): never => {
      this.error(`${operation} failed`, error, {
        ...context,
        duration_ms: timer(),
      });
      throw error;
    };

    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.then(handleResult).catch(handleError);
      }
      return handleResult(result);
    } catch (error) {
      return handleError(error as Error);
    }
  }
}

// ===========================================
// Factory Functions
// ===========================================

/**
 * Create a new logger instance
 */
export function createLogger(config?: Partial<LoggerConfig>): MeetingPrepLogger {
  return new MeetingPrepLogger(config);
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(
  parent: MeetingPrepLogger,
  context: Record<string, unknown>
): MeetingPrepLogger {
  const config = {
    metadata: context,
  };
  return new MeetingPrepLogger(config);
}

// ===========================================
// Singleton Instance
// ===========================================

let defaultLogger: MeetingPrepLogger | null = null;

/**
 * Get or create the default logger
 */
export function getLogger(): MeetingPrepLogger {
  if (!defaultLogger) {
    defaultLogger = new MeetingPrepLogger();
  }
  return defaultLogger;
}

/**
 * Set the default logger
 */
export function setLogger(logger: MeetingPrepLogger): void {
  defaultLogger = logger;
}
