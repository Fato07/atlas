/**
 * Reply Handler Agent - Structured Logger
 *
 * Implements structured JSON logging per FR-029 and T045 with all required event types.
 * Events include: reply_received, reply_classified, reply_routed, response_sent,
 * approval_requested, approval_resolved, crm_updated, insight_extracted, processing_error,
 * channels_stopped, workflow_complete, workflow_failed.
 *
 * @module reply-handler/logger
 */

import type {
  LogEvent,
  LogEventType,
  ReplyReceivedEvent,
  ReplyClassifiedEvent,
  ReplyRoutedEvent,
  ResponseSentEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  CRMUpdatedEvent,
  InsightExtractedEvent,
  ProcessingErrorEvent,
  ChannelsStoppedEvent,
  WorkflowCompleteEvent,
  WorkflowFailedEvent,
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

function shouldLog(currentLevel: LoggerConfig['level'], targetLevel: LoggerConfig['level']): boolean {
  return LOG_LEVELS[currentLevel] <= LOG_LEVELS[targetLevel];
}

// ===========================================
// Logger Class
// ===========================================

export class ReplyHandlerLogger {
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
    const { event: eventType, timestamp, reply_id, lead_id, brain_id, ...rest } = enriched;
    const time = new Date(timestamp).toISOString().split('T')[1];
    return `[${time}] ${eventType.toUpperCase()} reply=${reply_id} lead=${lead_id} brain=${brain_id} ${JSON.stringify(rest)}`;
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
  // Event Logging Methods (FR-029)
  // ===========================================

  /**
   * Log reply_received event
   */
  replyReceived(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    source: 'instantly' | 'linkedin' | 'manual';
    thread_id: string;
  }): void {
    const event: ReplyReceivedEvent = {
      event: 'reply_received',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      source: params.source,
      thread_id: params.thread_id,
    };

    this.output('info', event);
  }

  /**
   * Log reply_classified event
   */
  replyClassified(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    intent: string;
    intent_confidence: number;
    sentiment: number;
    complexity: string;
    tokens_used: number;
  }): void {
    const event: ReplyClassifiedEvent = {
      event: 'reply_classified',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      intent: params.intent,
      intent_confidence: params.intent_confidence,
      sentiment: params.sentiment,
      complexity: params.complexity,
      tokens_used: params.tokens_used,
    };

    this.output('info', event);
  }

  /**
   * Log reply_routed event
   */
  replyRouted(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    tier: 1 | 2 | 3;
    reason: string;
    kb_match_confidence?: number;
    override_applied: boolean;
  }): void {
    const event: ReplyRoutedEvent = {
      event: 'reply_routed',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      tier: params.tier,
      reason: params.reason,
      kb_match_confidence: params.kb_match_confidence,
      override_applied: params.override_applied,
    };

    this.output('info', event);
  }

  /**
   * Log response_sent event
   */
  responseSent(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    tier: 1 | 2 | 3;
    template_id?: string;
    personalized: boolean;
  }): void {
    const event: ResponseSentEvent = {
      event: 'response_sent',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      tier: params.tier,
      template_id: params.template_id,
      personalized: params.personalized,
    };

    this.output('info', event);
  }

  /**
   * Log approval_requested event
   */
  approvalRequested(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    draft_id: string;
    slack_channel: string;
    slack_message_ts: string;
    expires_at: string;
  }): void {
    const event: ApprovalRequestedEvent = {
      event: 'approval_requested',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      tier: 2,
      draft_id: params.draft_id,
      slack_channel: params.slack_channel,
      slack_message_ts: params.slack_message_ts,
      expires_at: params.expires_at,
    };

    this.output('info', event);
  }

  /**
   * Log approval_resolved event
   */
  approvalResolved(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    draft_id: string;
    action: 'approved' | 'approved_edited' | 'rejected' | 'escalated' | 'expired';
    resolved_by?: string;
    wait_time_ms: number;
  }): void {
    const event: ApprovalResolvedEvent = {
      event: 'approval_resolved',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      tier: 2,
      draft_id: params.draft_id,
      action: params.action,
      resolved_by: params.resolved_by,
      wait_time_ms: params.wait_time_ms,
    };

    this.output('info', event);
  }

  /**
   * Log crm_updated event
   */
  crmUpdated(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    airtable_updated: boolean;
    airtable_status?: string;
    attio_created: boolean;
    attio_record_id?: string;
    pipeline_stage?: string;
  }): void {
    const event: CRMUpdatedEvent = {
      event: 'crm_updated',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      airtable_updated: params.airtable_updated,
      airtable_status: params.airtable_status,
      attio_created: params.attio_created,
      attio_record_id: params.attio_record_id,
      pipeline_stage: params.pipeline_stage,
    };

    this.output('info', event);
  }

  /**
   * Log insight_extracted event
   */
  insightExtracted(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    category: string;
    importance: string;
    actionable: boolean;
  }): void {
    const event: InsightExtractedEvent = {
      event: 'insight_extracted',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      category: params.category,
      importance: params.importance,
      actionable: params.actionable,
    };

    this.output('info', event);
  }

  /**
   * Log processing_error event
   */
  processingError(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    error_code: string;
    error_message: string;
    recoverable: boolean;
    retry_count: number;
  }): void {
    const event: ProcessingErrorEvent = {
      event: 'processing_error',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      error_code: params.error_code,
      error_message: params.error_message,
      recoverable: params.recoverable,
      retry_count: params.retry_count,
    };

    this.output('error', event);
  }

  /**
   * Log channels_stopped event (T045)
   * For DNC processing when stopping Instantly/HeyReach campaigns
   */
  channelsStopped(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    channels: {
      instantly_stopped: boolean;
      heyreach_stopped: boolean;
    };
    reason: 'unsubscribe' | 'not_interested' | 'bounce' | 'out_of_office' | 'manual';
    campaign_ids?: string[];
  }): void {
    const event: ChannelsStoppedEvent = {
      event: 'channels_stopped',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      channels: params.channels,
      reason: params.reason,
      campaign_ids: params.campaign_ids,
    };

    this.output('info', event);
  }

  /**
   * Log workflow_complete event (T045)
   * When a category workflow completes successfully
   */
  workflowComplete(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    category: 'A' | 'B' | 'C';
    duration_ms: number;
    actions_completed: string[];
    notifications_sent: number;
  }): void {
    const event: WorkflowCompleteEvent = {
      event: 'workflow_complete',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      category: params.category,
      duration_ms: params.duration_ms,
      actions_completed: params.actions_completed,
      notifications_sent: params.notifications_sent,
    };

    this.output('info', event);
  }

  /**
   * Log workflow_failed event (T045)
   * When a category workflow fails
   */
  workflowFailed(params: {
    reply_id: string;
    lead_id: string;
    brain_id: string;
    category: 'A' | 'B' | 'C';
    duration_ms: number;
    failed_step: string;
    error_code: string;
    error_message: string;
    partial_completion: boolean;
    actions_completed: string[];
  }): void {
    const event: WorkflowFailedEvent = {
      event: 'workflow_failed',
      timestamp: new Date().toISOString(),
      reply_id: params.reply_id,
      lead_id: params.lead_id,
      brain_id: params.brain_id,
      category: params.category,
      duration_ms: params.duration_ms,
      failed_step: params.failed_step,
      error_code: params.error_code,
      error_message: params.error_message,
      partial_completion: params.partial_completion,
      actions_completed: params.actions_completed,
    };

    this.output('error', event);
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
export function createLogger(config?: Partial<LoggerConfig>): ReplyHandlerLogger {
  return new ReplyHandlerLogger(config);
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(
  parent: ReplyHandlerLogger,
  context: Record<string, unknown>
): ReplyHandlerLogger {
  const config = {
    metadata: context,
  };
  return new ReplyHandlerLogger(config);
}

// ===========================================
// Singleton Instance
// ===========================================

let defaultLogger: ReplyHandlerLogger | null = null;

/**
 * Get or create the default logger
 */
export function getLogger(): ReplyHandlerLogger {
  if (!defaultLogger) {
    defaultLogger = new ReplyHandlerLogger();
  }
  return defaultLogger;
}

/**
 * Set the default logger
 */
export function setLogger(logger: ReplyHandlerLogger): void {
  defaultLogger = logger;
}
