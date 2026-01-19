/**
 * Atlas GTM Agents
 *
 * Production agents for GTM operations.
 *
 * @module @atlas-gtm/agents
 */

// Lead Scorer Agent - use subpath import for namespacing
// import { LeadScorer } from '@atlas-gtm/agents/lead-scorer';
export * from './lead-scorer';

// Reply Handler Agent - use subpath import for namespacing
// import { ReplyHandler } from '@atlas-gtm/agents/reply-handler';
// NOTE: To avoid naming conflicts (DEFAULT_TIER_THRESHOLDS, HTTP_STATUS, etc.),
// consumers should use subpath imports rather than the main entry point.
// export * from './reply-handler';

// Explicitly export reply-handler contracts that don't conflict
export {
  // Reply Input types
  ReplyInputSchema,
  LeadContextSchema,
  InstantlyWebhookPayloadSchema,
  webhookToReplyInput,
  parseReplyInput,
  safeParseReplyInput,

  // Handler Result types
  ReplyHandlerResultSchema,
  ClassificationSchema,
  KBMatchSchema,
  TierRoutingSchema,
  ActionResultSchema,
  CRMUpdatesSchema,
  ExtractedInsightSchema,
  createAutoRespondResult,
  createDraftResult,
  createEscalationResult,
  parseReplyHandlerResult,

  // Webhook API types
  ReplyWebhookEndpoint,
  SlackActionEndpoint,
  HealthCheckEndpoint,
  DraftStatusEndpoint,
  SlackActionPayloadSchema,
  SlackModalSubmissionSchema,
  verifyWebhookSecret,
  verifySlackSignature,
  createValidationError,
  createUnauthorizedError,
  createProcessingError,
} from './reply-handler';

// Re-export with aliases for conflicting types
export type { ReplyInput } from './reply-handler';
export type { LeadContext as ReplyLeadContext } from './reply-handler';
export type { ReplyHandlerResult } from './reply-handler';
export type { Classification } from './reply-handler';
export type { KBMatch } from './reply-handler';
export type { TierRouting } from './reply-handler';
export type { ActionResult } from './reply-handler';
export type { CRMUpdates } from './reply-handler';
export type { ExtractedInsight } from './reply-handler';
export type { SlackActionPayload } from './reply-handler';
export type { SlackModalSubmission } from './reply-handler';
export type { WebhookError } from './reply-handler';
export type { N8nReplyHandlerWorkflow } from './reply-handler';

// Re-export internal types with 'ReplyHandler' prefix to avoid conflicts
export type {
  ReplyStatus,
  DraftStatus,
  Draft,
  ActiveThread as ReplyHandlerActiveThread,
  ProcessedReply,
  SessionError as ReplyHandlerSessionError,
  ReplyHandlerState,
  DeadLetterEntry,
  TierThresholds as ReplyHandlerTierThresholds,
  TemplateVariables,
  ReplyHandlerConfig,
} from './reply-handler';

export {
  DEFAULT_TIER_THRESHOLDS as REPLY_HANDLER_DEFAULT_TIER_THRESHOLDS,
  DEFAULT_CONFIG as REPLY_HANDLER_DEFAULT_CONFIG,
  buildTemplateVariables,
} from './reply-handler';
