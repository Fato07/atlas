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

// Meeting Prep Agent - use subpath import for namespacing
// import { MeetingPrepAgent } from '@atlas-gtm/agents/meeting-prep';
// NOTE: To avoid naming conflicts with other agents, consumers should use
// subpath imports rather than the main entry point.

// Export meeting-prep contracts
export {
  // Meeting Input types
  CalendarWebhookPayloadSchema,
  ManualBriefRequestSchema,
  ParsedMeetingSchema,
  AttendeeSchema,
  CalendarEventSchema,
  extractPrimaryExternalAttendee,
  extractMeetingLink,
  isInternalMeeting,
  minutesUntilMeeting,

  // Brief types
  BriefContentSchema,
  BriefSchema,
  BriefStatusSchema,
  createPendingBrief,
  transitionBriefStatus,

  // Meeting Analysis types
  TranscriptInputSchema,
  BANTSchema,
  ExtractedObjectionSchema,
  ActionItemSchema,
  MeetingAnalysisSchema,
  AnalysisOutputSchema,
  createEmptyAnalysis,
  calculateBANTScore,
  getRecommendation,

  // Webhook API types
  BriefWebhookResponseSchema,
  AnalysisWebhookResponseSchema,
  HealthCheckResponseSchema,
  ErrorResponseSchema,
  ErrorCodes,
  successResponse,
  errorResponse,
} from './meeting-prep';

// Re-export meeting-prep contract types
export type {
  CalendarWebhookPayload,
  ManualBriefRequest,
  ParsedMeeting,
  CalendarEvent,
  Attendee,
  BriefStatus,
  BriefContent,
  Brief,
  TranscriptInput,
  BANT,
  ExtractedObjection,
  ActionItem,
  MeetingAnalysis,
  AnalysisOutput,
  BriefWebhookResponse,
  AnalysisWebhookResponse,
  HealthCheckResponse,
  ErrorResponse,
} from './meeting-prep';

// Re-export meeting-prep internal types with 'MeetingPrep' prefix to avoid conflicts
export type {
  MeetingPrepConfig,
  UpcomingMeeting,
  BriefQueueEntry,
  AnalysisQueueEntry,
  RecentBrief,
  RecentAnalysis,
  SessionError as MeetingPrepSessionError,
  SessionMetrics as MeetingPrepSessionMetrics,
  MeetingPrepState,
  GatheredContext,
  ResearchCache,
  InsightCategory,
  ExtractedInsight as MeetingPrepExtractedInsight,
  BriefGenerationResult,
  AnalysisResult,
  LogEventType as MeetingPrepLogEventType,
  LogEvent as MeetingPrepLogEvent,
} from './meeting-prep';

export {
  DEFAULT_CONFIG as MEETING_PREP_DEFAULT_CONFIG,
} from './meeting-prep';

// Export meeting-prep agent components
export {
  MeetingPrepAgent,
  createMeetingPrepAgent,
  createAndInitMeetingPrepAgent,
  type MeetingPrepAgentConfig,
} from './meeting-prep';

// Export meeting-prep state manager
export {
  MeetingPrepStateManager,
  loadStateManager as loadMeetingPrepStateManager,
  createStateManager as createMeetingPrepStateManager,
} from './meeting-prep';

// Export meeting-prep logger
export {
  MeetingPrepLogger,
  createLogger as createMeetingPrepLogger,
  createChildLogger as createMeetingPrepChildLogger,
  getLogger as getMeetingPrepLogger,
  setLogger as setMeetingPrepLogger,
  type LoggerConfig as MeetingPrepLoggerConfig,
} from './meeting-prep';

// ===========================================
// Learning Loop Agent
// ===========================================

// Learning Loop Agent - use subpath import for namespacing
// import { LearningLoopAgent } from '@atlas-gtm/agents/learning-loop';
// NOTE: To avoid naming conflicts with other agents, consumers should use
// subpath imports rather than the main entry point.

// Export learning-loop contracts
export {
  // Insight contracts
  InsightCategorySchema,
  InsightImportanceSchema,
  InsightSourceTypeSchema,
  InsightSourceSchema,
  ConfidenceGateResultSchema,
  DuplicateGateResultSchema,
  ImportanceGateResultSchema,
  QualityGateResultsSchema,
  ExtractedInsightSchema as LearningLoopExtractedInsightSchema,
  InsightValidationStatusSchema,
  InsightValidationSchema,
  ApplicationStatsSchema,
  StoredInsightPayloadSchema,
  createExtractedInsight,
  prepareInsightForStorage,

  // Validation contracts
  ValidationStatusSchema,
  ValidationDecisionSchema,
  ValidationSlackInfoSchema,
  ReminderTrackingSchema,
  InsightSummarySchema,
  ValidationItemSchema,
  ValidationQueueStatsSchema,
  SlackInteractionUserSchema,
  SlackInteractionActionSchema,
  SlackInteractionPayloadSchema,
  ActionValueSchema,
  createValidationItem,
  applyValidationDecision,
  shouldSendReminder,
  recordReminderSent,
  shouldExpire,
  expireValidationItem,
  validationItemKey,
  pendingValidationsKey,
  validationReminderKey,

  // Template performance contracts
  TemplateOutcomeSchema,
  OutcomeDistributionSchema,
  ABComparisonSchema,
  TemplatePerformanceSchema,
  TemplateUsageEventSchema,
  TemplateOutcomeEventSchema,
  calculateSuccessRate,
  createTemplatePerformance,
  recordTemplateUsage,
  recordTemplateOutcome,
  calculateABComparison,
  updateABComparison,
  checkDecliningPerformance,

  // Synthesis contracts
  ObjectionRankingSchema,
  TemplateRankingSchema,
  ICPSignalSummarySchema,
  CompetitiveIntelSummarySchema,
  CategoryStatsSchema,
  WeeklySynthesisSchema,
  SynthesisScheduleSchema,
  createEmptySynthesis,

  // Webhook API contracts
  WebhookAuthHeadersSchema,
  InsightExtractionRequestSchema,
  InsightExtractionResponseSchema,
  InsightExtractionErrorSchema,
  ValidationCallbackRequestSchema,
  ValidationCallbackResponseSchema,
  SynthesisRequestSchema,
  SynthesisResponseSchema,
  SynthesisErrorSchema,
  TemplateOutcomeRequestSchema,
  TemplateOutcomeResponseSchema,
  HealthCheckResponseSchema as LearningLoopHealthCheckResponseSchema,
  QueueStatusResponseSchema,
  StatsResponseSchema,
  WebhookErrorCodes,
  WEBHOOK_ROUTES,
  HTTP_STATUS as LEARNING_LOOP_HTTP_STATUS,
  validateWebhookSecret as validateLearningLoopWebhookSecret,
} from './learning-loop';

// Re-export learning-loop contract types
export type {
  InsightCategory as LearningLoopInsightCategory,
  InsightImportance,
  InsightSourceType,
  InsightSource,
  ConfidenceGateResult,
  DuplicateGateResult,
  ImportanceGateResult,
  QualityGateResults,
  ExtractedInsight as LearningLoopExtractedInsight,
  InsightValidationStatus,
  InsightValidation,
  ApplicationStats,
  StoredInsightPayload,
  ValidationStatus,
  ValidationDecision,
  ValidationSlackInfo,
  ReminderTracking,
  InsightSummary,
  ValidationItem,
  ValidationQueueStats,
  SlackInteractionUser,
  SlackInteractionAction,
  SlackInteractionPayload,
  ActionValue,
  TemplateOutcome,
  OutcomeDistribution,
  ABComparison,
  TemplatePerformance,
  TemplateUsageEvent,
  TemplateOutcomeEvent,
  DecliningAlert,
  ObjectionRanking,
  TemplateRanking,
  ICPSignalSummary,
  CompetitiveIntelSummary,
  CategoryStats,
  WeeklySynthesis,
  SynthesisSchedule,
  SynthesisSlackBlocks,
  WebhookAuthHeaders,
  InsightExtractionRequest,
  InsightExtractionResponse,
  InsightExtractionError,
  ValidationCallbackRequest,
  ValidationCallbackResponse,
  SynthesisRequest,
  SynthesisResponse,
  SynthesisError,
  TemplateOutcomeRequest,
  TemplateOutcomeResponse,
  HealthCheckResponse as LearningLoopHealthCheckResponse,
  QueueStatusResponse,
  StatsResponse,
  WebhookErrorCode,
} from './learning-loop';

// Re-export learning-loop internal types with 'LearningLoop' prefix to avoid conflicts
export type {
  LearningLoopConfig,
  PendingExtraction,
  PendingValidation,
  RecentInsight,
  SessionError as LearningLoopSessionError,
  SessionMetrics as LearningLoopSessionMetrics,
  LearningLoopState,
  ExtractionRequest,
  ExtractionResult,
  QualityGateEvaluation,
  KBWriteResult,
  LogEventType as LearningLoopLogEventType,
  LogEvent as LearningLoopLogEvent,
} from './learning-loop';

export {
  DEFAULT_CONFIG as LEARNING_LOOP_DEFAULT_CONFIG,
  createInitialState as createLearningLoopInitialState,
} from './learning-loop';

// Export learning-loop configuration
export {
  loadConfig as loadLearningLoopConfig,
  loadEnvConfig as loadLearningLoopEnvConfig,
  validateConfig as validateLearningLoopConfig,
  ENV_VARS as LEARNING_LOOP_ENV_VARS,
  type EnvConfig as LearningLoopEnvConfig,
} from './learning-loop';

// Export learning-loop logger
export {
  LearningLoopLogger,
  createLogger as createLearningLoopLogger,
  createChildLogger as createLearningLoopChildLogger,
  getLogger as getLearningLoopLogger,
  setLogger as setLearningLoopLogger,
  type LoggerConfig as LearningLoopLoggerConfig,
} from './learning-loop';
