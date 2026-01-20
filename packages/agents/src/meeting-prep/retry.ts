/**
 * Retry Mechanism
 *
 * Implements retry with exponential backoff for transient failures.
 * Tracks retry count in error objects and sends Slack notifications
 * after final failure.
 *
 * Implements FR-016: 3 attempts with 1s/2s/4s delays.
 *
 * @module meeting-prep/retry
 */

import type { Block, KnownBlock, WebClient } from '@slack/web-api';
import type { MeetingPrepLogger } from './logger';
import {
  classifyError,
  formatErrorSlackMessage,
  type ClassifiedError,
  type ErrorContext,
} from './error-handler';

// ===========================================
// Types
// ===========================================

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base delay in milliseconds (doubled each attempt) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Jitter factor (0-1) to randomize delays */
  jitterFactor: number;
  /** Slack channel for failure notifications */
  slackFailureChannel: string;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000, // 1s, 2s, 4s
  maxDelayMs: 30000,
  jitterFactor: 0.1,
  slackFailureChannel: 'meeting-escalations',
};

/**
 * Retry dependencies
 */
export interface RetryDependencies {
  /** Logger instance */
  logger: MeetingPrepLogger;
  /** Slack client for notifications (optional) */
  slackClient?: WebClient;
}

/**
 * Result of a retryable operation
 */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Result if successful */
  result?: T;
  /** Error if failed after all retries */
  error?: ClassifiedError;
  /** Number of attempts made */
  attempts: number;
  /** Total time spent (including delays) in ms */
  totalTimeMs: number;
}

/**
 * Retry state tracked during execution
 */
export interface RetryState {
  /** Current attempt number (0-indexed) */
  attempt: number;
  /** Time of first attempt */
  startTime: number;
  /** Errors encountered */
  errors: ClassifiedError[];
}

// ===========================================
// Retry Functions
// ===========================================

/**
 * Calculate delay for exponential backoff with jitter.
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter
  const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(cappedDelay + jitter));
}

/**
 * Sleep for specified milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an operation with retry logic.
 *
 * @param operation - The async function to execute
 * @param context - Error context for classification
 * @param deps - Dependencies (logger, Slack client)
 * @param config - Retry configuration
 * @returns Result with success status, result/error, and attempt count
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  context: ErrorContext,
  deps: RetryDependencies,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<RetryResult<T>> {
  const state: RetryState = {
    attempt: 0,
    startTime: Date.now(),
    errors: [],
  };

  while (state.attempt < config.maxAttempts) {
    try {
      deps.logger.debug('Attempting operation', {
        operation: context.operation,
        attempt: state.attempt + 1,
        max_attempts: config.maxAttempts,
        meeting_id: context.meetingId,
      });

      const result = await operation(state.attempt);

      return {
        success: true,
        result,
        attempts: state.attempt + 1,
        totalTimeMs: Date.now() - state.startTime,
      };
    } catch (error) {
      // Classify the error
      const classified = classifyError(error, {
        ...context,
        retryCount: state.attempt,
        maxRetries: config.maxAttempts,
      });
      state.errors.push(classified);

      deps.logger.warn('Operation failed, checking retry eligibility', {
        operation: context.operation,
        attempt: state.attempt + 1,
        max_attempts: config.maxAttempts,
        error_code: classified.code,
        is_retryable: classified.isRetryable,
        meeting_id: context.meetingId,
      });

      // Check if we should retry
      const isLastAttempt = state.attempt >= config.maxAttempts - 1;
      const shouldRetry = classified.isRetryable && !isLastAttempt;

      if (!shouldRetry) {
        // Final failure - send notification
        if (deps.slackClient) {
          await sendFailureNotification(
            deps.slackClient,
            classified,
            { ...context, retryCount: state.attempt, maxRetries: config.maxAttempts },
            config.slackFailureChannel,
            deps.logger
          );
        }

        return {
          success: false,
          error: classified,
          attempts: state.attempt + 1,
          totalTimeMs: Date.now() - state.startTime,
        };
      }

      // Calculate delay and wait
      const delay = classified.retryAfterMs ?? calculateDelay(state.attempt, config);

      deps.logger.info('Retrying operation after delay', {
        operation: context.operation,
        attempt: state.attempt + 1,
        delay_ms: delay,
        meeting_id: context.meetingId,
      });

      await sleep(delay);
      state.attempt++;
    }
  }

  // Should not reach here, but handle just in case
  const lastError = state.errors[state.errors.length - 1];
  return {
    success: false,
    error: lastError,
    attempts: state.attempt,
    totalTimeMs: Date.now() - state.startTime,
  };
}

/**
 * Send Slack notification for final failure.
 */
async function sendFailureNotification(
  slackClient: WebClient,
  classified: ClassifiedError,
  context: ErrorContext,
  channel: string,
  logger: MeetingPrepLogger
): Promise<void> {
  try {
    const blocks = formatErrorSlackMessage(classified, context);

    // Add escalation context
    const escalationBlocks: (Block | KnownBlock)[] = [
      {
        type: 'divider',
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `:rotating_light: *Escalation* - All ${context.maxRetries} retry attempts exhausted`,
          },
        ],
      },
    ];

    await slackClient.chat.postMessage({
      channel,
      text: `Brief generation failed after ${context.maxRetries} attempts`,
      blocks: [...blocks, ...escalationBlocks],
    });

    logger.info('Failure notification sent to Slack', {
      channel,
      meeting_id: context.meetingId,
      brief_id: context.briefId,
      attempts: context.maxRetries,
    });
  } catch (error) {
    logger.error('Failed to send failure notification to Slack', {
      error: error instanceof Error ? error.message : String(error),
      channel,
      meeting_id: context.meetingId,
    });
  }
}

// ===========================================
// Retry Builder (Fluent API)
// ===========================================

/**
 * Fluent builder for configuring retry operations.
 */
export class RetryBuilder<T> {
  private operation: (attempt: number) => Promise<T>;
  private context: ErrorContext;
  private deps: RetryDependencies;
  private config: RetryConfig;

  constructor(
    operation: (attempt: number) => Promise<T>,
    context: ErrorContext,
    deps: RetryDependencies
  ) {
    this.operation = operation;
    this.context = context;
    this.deps = deps;
    this.config = { ...DEFAULT_RETRY_CONFIG };
  }

  /**
   * Set maximum retry attempts.
   */
  attempts(max: number): this {
    this.config.maxAttempts = max;
    return this;
  }

  /**
   * Set base delay in milliseconds.
   */
  delay(baseMs: number): this {
    this.config.baseDelayMs = baseMs;
    return this;
  }

  /**
   * Set Slack failure notification channel.
   */
  notifyOnFailure(channel: string): this {
    this.config.slackFailureChannel = channel;
    return this;
  }

  /**
   * Execute the operation with retry.
   */
  async execute(): Promise<RetryResult<T>> {
    return withRetry(this.operation, this.context, this.deps, this.config);
  }
}

/**
 * Create a retry builder for an operation.
 */
export function retry<T>(
  operation: (attempt: number) => Promise<T>,
  context: ErrorContext,
  deps: RetryDependencies
): RetryBuilder<T> {
  return new RetryBuilder(operation, context, deps);
}

// ===========================================
// Convenience Functions
// ===========================================

/**
 * Execute operation with default FR-016 retry configuration.
 * 3 attempts with 1s/2s/4s delays.
 */
export async function withDefaultRetry<T>(
  operation: (attempt: number) => Promise<T>,
  context: ErrorContext,
  deps: RetryDependencies
): Promise<RetryResult<T>> {
  return withRetry(operation, context, deps, DEFAULT_RETRY_CONFIG);
}

/**
 * Check if a result indicates retryable failure.
 */
export function isRetryableFailure<T>(result: RetryResult<T>): boolean {
  return !result.success && !!result.error?.isRetryable;
}

/**
 * Check if max retries were exhausted.
 */
export function maxRetriesExhausted<T>(
  result: RetryResult<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): boolean {
  return !result.success && result.attempts >= config.maxAttempts;
}
