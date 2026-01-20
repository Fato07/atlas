/**
 * Learning Loop Agent
 *
 * Automated insight extraction and KB learning system that:
 * 1. Extracts insights from email replies and call transcripts
 * 2. Validates insights through quality gates
 * 3. Routes high-importance/low-confidence insights to Slack for human validation
 * 4. Writes validated insights to Qdrant KB with provenance tracking
 * 5. Generates weekly synthesis reports
 * 6. Tracks template performance for A/B optimization
 *
 * Implements: FR-001 through FR-032
 *
 * @module learning-loop
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
  LearningLoopConfig,

  // State types
  PendingExtraction,
  PendingValidation,
  RecentInsight,
  SessionError,
  SessionMetrics,
  LearningLoopState,

  // Processing types
  ExtractionRequest,
  ExtractionResult,
  QualityGateEvaluation,
  KBWriteResult,

  // Logging types
  LogEventType,
  LogEvent,
  InsightExtractedEvent,
  QualityGatePassedEvent,
  QualityGateFailedEvent,
  ValidationRequestedEvent,
  ValidationCompletedEvent,
  KBWriteSuccessEvent,
  KBWriteFailedEvent,
} from './types';

export { DEFAULT_CONFIG, createInitialState } from './types';

// ===========================================
// Configuration
// ===========================================

export {
  loadConfig,
  loadEnvConfig,
  validateConfig,
  ENV_VARS,
  type EnvConfig,
} from './config';

// ===========================================
// Logger
// ===========================================

export {
  LearningLoopLogger,
  createLogger,
  createChildLogger,
  getLogger,
  setLogger,
  type LoggerConfig,
} from './logger';

// ===========================================
// State Management
// ===========================================

export {
  LearningLoopStateManager,
  loadStateManager,
  createStateManager,
} from './state';

// ===========================================
// Qdrant Client
// ===========================================

export {
  LearningLoopQdrantClient,
  createQdrantClient,
  DEFAULT_QDRANT_CONFIG,
  type QdrantClientConfig,
  type QdrantSearchResult,
  type InsightSearchResult,
  type DuplicateCheckResult,
  type WriteResult,
} from './qdrant-client';

// ===========================================
// Redis Client
// ===========================================

export {
  LearningLoopRedisClient,
  createRedisClient,
  DEFAULT_REDIS_CONFIG,
  type RedisClientConfig,
} from './redis-client';

// ===========================================
// Slack Client
// ===========================================

export {
  LearningLoopSlackClient,
  createSlackClient,
  DEFAULT_SLACK_CONFIG,
  type SlackClientConfig,
  type SlackMessageResult,
} from './slack-client';

// ===========================================
// Webhook Router
// ===========================================

export {
  LearningLoopWebhookRouter,
  createWebhookRouter,
  DEFAULT_WEBHOOK_CONFIG,
  type WebhookRouterConfig,
  type RequestContext,
  type ResponseContext,
  type RouteHandler,
} from './webhook';

// ===========================================
// Insight Extraction (Phase 3 - US1)
// ===========================================

export {
  InsightExtractor,
  createInsightExtractor,
  DEFAULT_EXTRACTOR_CONFIG,
  type InsightExtractorConfig,
} from './insight-extractor';

// ===========================================
// Quality Gates (Phase 4 - US2)
// ===========================================

export {
  QualityGates,
  createQualityGates,
  DEFAULT_QUALITY_GATES_CONFIG,
  type QualityGatesConfig,
} from './quality-gates';

// ===========================================
// Validation Queue (Phase 5 - US3)
// ===========================================

export {
  ValidationQueue,
  createValidationQueue,
  DEFAULT_VALIDATION_QUEUE_CONFIG,
  type ValidationQueueConfig,
  type QueueResult,
  type ValidationResult,
} from './validation-queue';

// ===========================================
// KB Writer (Phase 6 - US4)
// ===========================================

export {
  KBWriter,
  createKBWriter,
  DEFAULT_KB_WRITER_CONFIG,
  type KBWriterConfig,
  type WriteOptions,
} from './kb-writer';

// ===========================================
// Weekly Synthesis (Phase 7 - US5)
// ===========================================

export {
  WeeklySynthesizer,
  createWeeklySynthesizer,
  DEFAULT_SYNTHESIZER_CONFIG,
  type WeeklySynthesizerConfig,
  type SynthesisResult,
} from './weekly-synthesis';

// ===========================================
// Template Tracking (Phase 8 - US6)
// ===========================================

export {
  TemplateTracker,
  createTemplateTracker,
  DEFAULT_TEMPLATE_TRACKER_CONFIG,
  type TemplateTrackerConfig,
  type UsageResult,
  type OutcomeResult,
  type ABResult,
} from './template-tracker';

// ===========================================
// Main Agent (Phase 9)
// ===========================================

export {
  LearningLoopAgent,
  createLearningLoopAgent,
  createAndInitializeLearningLoopAgent,
  type LearningLoopAgentConfig,
  type CreateAgentOptions,
  type ProcessingResult,
  type AgentStats,
} from './agent';
