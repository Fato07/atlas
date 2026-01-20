/**
 * Learning Loop Contracts
 *
 * Public contracts for the Learning Loop agent. These schemas define
 * the API boundaries for insight extraction, validation, and KB storage.
 *
 * @module learning-loop/contracts
 */

// ===========================================
// Insight Contracts
// ===========================================

export {
  // Categories and enums
  InsightCategorySchema,
  InsightImportanceSchema,
  InsightSourceTypeSchema,

  // Source tracking
  InsightSourceSchema,

  // Quality gates
  ConfidenceGateResultSchema,
  DuplicateGateResultSchema,
  ImportanceGateResultSchema,
  QualityGateResultsSchema,

  // Extracted insight (before storage)
  ExtractedInsightSchema,

  // Validation status
  InsightValidationStatusSchema,
  InsightValidationSchema,

  // Application stats
  ApplicationStatsSchema,

  // Stored insight (Qdrant payload)
  StoredInsightPayloadSchema,

  // Helpers
  createExtractedInsight,
  prepareInsightForStorage,

  // Types
  type InsightCategory,
  type InsightImportance,
  type InsightSourceType,
  type InsightSource,
  type ConfidenceGateResult,
  type DuplicateGateResult,
  type ImportanceGateResult,
  type QualityGateResults,
  type ExtractedInsight,
  type InsightValidationStatus,
  type InsightValidation,
  type ApplicationStats,
  type StoredInsightPayload,
} from './insight';

// ===========================================
// Validation Contracts
// ===========================================

export {
  // Status and decision
  ValidationStatusSchema,
  ValidationDecisionSchema,

  // Slack info
  ValidationSlackInfoSchema,

  // Reminder tracking
  ReminderTrackingSchema,

  // Insight summary
  InsightSummarySchema,

  // Validation item
  ValidationItemSchema,

  // Queue stats
  ValidationQueueStatsSchema,

  // Slack interaction
  SlackInteractionUserSchema,
  SlackInteractionActionSchema,
  SlackInteractionPayloadSchema,
  ActionValueSchema,

  // Helpers
  createValidationItem,
  applyValidationDecision,
  shouldSendReminder,
  recordReminderSent,
  shouldExpire,
  expireValidationItem,

  // Redis key helpers
  validationItemKey,
  pendingValidationsKey,
  validationReminderKey,

  // Types
  type ValidationStatus,
  type ValidationDecision,
  type ValidationSlackInfo,
  type ReminderTracking,
  type InsightSummary,
  type ValidationItem,
  type ValidationQueueStats,
  type SlackInteractionUser,
  type SlackInteractionAction,
  type SlackInteractionPayload,
  type ActionValue,
} from './validation';

// ===========================================
// Template Performance Contracts
// ===========================================

export {
  // Outcomes
  TemplateOutcomeSchema,
  OutcomeDistributionSchema,

  // A/B comparison
  ABComparisonSchema,

  // Template performance
  TemplatePerformanceSchema,

  // Events
  TemplateUsageEventSchema,
  TemplateOutcomeEventSchema,

  // Helpers
  calculateSuccessRate,
  createTemplatePerformance,
  recordTemplateUsage,
  recordTemplateOutcome,
  calculateABComparison,
  updateABComparison,
  checkDecliningPerformance,

  // Types
  type TemplateOutcome,
  type OutcomeDistribution,
  type ABComparison,
  type TemplatePerformance,
  type TemplateUsageEvent,
  type TemplateOutcomeEvent,
  type DecliningAlert,
} from './template-stats';

// ===========================================
// Synthesis Contracts
// ===========================================

export {
  // Rankings
  ObjectionRankingSchema,
  TemplateRankingSchema,

  // Summaries
  ICPSignalSummarySchema,
  CompetitiveIntelSummarySchema,
  CategoryStatsSchema,

  // Weekly synthesis
  WeeklySynthesisSchema,
  SynthesisScheduleSchema,

  // Helpers
  createEmptySynthesis,

  // Types
  type ObjectionRanking,
  type TemplateRanking,
  type ICPSignalSummary,
  type CompetitiveIntelSummary,
  type CategoryStats,
  type WeeklySynthesis,
  type SynthesisSchedule,
  type SynthesisSlackBlocks,
} from './synthesis';

// ===========================================
// Webhook API Contracts
// ===========================================

export {
  // Authentication
  WebhookAuthHeadersSchema,

  // Insight extraction
  InsightExtractionRequestSchema,
  InsightExtractionResponseSchema,
  InsightExtractionErrorSchema,

  // Validation callback
  ValidationCallbackRequestSchema,
  ValidationCallbackResponseSchema,

  // Synthesis
  SynthesisRequestSchema,
  SynthesisResponseSchema,
  SynthesisErrorSchema,

  // Template outcome
  TemplateOutcomeRequestSchema,
  TemplateOutcomeResponseSchema,

  // Health check
  HealthCheckResponseSchema,

  // Queue status
  QueueStatusResponseSchema,

  // Stats
  StatsResponseSchema,

  // Constants
  WebhookErrorCodes,
  WEBHOOK_ROUTES,
  HTTP_STATUS,

  // Helpers
  validateWebhookSecret,

  // Types
  type WebhookAuthHeaders,
  type InsightExtractionRequest,
  type InsightExtractionResponse,
  type InsightExtractionError,
  type ValidationCallbackRequest,
  type ValidationCallbackResponse,
  type SynthesisRequest,
  type SynthesisResponse,
  type SynthesisError,
  type TemplateOutcomeRequest,
  type TemplateOutcomeResponse,
  type HealthCheckResponse,
  type QueueStatusResponse,
  type StatsResponse,
  type WebhookErrorCode,
} from './webhook-api';
