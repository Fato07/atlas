/**
 * Reply Handler Agent
 *
 * Automatically classifies, routes, and responds to inbound email replies
 * from Instantly campaigns. Uses Claude for intent classification and sentiment
 * analysis, matches replies to brain-scoped KB templates/handlers, routes to
 * appropriate tiers (auto-respond, Slack approval, or human escalation), and
 * maintains CRM synchronization with Airtable and Attio.
 *
 * @module reply-handler
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
  // Status types
  ReplyStatus,
  DraftStatus,

  // State types
  Draft,
  ActiveThread,
  ProcessedReply,
  SessionError,
  ReplyHandlerState,

  // Dead letter queue
  DeadLetterEntry,

  // Configuration
  TierThresholds,
  TemplateVariables,
  ReplyHandlerConfig,

  // Logging
  LogEventType,
  BaseLogEvent,
  ReplyReceivedEvent,
  ReplyClassifiedEvent,
  ReplyRoutedEvent,
  ResponseSentEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  CRMUpdatedEvent,
  InsightExtractedEvent,
  ProcessingErrorEvent,
  LogEvent,
} from './types';

export {
  // Constants
  DEFAULT_TIER_THRESHOLDS,
  DEFAULT_CONFIG,

  // Helpers
  buildTemplateVariables,
} from './types';

// ===========================================
// Agent Components
// ===========================================

// Main Agent
export {
  ReplyHandlerAgent,
  createReplyHandlerAgent,
  type ReplyHandlerAgentConfig,
} from './agent';

// Classifier
export {
  ReplyClassifier,
  createClassifier,
  type ClassifierConfig,
} from './classifier';

// KB Matcher
export {
  KBMatcher,
  createMatcher,
  isEligibleForTier,
  getRecommendedTier,
  type MatcherConfig,
} from './matcher';

// Tier Router
export {
  TierRouter,
  createRouter,
  type RouterConfig,
} from './router';

// Response Generator
export {
  ResponseGenerator,
  createResponder,
  type ResponderConfig,
} from './responder';

// Slack Flow Manager
export {
  SlackFlowManager,
  createSlackFlowManager,
  verifySlackSignature,
  sendResponseUrl,
  type SlackFlowConfig,
  type SlackInteractivePayload,
} from './slack-flow';

// CRM Updater
export {
  CRMUpdater,
  createCRMUpdater,
  getAirtableStatus,
  getPipelineStage,
  type CRMUpdaterConfig,
  type CRMUpdateResult,
} from './crm-updater';

// Insight Extractor
export {
  InsightExtractor,
  createInsightExtractor,
  filterByCategory,
  filterActionable,
  sortByImportance,
  getAllSuggestedActions,
  type InsightExtractorConfig,
  type InsightCategory,
  type InsightImportance,
  type ExtractedInsight,
} from './insight-extractor';

// Logger
export {
  ReplyHandlerLogger,
  createLogger,
  type LoggerConfig,
} from './logger';

// Email Parser
export {
  parseEmailReply,
  extractNewContent,
  removeSignature,
  detectAutoReply,
  handleMultipartMime,
  extractSenderFromQuote,
  type ParsedEmail,
} from './email-parser';

// Webhook Handler
export {
  createWebhookServer,
  createWebhookMiddleware,
  createRequestHandler,
  parseJsonBody,
  getClientIP,
  checkRateLimit,
  HTTP_STATUS,
  type WebhookConfig,
} from './webhook';

// MCP Bridge
export {
  createMcpBridge,
  createMockMcpBridge,
  type McpBridgeConfig,
  type McpToolResponse,
  type McpToolFunction,
} from './mcp-bridge';

// Embedder
export {
  createVoyageEmbedder,
  createBatchEmbedder,
  createMockEmbedder,
  type EmbedderConfig,
  type EmbedFunction,
  type BatchEmbedFunction,
} from './embedder';

// Server
export {
  loadEnvConfig,
  initializeClients,
  createSlackActionHandler,
  type EnvConfig,
} from './server';
