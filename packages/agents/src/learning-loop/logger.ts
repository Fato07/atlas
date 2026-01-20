/**
 * Learning Loop Logger
 *
 * Structured logging for the Learning Loop agent with JSON output.
 * Implements FR-032: Structured log events for core lifecycle operations.
 *
 * @module learning-loop/logger
 */

import type {
  LogEvent,
  LogEventType,
  InsightExtractedEvent,
  QualityGatePassedEvent,
  QualityGateFailedEvent,
  ValidationRequestedEvent,
  ValidationCompletedEvent,
  KBWriteSuccessEvent,
  KBWriteFailedEvent,
} from './types';
import type { InsightCategory, InsightImportance } from './contracts';

// ===========================================
// Logger Configuration
// ===========================================

export interface LoggerConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  pretty: boolean;
  includeTimestamp: boolean;
}

const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  level: 'info',
  pretty: process.env.NODE_ENV !== 'production',
  includeTimestamp: true,
};

// ===========================================
// Log Levels
// ===========================================

const LOG_LEVELS: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// ===========================================
// Logger Class
// ===========================================

export class LearningLoopLogger {
  private readonly config: LoggerConfig;
  private readonly context: Record<string, unknown>;

  constructor(config?: Partial<LoggerConfig>, context?: Record<string, unknown>) {
    this.config = { ...DEFAULT_LOGGER_CONFIG, ...config };
    this.context = context ?? {};
  }

  // ===========================================
  // Core Logging Methods
  // ===========================================

  private shouldLog(level: string): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private formatMessage(
    level: string,
    message: string,
    data?: Record<string, unknown>
  ): string {
    const entry: Record<string, unknown> = {
      ...this.context,
      level,
      message,
      ...data,
    };

    if (this.config.includeTimestamp) {
      entry.timestamp = new Date().toISOString();
    }

    if (this.config.pretty) {
      return JSON.stringify(entry, null, 2);
    }
    return JSON.stringify(entry);
  }

  private log(level: string, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.formatMessage(level, message, data);

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  // ===========================================
  // Event Logging Methods (FR-032)
  // ===========================================

  /**
   * Log insight extraction event
   */
  insightExtracted(params: {
    brainId: string;
    sourceType: 'email_reply' | 'call_transcript';
    sourceId: string;
    insightCount: number;
    categories: InsightCategory[];
    durationMs: number;
  }): void {
    const event: InsightExtractedEvent = {
      event: 'insight_extracted',
      brain_id: params.brainId,
      timestamp: new Date().toISOString(),
      duration_ms: params.durationMs,
      source_type: params.sourceType,
      source_id: params.sourceId,
      insight_count: params.insightCount,
      categories: params.categories,
    };

    this.info(
      `Extracted ${params.insightCount} insights from ${params.sourceType}`,
      event as unknown as Record<string, unknown>
    );
  }

  /**
   * Log quality gate passed event
   */
  qualityGatePassed(params: {
    brainId: string;
    insightId: string;
    confidence: number;
    autoApproved: boolean;
    durationMs: number;
  }): void {
    const event: QualityGatePassedEvent = {
      event: 'quality_gate_passed',
      brain_id: params.brainId,
      timestamp: new Date().toISOString(),
      duration_ms: params.durationMs,
      insight_id: params.insightId,
      confidence: params.confidence,
      auto_approved: params.autoApproved,
    };

    this.info(
      `Quality gate passed for insight ${params.insightId} (auto_approved: ${params.autoApproved})`,
      event as unknown as Record<string, unknown>
    );
  }

  /**
   * Log quality gate failed event
   */
  qualityGateFailed(params: {
    brainId: string;
    insightId: string;
    reason: 'low_confidence' | 'duplicate' | 'rejected';
    details: string;
    durationMs: number;
  }): void {
    const event: QualityGateFailedEvent = {
      event: 'quality_gate_failed',
      brain_id: params.brainId,
      timestamp: new Date().toISOString(),
      duration_ms: params.durationMs,
      insight_id: params.insightId,
      reason: params.reason,
      details: params.details,
    };

    this.info(
      `Quality gate failed for insight ${params.insightId}: ${params.reason}`,
      event as unknown as Record<string, unknown>
    );
  }

  /**
   * Log validation requested event
   */
  validationRequested(params: {
    brainId: string;
    insightId: string;
    validationId: string;
    importance: InsightImportance;
    slackChannel: string;
  }): void {
    const event: ValidationRequestedEvent = {
      event: 'validation_requested',
      brain_id: params.brainId,
      timestamp: new Date().toISOString(),
      insight_id: params.insightId,
      validation_id: params.validationId,
      importance: params.importance,
      slack_channel: params.slackChannel,
    };

    this.info(
      `Validation requested for insight ${params.insightId} (importance: ${params.importance})`,
      event as unknown as Record<string, unknown>
    );
  }

  /**
   * Log validation completed event
   */
  validationCompleted(params: {
    brainId: string;
    validationId: string;
    insightId: string;
    decision: 'approved' | 'rejected';
    validator: string;
    decisionTimeMs: number;
  }): void {
    const event: ValidationCompletedEvent = {
      event: 'validation_completed',
      brain_id: params.brainId,
      timestamp: new Date().toISOString(),
      validation_id: params.validationId,
      insight_id: params.insightId,
      decision: params.decision,
      validator: params.validator,
      decision_time_ms: params.decisionTimeMs,
    };

    this.info(
      `Validation ${params.decision} for insight ${params.insightId} by ${params.validator}`,
      event as unknown as Record<string, unknown>
    );
  }

  /**
   * Log KB write success event
   */
  kbWriteSuccess(params: {
    brainId: string;
    insightId: string;
    qdrantId: string;
    category: InsightCategory;
    durationMs: number;
  }): void {
    const event: KBWriteSuccessEvent = {
      event: 'kb_write_success',
      brain_id: params.brainId,
      timestamp: new Date().toISOString(),
      duration_ms: params.durationMs,
      insight_id: params.insightId,
      qdrant_id: params.qdrantId,
      category: params.category,
    };

    this.info(
      `KB write success for insight ${params.insightId}`,
      event as unknown as Record<string, unknown>
    );
  }

  /**
   * Log KB write failed event
   */
  kbWriteFailed(params: {
    brainId: string;
    insightId: string;
    error: string;
    retryCount: number;
  }): void {
    const event: KBWriteFailedEvent = {
      event: 'kb_write_failed',
      brain_id: params.brainId,
      timestamp: new Date().toISOString(),
      insight_id: params.insightId,
      error: params.error,
      retry_count: params.retryCount,
    };

    this.error(
      `KB write failed for insight ${params.insightId}: ${params.error}`,
      event as unknown as Record<string, unknown>
    );
  }

  // ===========================================
  // Child Logger Creation
  // ===========================================

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: Record<string, unknown>): LearningLoopLogger {
    return new LearningLoopLogger(this.config, {
      ...this.context,
      ...additionalContext,
    });
  }
}

// ===========================================
// Module-level Logger Instance
// ===========================================

let moduleLogger: LearningLoopLogger | null = null;

/**
 * Create a new logger instance
 */
export function createLogger(
  config?: Partial<LoggerConfig>,
  context?: Record<string, unknown>
): LearningLoopLogger {
  return new LearningLoopLogger(config, context);
}

/**
 * Create a child logger from the module logger
 */
export function createChildLogger(context: Record<string, unknown>): LearningLoopLogger {
  const parent = getLogger();
  return parent.child(context);
}

/**
 * Get or create the module-level logger
 */
export function getLogger(): LearningLoopLogger {
  if (!moduleLogger) {
    moduleLogger = createLogger();
  }
  return moduleLogger;
}

/**
 * Set the module-level logger
 */
export function setLogger(logger: LearningLoopLogger): void {
  moduleLogger = logger;
}
