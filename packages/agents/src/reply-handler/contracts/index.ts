/**
 * Reply Handler Agent - Contracts
 *
 * Public contract exports for the reply handler agent.
 * Includes classification, category workflows, CRM records, and pattern storage.
 *
 * @module reply-handler/contracts
 */

// ===========================================
// Reply Input Contracts
// ===========================================

export {
  // Schemas
  ThreadMessageSchema,
  ReplySourceSchema,
  ReplyInputSchema,
  LeadContextSchema,
  InstantlyWebhookPayloadSchema,
  HeyReachWebhookPayloadSchema,
  // Types
  type ReplyId,
  type ThreadId,
  type LeadId,
  type BrainId,
  type ThreadMessage,
  type ReplySource,
  type ReplyInput,
  type LeadContext,
  type InstantlyWebhookPayload,
  type HeyReachWebhookPayload,
  // Helpers
  webhookToReplyInput,
  heyreachWebhookToReplyInput,
  parseReplyInput,
  safeParseReplyInput,
} from './reply-input';

// ===========================================
// Classification Result Contracts (A/B/C)
// ===========================================

export {
  // Schemas
  ClassificationCategorySchema,
  ClassificationResultSchema,
  // Types
  type ClassificationCategory,
  type ClassificationResult,
  // Tool
  CATEGORY_CLASSIFICATION_TOOL,
  // Constants
  CATEGORY_DESCRIPTIONS,
  CATEGORY_A_SIGNALS,
  CATEGORY_B_SIGNALS,
  CATEGORY_C_SIGNALS,
  // Helpers
  shouldAutoRoute,
  getEffectiveCategory,
  parseClassificationResult,
  safeParseClassificationResult,
} from './classification-result';

// ===========================================
// Category Workflow Contracts
// ===========================================

export {
  // Shared Schemas
  ChannelSchema,
  NotificationSchema,
  LeadReferenceSchema,
  ReplyReferenceSchema,
  // Shared Types
  type Channel,
  type Notification,
  type LeadReference,
  type ReplyReference,

  // Category A
  CategoryAInputSchema,
  CategoryAOutputSchema,
  type CategoryAInput,
  type CategoryAOutput,

  // Category B
  ReferralEvaluationSchema,
  CategoryBInputSchema,
  CategoryBOutputSchema,
  type ReferralEvaluation,
  type CategoryBInput,
  type CategoryBOutput,

  // Category C
  SimilarPatternSchema,
  CategoryCInputSchema,
  CategoryCOutputSchema,
  type SimilarPattern,
  type CategoryCInput,
  type CategoryCOutput,

  // Helpers
  createCategoryAInput,
  createCategoryBInput,
  createCategoryCInput,
  shouldAutoSendReferral,
  isVpPlusLevel,
} from './category-workflows';

// ===========================================
// CRM and Lead Record Contracts
// ===========================================

export {
  // Schemas
  LeadStatusSchema,
  PipelineStageSchema,
  AirtableLeadSchema,
  ActivityTypeSchema,
  CRMActivitySchema,
  AttioRecordSchema,
  CreateAttioRecordInputSchema,
  UpdateAirtableLeadInputSchema,
  // Types
  type LeadStatus,
  type PipelineStage,
  type AirtableLead,
  type ActivityType,
  type CRMActivity,
  type AttioRecord,
  type CreateAttioRecordInput,
  type UpdateAirtableLeadInput,
  // Helpers
  createAttioRecordInput,
  createAirtableUpdateInput,
  isHighQualityLead,
  createInitialActivity,
} from './crm-records';

// ===========================================
// Pattern Storage Contracts
// ===========================================

export {
  // Schemas
  PatternOutcomeSchema,
  PatternLeadContextSchema,
  BucketCPatternSchema,
  StorePatternInputSchema,
  StorePatternResponseSchema,
  SearchPatternsInputSchema,
  SearchPatternsResponseSchema,
  LabelPatternInputSchema,
  LabelPatternResponseSchema,
  ObjectionHandlerSchema,
  AnalyzePatternsInputSchema,
  AnalyzePatternsResponseSchema,
  // Types
  type PatternOutcome,
  type PatternLeadContext,
  type BucketCPattern,
  type StorePatternInput,
  type StorePatternResponse,
  type SearchPatternsInput,
  type SearchPatternsResponse,
  type LabelPatternInput,
  type LabelPatternResponse,
  type ObjectionHandler,
  type AnalyzePatternsInput,
  type AnalyzePatternsResponse,
  type CommonObjectionLabel,
  // Constants
  COMMON_OBJECTION_LABELS,
  // Helpers
  createStorePatternInput,
  createSearchPatternsInput,
} from './pattern-storage';

// ===========================================
// Legacy Handler Result Contracts
// ===========================================

export {
  // Schemas
  IntentSchema,
  ComplexitySchema,
  UrgencySchema,
  ClassificationSchema,
  KBMatchSchema,
  RoutingFactorSchema,
  TierRoutingSchema,
  ActionTypeSchema,
  ActionResultSchema,
  CRMUpdatesSchema,
  InsightCategorySchema,
  ExtractedInsightSchema,
  ReplyHandlerResultSchema,
  // Types
  type Intent,
  type Complexity,
  type Urgency,
  type Classification,
  type KBMatch,
  type RoutingFactor,
  type TierRouting,
  type ActionType,
  type ActionResult,
  type CRMUpdates,
  type InsightCategory,
  type ExtractedInsight,
  type ReplyHandlerResult,
  // Helpers
  createAutoRespondResult,
  createDraftResult,
  createEscalationResult,
  parseReplyHandlerResult,
} from './handler-result';

// ===========================================
// Webhook API Contracts
// ===========================================

export {
  // Endpoint definitions
  ReplyWebhookEndpoint,
  SlackActionEndpoint,
  HealthCheckEndpoint,
  DraftStatusEndpoint,
  // Schemas
  SlackActionPayloadSchema,
  SlackModalSubmissionSchema,
  // Types
  type SlackActionPayload,
  type SlackModalSubmission,
  type WebhookError,
  type N8nReplyHandlerWorkflow,
  // Security helpers
  verifyWebhookSecret,
  verifySlackSignature,
  // Error helpers
  createValidationError,
  createUnauthorizedError,
  createProcessingError,
  // Constants
  HTTP_STATUS,
} from './webhook-api';

// ===========================================
// Structured Output Tool Contracts
// ===========================================

// Classification Tool (legacy - detailed intent)
export {
  ClassificationResultSchema as DetailedClassificationResultSchema,
  type ClassificationResult as DetailedClassificationResult,
  type ClassificationToolInput,
  CLASSIFICATION_TOOL,
} from './classification-tool';

// Response Tool
export {
  PersonalizedResponseSchema,
  ResponseToneSchema,
  type PersonalizedResponse,
  type ResponseTone,
  type ResponseToolInput,
  RESPONSE_TOOL,
} from './response-tool';

// Insight Tool
export {
  ExtractedInsightItemSchema,
  InsightExtractionSchema,
  ImportanceLevelSchema,
  OverallQualitySchema,
  type ExtractedInsightItem,
  type InsightExtraction,
  type ImportanceLevel,
  type OverallQuality,
  type InsightToolInput,
  INSIGHT_TOOL,
} from './insight-tool';

// ===========================================
// State Schema Contracts
// ===========================================

export {
  // Schemas
  DraftStatusSchema,
  DraftSchema,
  ActiveThreadSchema,
  ProcessedReplySchema,
  SessionErrorSchema,
  ReplyHandlerStateSchema,
  // Types
  type DraftStatus,
  type Draft,
  type ActiveThread,
  type ProcessedReply,
  type SessionError,
  type ReplyHandlerState,
  // Helpers
  parseState,
  safeParseState,
  parseDraft,
  safeParseDraft,
} from './state-schema';
