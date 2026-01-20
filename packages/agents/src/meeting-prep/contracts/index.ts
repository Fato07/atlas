/**
 * Meeting Prep Agent Contracts
 *
 * Re-exports all contract schemas and types for the Meeting Prep Agent.
 *
 * @module meeting-prep/contracts
 */

// Meeting Input contracts
export {
  AttendeeSchema,
  CalendarEventSchema,
  CalendarWebhookPayloadSchema,
  ManualBriefRequestSchema,
  ParsedMeetingSchema,
  extractPrimaryExternalAttendee,
  extractMeetingLink,
  isInternalMeeting,
  minutesUntilMeeting,
} from './meeting-input';
export type {
  Attendee,
  CalendarEvent,
  CalendarWebhookPayload,
  ManualBriefRequest,
  ParsedMeeting,
} from './meeting-input';

// Brief contracts
export {
  BriefStatusSchema,
  ConversationEntrySchema,
  CompanyIntelSchema,
  ObjectionHandlerSchema,
  SimilarDealSchema,
  BriefContentSchema,
  StatusHistoryEntrySchema,
  BriefErrorSchema,
  BriefSchema,
  SlackBlockSchema,
  SlackMessageSchema,
  createPendingBrief,
  transitionBriefStatus,
} from './brief';
export type {
  BriefStatus,
  ConversationEntry,
  CompanyIntel,
  ObjectionHandler,
  SimilarDeal,
  BriefContent,
  StatusHistoryEntry,
  BriefError,
  Brief,
  SlackMessage,
} from './brief';

// Meeting Analysis contracts
export {
  BANTStatusSchema,
  BANTDimensionSchema,
  BudgetDimensionSchema,
  AuthorityDimensionSchema,
  NeedDimensionSchema,
  TimelineDimensionSchema,
  BANTOverallSchema,
  BANTSchema,
  ObjectionCategorySchema,
  ObjectionStatusSchema,
  ExtractedObjectionSchema,
  ActionItemPrioritySchema,
  ActionItemSchema,
  KeyQuoteSchema,
  CompetitiveMentionSchema,
  AttioCRMUpdateSchema,
  AirtableCRMUpdateSchema,
  CRMUpdatesSchema,
  MeetingAnalysisSchema,
  TranscriptInputSchema,
  AnalysisOutputSchema,
  createEmptyAnalysis,
  calculateBANTScore,
  getRecommendation,
} from './meeting-analysis';
export type {
  BANTStatus,
  BANTDimension,
  BANT,
  ObjectionCategory,
  ObjectionStatus,
  ExtractedObjection,
  ActionItem,
  KeyQuote,
  CompetitiveMention,
  CRMUpdates,
  MeetingAnalysis,
  TranscriptInput,
  AnalysisOutput,
} from './meeting-analysis';

// Webhook API contracts
export {
  WebhookAuthHeaderSchema,
  BriefWebhookRequestSchema,
  BriefWebhookResponseSchema,
  ManualBriefWebhookRequestSchema,
  AnalysisWebhookRequestSchema,
  AnalysisWebhookResponseSchema,
  BriefStatusQuerySchema,
  BriefStatusResponseSchema,
  HealthCheckResponseSchema,
  ErrorResponseSchema,
  ErrorCodes,
  WebhookEventSchema,
  successResponse,
  errorResponse,
} from './webhook-api';
export type {
  WebhookAuthHeader,
  BriefWebhookRequest,
  BriefWebhookResponse,
  ManualBriefWebhookRequest,
  AnalysisWebhookRequest,
  AnalysisWebhookResponse,
  BriefStatusQuery,
  BriefStatusResponse,
  HealthCheckResponse,
  ErrorResponse,
  ErrorCode,
  WebhookEventType,
  WebhookEvent,
} from './webhook-api';
