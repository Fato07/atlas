/**
 * Meeting Prep Agent
 *
 * Generates pre-call briefs for upcoming meetings and analyzes post-meeting
 * transcripts for BANT qualification and insights. Uses Claude for structured
 * content generation, brain-scoped KB queries for context, and integrates
 * with Slack for brief delivery and CRM for data synchronization.
 *
 * @module meeting-prep
 */

// ===========================================
// Public Contracts
// ===========================================

// Re-export all contracts for external consumers
export * from './contracts';

// ===========================================
// Internal Types (for agent internals)
// ===========================================

export type {
  // Configuration
  MeetingPrepConfig,

  // State types
  UpcomingMeeting,
  BriefQueueEntry,
  AnalysisQueueEntry,
  RecentBrief,
  RecentAnalysis,
  SessionError,
  SessionMetrics,
  SubAgentSuccessRate,
  MeetingPrepState,

  // Context gathering
  GatheredContext,
  ResearchCache,

  // Insight types
  InsightCategory,
  ExtractedInsight,

  // Processing results
  BriefGenerationResult,
  AnalysisResult,

  // Logging
  LogEventType,
  BaseLogEvent,
  BriefRequestedEvent,
  ContextGatheredEvent,
  BriefGeneratedEvent,
  BriefDeliveredEvent,
  BriefFailedEvent,
  AnalysisRequestedEvent,
  AnalysisFailedEvent,
  AnalysisCompletedEvent,
  CRMUpdatedEvent,
  LogEvent,
} from './types';

export { DEFAULT_CONFIG } from './types';

// ===========================================
// Agent Components
// ===========================================

// Main Agent
export {
  MeetingPrepAgent,
  createMeetingPrepAgent,
  createAndInitMeetingPrepAgent,
  type MeetingPrepAgentConfig,
} from './agent';

// State Manager
export {
  MeetingPrepStateManager,
  loadStateManager,
  createStateManager,
} from './state';

// Logger
export {
  MeetingPrepLogger,
  createLogger,
  createChildLogger,
  getLogger,
  setLogger,
  type LoggerConfig,
} from './logger';

// Calendar Handler
export {
  CalendarHandler,
  createCalendarHandler,
  type CalendarHandlerConfig,
  type CalendarHandlerResult,
  type HandleCalendarResult,
} from './calendar-handler';

// Context Gatherer
export {
  ContextGatherer,
  createContextGatherer,
  DEFAULT_CONTEXT_GATHERER_CONFIG,
  type ContextGathererConfig,
  type ContextGathererDependencies,
  type GatherContextRequest,
  type GatherContextResult,
  type GatherContextError,
  type GatherContextOutput,
} from './context-gatherer';

// Brief Generator
export {
  BriefGenerator,
  createBriefGenerator,
  DEFAULT_BRIEF_GENERATOR_CONFIG,
  type BriefGeneratorConfig,
  type BriefGeneratorDependencies,
  type GenerateBriefRequest,
  type GenerateBriefResult,
  type GenerateBriefError,
  type GenerateBriefOutput,
} from './brief-generator';

// Slack Delivery
export {
  SlackBriefDelivery,
  createSlackBriefDelivery,
  DEFAULT_SLACK_DELIVERY_CONFIG,
  type SlackDeliveryConfig,
  type SlackDeliveryDependencies,
  type DeliverBriefRequest,
  type DeliverBriefResult,
  type DeliverBriefError,
  type DeliverBriefOutput,
} from './slack-delivery';

// ===========================================
// US2: Transcript Analysis Components
// ===========================================

// Transcript Analyzer
export {
  TranscriptAnalyzer,
  createTranscriptAnalyzer,
  DEFAULT_TRANSCRIPT_ANALYZER_CONFIG,
  type TranscriptAnalyzerConfig,
  type TranscriptAnalyzerDependencies,
  type AnalyzeTranscriptRequest,
  type AnalyzeTranscriptResult,
  type AnalyzeTranscriptError,
  type AnalyzeTranscriptOutput,
} from './transcript-analyzer';

// CRM Updater
export {
  CRMUpdater,
  createCRMUpdater,
  DEFAULT_CRM_UPDATER_CONFIG,
  type CRMUpdaterConfig,
  type CRMUpdaterDependencies,
  type UpdateCRMRequest,
  type UpdateCRMResult,
  type UpdateCRMError,
  type UpdateCRMOutput,
} from './crm-updater';

// Sub-Agents
export {
  // Instantly Fetcher
  InstantlyFetcher,
  createInstantlyFetcher,
  DEFAULT_INSTANTLY_CONFIG,
  type InstantlyFetcherConfig,
  type InstantlyFetcherResult,
  type InstantlyFetcherError,
  type InstantlyFetchResult,
  type ConversationEntry,

  // Airtable Fetcher
  AirtableFetcher,
  createAirtableFetcher,
  type AirtableFetcherResult,
  type AirtableFetcherError,
  type AirtableFetchResult,
  type LeadProfile,
  type LeadStatus,

  // Attio Fetcher
  AttioFetcher,
  createAttioFetcher,
  DEFAULT_ATTIO_CONFIG,
  type AttioFetcherConfig,
  type AttioFetcherResult,
  type AttioFetcherError,
  type AttioFetchResult,
  type AttioCRMData,
  type AttioPersonSummary,
  type AttioDealSummary,
  type AttioActivity,

  // KB Researcher
  KBResearcher,
  createKBResearcher,
  DEFAULT_KB_CONFIG,
  type KBResearcherConfig,
  type KBResearcherResult,
  type KBResearcherError,
  type KBResearchResult,
  type KBResearchData,
  type ObjectionHandler,
  type SimilarDeal,
  type ICPRule,
} from './sub-agents';

// Webhook Server
export {
  createWebhookServer,
  createRequestHandler,
  parseJsonBody,
  getClientIP,
  HTTP_STATUS,
  type MeetingPrepWebhookConfig,
} from './webhook';

// ===========================================
// US5: Manual Brief Request via Slack
// ===========================================

// Slack Slash Command Handler
export {
  SlackSlashCommandHandler,
  createSlashCommandHandler,
  parseSlackCommandBody,
  type SlackSlashCommandPayload,
  type ParsedSlashCommand,
  type SlashCommandHandlerConfig,
  type SlashCommandHandlerDependencies,
  type SlackAckResponse,
  type HandleCommandResult,
} from './slack-command-handler';

// Manual Request Handler
export {
  ManualRequestHandler,
  createManualRequestHandler,
  DEFAULT_MANUAL_REQUEST_CONFIG,
  type ManualRequestHandlerConfig,
  type ManualRequestHandlerDependencies,
  type HandleManualRequestInput,
  type HandleManualRequestResult,
  type HandleManualRequestError,
  type HandleManualRequestOutput,
} from './manual-request-handler';

// ===========================================
// US3: Context Gathering Optimization
// ===========================================

// Research Cache
export {
  ResearchCacheClient,
  createResearchCache,
  createCacheFunctions,
  InMemoryResearchCache,
  createInMemoryCacheFunctions,
  DEFAULT_RESEARCH_CACHE_CONFIG,
  type ResearchCacheConfig,
  type ResearchCacheDependencies,
} from './research-cache';

// Utilities
export {
  // Timeout utilities
  TimeoutError,
  isTimeoutError,
  withTimeout,
  withTimeoutResult,
  executeParallel,
  DEFAULT_TIMEOUT_MS,
  type WithTimeoutOptions,
  type NamedPromiseResult,

  // String utilities
  truncate,
  extractDomain,
  normalizeCompanyName,

  // Date/Time utilities
  hoursUntil,
  minutesUntil,
  isWithinMinutes,
} from './utils';

// Server Utilities (for programmatic usage)
export {
  loadEnvConfig,
  initializeClients,
  createVoyageEmbedder,
  createMcpBridge,
  type EnvConfig,
  type VoyageEmbedderConfig,
  type McpBridgeConfig,
} from './server';

// ===========================================
// Phase 8: Error Handling & Retry
// ===========================================

// Error Handler
export {
  ErrorHandler,
  createErrorHandler,
  classifyError,
  formatErrorSlackMessage,
  DEFAULT_ERROR_HANDLER_CONFIG,
  type ErrorHandlerConfig,
  type ErrorHandlerDependencies,
  type ErrorContext,
  type ErrorOperation,
  type ErrorSource,
  type ClassifiedError,
} from './error-handler';

// Retry Mechanism
export {
  RetryBuilder,
  retry,
  withRetry,
  withDefaultRetry,
  calculateDelay,
  sleep,
  isRetryableFailure,
  maxRetriesExhausted,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
  type RetryDependencies,
  type RetryResult,
  type RetryState,
} from './retry';
