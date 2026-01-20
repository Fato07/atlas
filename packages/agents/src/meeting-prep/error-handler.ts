/**
 * Error Handler
 *
 * Comprehensive error handling for the Meeting Prep Agent.
 * Maps error types to ErrorCodes, formats user-friendly Slack notifications,
 * and provides manual retry instructions.
 *
 * Implements FR-016 error handling requirements.
 *
 * @module meeting-prep/error-handler
 */

import type { BrainId } from '@atlas-gtm/lib';
import type { Block, KnownBlock } from '@slack/web-api';
import { ErrorCodes, type ErrorCode } from './contracts/webhook-api';
import type { MeetingPrepLogger } from './logger';

// ===========================================
// Types
// ===========================================

/**
 * Error context for detailed error handling
 */
export interface ErrorContext {
  /** Brain ID */
  brainId: BrainId;
  /** Brief ID if available */
  briefId?: string;
  /** Meeting ID if available */
  meetingId?: string;
  /** Operation being performed */
  operation: ErrorOperation;
  /** Source of the error */
  source?: ErrorSource;
  /** Retry count */
  retryCount?: number;
  /** Max retries allowed */
  maxRetries?: number;
  /** Additional context data */
  metadata?: Record<string, unknown>;
}

/**
 * Error operations
 */
export type ErrorOperation =
  | 'context_gathering'
  | 'brief_generation'
  | 'brief_delivery'
  | 'transcript_analysis'
  | 'crm_update'
  | 'calendar_processing'
  | 'manual_request';

/**
 * Error sources (external services)
 */
export type ErrorSource =
  | 'instantly'
  | 'airtable'
  | 'attio'
  | 'qdrant'
  | 'claude'
  | 'slack'
  | 'calendar'
  | 'webhook'
  | 'internal';

/**
 * Classified error with code and user message
 */
export interface ClassifiedError {
  /** Error code for programmatic handling */
  code: ErrorCode;
  /** Technical error message */
  message: string;
  /** User-friendly message for Slack */
  userMessage: string;
  /** Whether the error is retryable */
  isRetryable: boolean;
  /** Suggested wait time before retry (ms) */
  retryAfterMs?: number;
}

/**
 * Error handler configuration
 */
export interface ErrorHandlerConfig {
  /** Slack channel for escalation */
  escalationChannel: string;
  /** Include technical details in Slack messages */
  includeTechnicalDetails: boolean;
  /** Maximum error message length */
  maxErrorMessageLength: number;
}

export const DEFAULT_ERROR_HANDLER_CONFIG: ErrorHandlerConfig = {
  escalationChannel: 'meeting-escalations',
  includeTechnicalDetails: false,
  maxErrorMessageLength: 500,
};

/**
 * Error handler dependencies
 */
export interface ErrorHandlerDependencies {
  /** Logger instance */
  logger: MeetingPrepLogger;
}

// ===========================================
// Error Classification
// ===========================================

/**
 * Classify an error into a structured error with code and user message.
 */
export function classifyError(
  error: unknown,
  context: ErrorContext
): ClassifiedError {
  const message = getErrorMessage(error);

  // Check for specific error types
  if (isTimeoutError(error, message)) {
    return {
      code: ErrorCodes.TIMEOUT,
      message,
      userMessage: getTimeoutUserMessage(context),
      isRetryable: true,
      retryAfterMs: 5000,
    };
  }

  if (isRateLimitError(error, message)) {
    return {
      code: ErrorCodes.RATE_LIMITED,
      message,
      userMessage: 'Too many requests. Please try again in a few minutes.',
      isRetryable: true,
      retryAfterMs: 60000,
    };
  }

  if (isAuthenticationError(error, message)) {
    return {
      code: ErrorCodes.UNAUTHORIZED,
      message,
      userMessage: 'Authentication failed. Please contact support.',
      isRetryable: false,
    };
  }

  // Map by source
  if (context.source) {
    return classifyBySource(context.source, message, context);
  }

  // Map by operation
  return classifyByOperation(context.operation, message, context);
}

/**
 * Classify error by source service.
 */
function classifyBySource(
  source: ErrorSource,
  message: string,
  context: ErrorContext
): ClassifiedError {
  switch (source) {
    case 'qdrant':
      return {
        code: ErrorCodes.QDRANT_ERROR,
        message,
        userMessage: 'Knowledge base is temporarily unavailable. Brief may be missing some context.',
        isRetryable: true,
        retryAfterMs: 3000,
      };

    case 'slack':
      return {
        code: ErrorCodes.SLACK_ERROR,
        message,
        userMessage: 'Failed to deliver brief to Slack. The brief was generated successfully.',
        isRetryable: true,
        retryAfterMs: 2000,
      };

    case 'attio':
      return {
        code: ErrorCodes.ATTIO_ERROR,
        message,
        userMessage: 'CRM data unavailable. Brief will be generated with limited context.',
        isRetryable: true,
        retryAfterMs: 3000,
      };

    case 'airtable':
      return {
        code: ErrorCodes.AIRTABLE_ERROR,
        message,
        userMessage: 'Lead data unavailable. Brief will be generated with limited context.',
        isRetryable: true,
        retryAfterMs: 3000,
      };

    case 'claude':
      return {
        code: ErrorCodes.CLAUDE_ERROR,
        message,
        userMessage: 'AI service temporarily unavailable. Please try again.',
        isRetryable: true,
        retryAfterMs: 5000,
      };

    default:
      return {
        code: ErrorCodes.INTERNAL_ERROR,
        message,
        userMessage: 'An unexpected error occurred. Please try again or contact support.',
        isRetryable: true,
        retryAfterMs: 3000,
      };
  }
}

/**
 * Classify error by operation.
 */
function classifyByOperation(
  operation: ErrorOperation,
  message: string,
  context: ErrorContext
): ClassifiedError {
  switch (operation) {
    case 'context_gathering':
      return {
        code: ErrorCodes.CONTEXT_GATHERING_FAILED,
        message,
        userMessage: 'Failed to gather meeting context. The brief may be incomplete.',
        isRetryable: true,
        retryAfterMs: 3000,
      };

    case 'brief_generation':
      return {
        code: ErrorCodes.BRIEF_GENERATION_FAILED,
        message,
        userMessage: 'Failed to generate the meeting brief. Please try again.',
        isRetryable: true,
        retryAfterMs: 5000,
      };

    case 'brief_delivery':
      return {
        code: ErrorCodes.BRIEF_DELIVERY_FAILED,
        message,
        userMessage: 'Brief was generated but delivery failed. Check the Slack channel.',
        isRetryable: true,
        retryAfterMs: 2000,
      };

    case 'transcript_analysis':
      return {
        code: ErrorCodes.ANALYSIS_FAILED,
        message,
        userMessage: 'Failed to analyze the meeting transcript. Please try again.',
        isRetryable: true,
        retryAfterMs: 5000,
      };

    case 'crm_update':
      return {
        code: ErrorCodes.CRM_UPDATE_FAILED,
        message,
        userMessage: 'Analysis complete but CRM update failed. Please update manually.',
        isRetryable: true,
        retryAfterMs: 3000,
      };

    case 'calendar_processing':
      return {
        code: ErrorCodes.MEETING_NOT_FOUND,
        message,
        userMessage: 'Failed to process calendar event. Please verify the meeting details.',
        isRetryable: false,
      };

    case 'manual_request':
      return {
        code: ErrorCodes.INVALID_REQUEST,
        message,
        userMessage: 'Invalid request. Please check the meeting ID or email address.',
        isRetryable: false,
      };

    default:
      return {
        code: ErrorCodes.INTERNAL_ERROR,
        message,
        userMessage: 'An unexpected error occurred. Please try again.',
        isRetryable: true,
        retryAfterMs: 3000,
      };
  }
}

// ===========================================
// Helper Functions
// ===========================================

/**
 * Extract error message from unknown error type.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unknown error';
}

/**
 * Check if error is a timeout error.
 */
function isTimeoutError(error: unknown, message: string): boolean {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return true;
  }
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('deadline exceeded')
  );
}

/**
 * Check if error is a rate limit error.
 */
function isRateLimitError(error: unknown, message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('too many requests') ||
    lowerMessage.includes('429')
  );
}

/**
 * Check if error is an authentication error.
 */
function isAuthenticationError(error: unknown, message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('authentication') ||
    lowerMessage.includes('401') ||
    lowerMessage.includes('forbidden') ||
    lowerMessage.includes('403')
  );
}

/**
 * Get user-friendly message for timeout errors.
 */
function getTimeoutUserMessage(context: ErrorContext): string {
  switch (context.operation) {
    case 'context_gathering':
      return 'Data gathering took too long. Brief will be generated with available data.';
    case 'brief_generation':
      return 'Brief generation timed out. Please try again.';
    case 'transcript_analysis':
      return 'Analysis timed out. Please try again with a shorter transcript.';
    default:
      return 'The operation timed out. Please try again.';
  }
}

// ===========================================
// Slack Error Notification
// ===========================================

/**
 * Format an error as Slack Block Kit message for user notification.
 */
export function formatErrorSlackMessage(
  classified: ClassifiedError,
  context: ErrorContext,
  config: ErrorHandlerConfig = DEFAULT_ERROR_HANDLER_CONFIG
): (Block | KnownBlock)[] {
  const blocks: (Block | KnownBlock)[] = [];

  // Header with error indicator
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: ':warning: Brief Generation Issue',
      emoji: true,
    },
  });

  // User-friendly message
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: classified.userMessage,
    },
  });

  // Context fields
  const fields: { type: 'mrkdwn'; text: string }[] = [];

  if (context.meetingId) {
    fields.push({
      type: 'mrkdwn',
      text: `*Meeting:*\n${context.meetingId}`,
    });
  }

  if (context.briefId) {
    fields.push({
      type: 'mrkdwn',
      text: `*Brief ID:*\n${context.briefId}`,
    });
  }

  if (context.retryCount !== undefined && context.maxRetries !== undefined) {
    fields.push({
      type: 'mrkdwn',
      text: `*Attempts:*\n${context.retryCount + 1}/${context.maxRetries}`,
    });
  }

  if (fields.length > 0) {
    blocks.push({
      type: 'section',
      fields,
    });
  }

  // Technical details (if enabled)
  if (config.includeTechnicalDetails) {
    const truncatedMessage = classified.message.length > config.maxErrorMessageLength
      ? classified.message.slice(0, config.maxErrorMessageLength) + '...'
      : classified.message;

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `\`${classified.code}\`: ${truncatedMessage}`,
        },
      ],
    });
  }

  // Retry instructions
  if (classified.isRetryable) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: getRetryInstructions(context),
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':point_right: If this issue persists, please contact the engineering team.',
      },
    });
  }

  return blocks;
}

/**
 * Get retry instructions based on context.
 */
function getRetryInstructions(context: ErrorContext): string {
  if (context.operation === 'manual_request') {
    return ':point_right: *To retry:* Use `/brief <meeting_id>` or `/brief <email>` again.';
  }

  if (context.meetingId) {
    return `:point_right: *To retry:* Use \`/brief ${context.meetingId}\` to regenerate the brief.`;
  }

  return ':point_right: The system will automatically retry. If the issue persists, use the `/brief` command.';
}

// ===========================================
// Error Handler Class
// ===========================================

export class ErrorHandler {
  private readonly config: ErrorHandlerConfig;
  private readonly deps: ErrorHandlerDependencies;

  constructor(
    deps: ErrorHandlerDependencies,
    config?: Partial<ErrorHandlerConfig>
  ) {
    this.config = { ...DEFAULT_ERROR_HANDLER_CONFIG, ...config };
    this.deps = deps;
  }

  /**
   * Handle an error with classification and logging.
   */
  handle(error: unknown, context: ErrorContext): ClassifiedError {
    const classified = classifyError(error, context);

    this.deps.logger.error('Error handled', {
      code: classified.code,
      message: classified.message,
      operation: context.operation,
      source: context.source,
      meeting_id: context.meetingId,
      brief_id: context.briefId,
      retry_count: context.retryCount,
      is_retryable: classified.isRetryable,
    });

    return classified;
  }

  /**
   * Format error for Slack notification.
   */
  formatForSlack(
    classified: ClassifiedError,
    context: ErrorContext
  ): (Block | KnownBlock)[] {
    return formatErrorSlackMessage(classified, context, this.config);
  }

  /**
   * Check if error should be escalated.
   */
  shouldEscalate(classified: ClassifiedError, context: ErrorContext): boolean {
    // Escalate if:
    // 1. Non-retryable errors (except validation errors)
    // 2. Max retries exceeded
    // 3. Critical operations failed
    if (!classified.isRetryable && classified.code !== ErrorCodes.INVALID_REQUEST) {
      return true;
    }

    if (
      context.retryCount !== undefined &&
      context.maxRetries !== undefined &&
      context.retryCount >= context.maxRetries
    ) {
      return true;
    }

    return false;
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create an error handler instance.
 */
export function createErrorHandler(
  deps: ErrorHandlerDependencies,
  config?: Partial<ErrorHandlerConfig>
): ErrorHandler {
  return new ErrorHandler(deps, config);
}
