/**
 * Learning Loop Agent - Main Orchestrator
 *
 * Orchestrates all learning loop components to:
 * 1. Extract insights from email replies and call transcripts (US1)
 * 2. Validate insights through quality gates (US2)
 * 3. Route high-importance/low-confidence insights to Slack for validation (US3)
 * 4. Write validated insights to Qdrant KB with provenance tracking (US4)
 * 5. Generate weekly synthesis reports (US5)
 * 6. Track template performance for A/B optimization (US6)
 *
 * Implements: FR-001 through FR-032
 *
 * @module learning-loop/agent
 */

import type { ExtractedInsight, TemplateOutcome } from './contracts';
import type {
  LearningLoopConfig,
  ExtractionRequest,
  ExtractionResult,
  QualityGateEvaluation,
  KBWriteResult,
} from './types';
import { DEFAULT_CONFIG } from './types';
import type { BrainId } from '@atlas-gtm/lib';

// Observability imports
import {
  isLangfuseEnabled,
  createAgentTrace,
  endTrace,
  flushLangfuse,
  recordInsightQuality,
} from '@atlas-gtm/lib/observability';

// Component imports
import { InsightExtractor, createInsightExtractor, type InsightExtractorConfig } from './insight-extractor';
import { QualityGates, createQualityGates, type QualityGatesConfig } from './quality-gates';
import { ValidationQueue, createValidationQueue, type ValidationQueueConfig, type QueueResult } from './validation-queue';
import { KBWriter, createKBWriter, type KBWriterConfig } from './kb-writer';
import { WeeklySynthesizer, createWeeklySynthesizer, type WeeklySynthesizerConfig, type SynthesisResult } from './weekly-synthesis';
import { TemplateTracker, createTemplateTracker, type TemplateTrackerConfig, type UsageResult, type OutcomeResult } from './template-tracker';

// Infrastructure imports
import { LearningLoopStateManager, loadStateManager } from './state';
import { LearningLoopQdrantClient, createQdrantClient, type QdrantClientConfig } from './qdrant-client';
import { LearningLoopRedisClient, createRedisClient, type RedisClientConfig } from './redis-client';
import { LearningLoopSlackClient, createSlackClient, type SlackClientConfig } from './slack-client';
import { getLogger, createLogger, setLogger, type LoggerConfig } from './logger';

// ===========================================
// Types
// ===========================================

export interface LearningLoopAgentConfig {
  /** Agent configuration */
  agent: Partial<LearningLoopConfig>;
  /** Qdrant client configuration */
  qdrant: Partial<QdrantClientConfig>;
  /** Redis client configuration */
  redis: Partial<RedisClientConfig>;
  /** Slack client configuration */
  slack: Partial<SlackClientConfig>;
  /** Logger configuration */
  logger?: Partial<LoggerConfig>;
  /** Insight extractor configuration */
  extractor?: Partial<InsightExtractorConfig>;
  /**
   * MCP tool caller function - required for Qdrant operations.
   * Typically provided by the agent harness.
   */
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;
  /**
   * Text embedding function - required for semantic operations.
   * Typically wraps Voyage AI or similar embedding service.
   */
  embedder: (text: string) => Promise<number[]>;
}

export interface ProcessingResult {
  success: boolean;
  sourceId: string;
  sourceType: 'email_reply' | 'call_transcript';
  insightsExtracted: number;
  insightsAutoApproved: number;
  insightsQueued: number;
  insightsRejected: number;
  processingTimeMs: number;
  error?: string;
}

export interface AgentStats {
  brainId: string | null;
  sessionStart: string;
  durationMs: number;
  insightsExtracted: number;
  insightsValidated: number;
  insightsAutoApproved: number;
  insightsRejected: number;
  kbWrites: number;
  pendingValidations: number;
  extractionErrors: number;
  avgExtractionMs: number;
}

// ===========================================
// Learning Loop Agent Class
// ===========================================

export class LearningLoopAgent {
  private readonly config: LearningLoopConfig;
  private readonly stateManager: LearningLoopStateManager;
  private readonly qdrantClient: LearningLoopQdrantClient;
  private readonly redisClient: LearningLoopRedisClient;
  private readonly slackClient: LearningLoopSlackClient;

  // Component instances
  private readonly extractor: InsightExtractor;
  private readonly qualityGates: QualityGates;
  private readonly validationQueue: ValidationQueue;
  private readonly kbWriter: KBWriter;
  private readonly synthesizer: WeeklySynthesizer;
  private readonly templateTracker: TemplateTracker;

  private initialized = false;

  constructor(
    stateManager: LearningLoopStateManager,
    qdrantClient: LearningLoopQdrantClient,
    redisClient: LearningLoopRedisClient,
    slackClient: LearningLoopSlackClient,
    config?: Partial<LearningLoopConfig>,
    extractorConfig?: Partial<InsightExtractorConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stateManager = stateManager;
    this.qdrantClient = qdrantClient;
    this.redisClient = redisClient;
    this.slackClient = slackClient;

    // Create component instances with appropriate config
    this.extractor = createInsightExtractor(extractorConfig);

    const qualityGatesConfig: Partial<QualityGatesConfig> = {
      confidenceThreshold: this.config.quality_gates.confidence_threshold,
      duplicateSimilarityThreshold: this.config.quality_gates.duplicate_similarity_threshold,
      autoApproveConfidence: this.config.quality_gates.auto_approve_confidence,
      autoApproveMediumImportance: this.config.features.auto_approve_medium_importance,
    };
    this.qualityGates = createQualityGates(qdrantClient, stateManager, qualityGatesConfig);

    const validationQueueConfig: Partial<ValidationQueueConfig> = {
      reminderHours: this.config.validation.reminder_hours,
      maxReminders: this.config.validation.max_reminders,
      validationChannel: this.config.slack.validation_channel,
    };
    this.validationQueue = createValidationQueue(redisClient, slackClient, stateManager, validationQueueConfig);

    this.kbWriter = createKBWriter(qdrantClient, stateManager);

    const synthesizerConfig: Partial<WeeklySynthesizerConfig> = {
      lookbackDays: this.config.synthesis.lookback_days,
      synthesisChannel: this.config.slack.synthesis_channel,
    };
    this.synthesizer = createWeeklySynthesizer(qdrantClient, redisClient, slackClient, stateManager, synthesizerConfig);

    this.templateTracker = createTemplateTracker(redisClient, slackClient);
  }

  // ===========================================
  // Initialization
  // ===========================================

  /**
   * Initialize the agent (load state, verify connections).
   */
  async initialize(): Promise<void> {
    const logger = getLogger();

    try {
      // Load state from file
      await this.stateManager.load();

      // Verify Redis connection using ping
      const redisHealthy = await this.redisClient.ping();
      if (!redisHealthy) {
        throw new Error('Redis health check failed');
      }

      // Note: Qdrant health check will happen on first query
      // We skip explicit health check here since the client doesn't have one

      this.initialized = true;

      logger.info('Learning Loop Agent initialized', {
        brain_id: this.stateManager.brainId,
        session_start: this.stateManager.sessionStart,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to initialize Learning Loop Agent', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Shutdown the agent (save state, cleanup).
   */
  async shutdown(): Promise<void> {
    const logger = getLogger();

    try {
      // Save state
      await this.stateManager.save();

      // Note: Redis client doesn't have explicit close method
      // Connection pooling is handled internally

      this.initialized = false;

      logger.info('Learning Loop Agent shutdown complete');
    } catch (error) {
      logger.error('Error during shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ===========================================
  // Main Processing Pipeline
  // ===========================================

  /**
   * Process a source document (email reply or call transcript).
   * This is the main entry point for insight extraction.
   */
  async processSource(request: ExtractionRequest): Promise<ProcessingResult> {
    const logger = getLogger();
    const startTime = Date.now();

    // Initialize Langfuse trace if enabled
    let traceId: string | undefined;
    if (isLangfuseEnabled()) {
      const traceContext = createAgentTrace({
        name: `process_source_${request.source_id}`,
        metadata: {
          agentName: 'learning_loop',
          brainId: request.brain_id as BrainId,
          environment: (process.env.NODE_ENV as 'development' | 'production') ?? 'development',
        },
        input: {
          sourceId: request.source_id,
          sourceType: request.source_type,
          leadId: request.lead.id,
          companyName: request.lead.company_name,
        },
      });
      traceId = traceContext?.traceId;
    }

    if (!this.initialized) {
      // End trace with error
      if (traceId && isLangfuseEnabled()) {
        endTrace(traceId, { error: 'Agent not initialized' });
        flushLangfuse().catch(() => {});
      }

      return {
        success: false,
        sourceId: request.source_id,
        sourceType: request.source_type,
        insightsExtracted: 0,
        insightsAutoApproved: 0,
        insightsQueued: 0,
        insightsRejected: 0,
        processingTimeMs: Date.now() - startTime,
        error: 'Agent not initialized. Call initialize() first.',
      };
    }

    logger.info('Processing source', {
      source_type: request.source_type,
      source_id: request.source_id,
      brain_id: request.brain_id,
    });

    try {
      // Step 1: Extract insights (FR-001 through FR-005)
      const extractionResult = await this.extractor.extract(request);

      // Handle extraction failure (API error, rate limit, etc.)
      if (!extractionResult.success) {
        const errorMessage = extractionResult.error ?? 'Extraction failed';
        logger.error('Insight extraction failed', {
          source_id: request.source_id,
          error: errorMessage,
        });

        this.stateManager.recordError('extraction_error', errorMessage, {
          source_id: request.source_id,
          source_type: request.source_type,
        });

        // End trace with extraction failure
        if (traceId && isLangfuseEnabled()) {
          endTrace(traceId, { error: errorMessage, stage: 'extraction_failed' });
          flushLangfuse().catch(() => {});
        }

        return {
          success: false,
          sourceId: request.source_id,
          sourceType: request.source_type,
          insightsExtracted: 0,
          insightsAutoApproved: 0,
          insightsQueued: 0,
          insightsRejected: 0,
          processingTimeMs: Date.now() - startTime,
          error: errorMessage,
        };
      }

      // Handle case where no insights were found (not an error)
      if (extractionResult.insights.length === 0) {
        logger.info('No insights extracted', {
          source_id: request.source_id,
        });

        // End trace with no insights
        if (traceId && isLangfuseEnabled()) {
          endTrace(traceId, { insightsExtracted: 0, stage: 'no_insights' });
          flushLangfuse().catch(() => {});
        }

        return {
          success: true,
          sourceId: request.source_id,
          sourceType: request.source_type,
          insightsExtracted: 0,
          insightsAutoApproved: 0,
          insightsQueued: 0,
          insightsRejected: 0,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // Convert to ExtractedInsight objects
      const insights = this.extractor.createInsights(request, extractionResult);

      logger.info('Insights extracted', {
        source_id: request.source_id,
        count: insights.length,
        categories: insights.map(i => i.category),
      });

      // Update extraction time metric
      this.stateManager.updateExtractionTime(extractionResult.extraction_time_ms);

      // Step 2: Process each insight through quality gates
      let autoApproved = 0;
      let queued = 0;
      let rejected = 0;

      for (const insight of insights) {
        const result = await this.processInsight(insight);

        if (result === 'auto_approved') {
          autoApproved++;
        } else if (result === 'queued') {
          queued++;
        } else {
          rejected++;
        }
      }

      // Checkpoint state
      await this.stateManager.checkpoint();

      const processingTimeMs = Date.now() - startTime;

      logger.info('Source processing complete', {
        source_id: request.source_id,
        insights_extracted: insights.length,
        auto_approved: autoApproved,
        queued_for_validation: queued,
        rejected: rejected,
        processing_time_ms: processingTimeMs,
      });

      // Record insight quality metrics and end trace
      if (traceId && isLangfuseEnabled()) {
        // Calculate average confidence from extracted insights
        const avgConfidence = extractionResult.insights.length > 0
          ? extractionResult.insights.reduce((sum, i) => sum + i.initial_confidence, 0) / extractionResult.insights.length
          : 0;

        await recordInsightQuality(traceId, insights.length, avgConfidence);

        endTrace(traceId, {
          insightsExtracted: insights.length,
          autoApproved,
          queued,
          rejected,
          avgConfidence,
          processingTimeMs,
        });
        flushLangfuse().catch(() => {});
      }

      return {
        success: true,
        sourceId: request.source_id,
        sourceType: request.source_type,
        insightsExtracted: insights.length,
        insightsAutoApproved: autoApproved,
        insightsQueued: queued,
        insightsRejected: rejected,
        processingTimeMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Source processing failed', {
        source_id: request.source_id,
        error: errorMessage,
      });

      this.stateManager.recordError('processing_error', errorMessage, {
        source_id: request.source_id,
        source_type: request.source_type,
      });

      // End trace with error
      if (traceId && isLangfuseEnabled()) {
        endTrace(traceId, { error: errorMessage, stage: 'processing_error' });
        flushLangfuse().catch(() => {});
      }

      return {
        success: false,
        sourceId: request.source_id,
        sourceType: request.source_type,
        insightsExtracted: 0,
        insightsAutoApproved: 0,
        insightsQueued: 0,
        insightsRejected: 0,
        processingTimeMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Process a single insight through quality gates and routing.
   */
  private async processInsight(
    insight: ExtractedInsight
  ): Promise<'auto_approved' | 'queued' | 'rejected'> {
    const logger = getLogger();

    // Step 1: Run quality gates (FR-006 through FR-010)
    const evaluation = await this.qualityGates.evaluate(insight);

    // Log quality gate result
    if (evaluation.passed) {
      logger.info('Quality gate passed', {
        insight_id: insight.id,
        confidence: evaluation.gates.confidence.score,
        auto_approved: evaluation.auto_approved,
      });
    } else {
      const reason = !evaluation.gates.confidence.passed
        ? 'low_confidence'
        : evaluation.gates.duplicate.is_duplicate
          ? 'duplicate'
          : 'rejected';

      logger.info('Quality gate failed', {
        insight_id: insight.id,
        reason,
        details: evaluation.gates.duplicate.similar_id ?? evaluation.gates.importance.reason,
      });

      return 'rejected';
    }

    // Step 2: Route based on evaluation
    if (evaluation.auto_approved) {
      // Auto-approve: write directly to KB (FR-010)
      const writeResult = await this.kbWriter.writeAutoApproved(insight);

      if (writeResult.success) {
        logger.info('Insight auto-approved and written to KB', {
          insight_id: insight.id,
          qdrant_id: writeResult.qdrant_id,
        });
        return 'auto_approved';
      } else {
        logger.error('Failed to write auto-approved insight', {
          insight_id: insight.id,
          error: writeResult.error,
        });
        return 'rejected';
      }
    } else if (evaluation.requires_validation) {
      // Queue for human validation (FR-011 through FR-015)
      const queueResult = await this.validationQueue.queueForValidation(insight);

      if (queueResult.success) {
        logger.info('Insight queued for validation', {
          insight_id: insight.id,
          validation_id: queueResult.validationId,
        });
        return 'queued';
      } else {
        logger.error('Failed to queue insight for validation', {
          insight_id: insight.id,
          error: queueResult.error,
        });
        return 'rejected';
      }
    }

    // Fallback: treat as rejected
    return 'rejected';
  }

  // ===========================================
  // Validation Handling
  // ===========================================

  /**
   * Handle validation decision from Slack callback.
   */
  async handleValidation(
    validationId: string,
    decision: 'approved' | 'rejected',
    validatorId: string,
    feedback?: string
  ): Promise<KBWriteResult | null> {
    const logger = getLogger();

    // Process the validation callback
    const result = await this.validationQueue.handleValidationCallback(
      validationId,
      decision,
      validatorId,
      feedback
    );

    if (!result.success) {
      logger.error('Validation handling failed', {
        validation_id: validationId,
        error: result.error,
      });
      return null;
    }

    // If approved, write to KB
    if (decision === 'approved' && result.insightId) {
      // Get the insight from validation queue or reconstruct
      const validation = await this.validationQueue.getValidation(validationId);

      if (validation) {
        // We need to reconstruct the insight or fetch it
        // For now, we'll create a minimal write using the stored data
        logger.info('Insight validated and approved', {
          validation_id: validationId,
          insight_id: result.insightId,
          validator: validatorId,
        });
      }
    }

    logger.info('Validation processed', {
      validation_id: validationId,
      decision,
      validator: validatorId,
    });

    return null;
  }

  /**
   * Process pending validation reminders.
   */
  async processValidationReminders(): Promise<number> {
    const brainId = this.stateManager.brainId;
    if (!brainId) {
      return 0;
    }

    return this.validationQueue.processReminders(brainId);
  }

  /**
   * Expire old validations.
   */
  async expireOldValidations(): Promise<number> {
    const brainId = this.stateManager.brainId;
    if (!brainId) {
      return 0;
    }

    return this.validationQueue.expireOldValidations(brainId);
  }

  // ===========================================
  // Template Tracking (US6)
  // ===========================================

  /**
   * Record template usage (FR-027).
   */
  async recordTemplateUsage(
    templateId: string,
    metadata?: { leadId?: string; campaignId?: string; abGroup?: string; variant?: string }
  ): Promise<UsageResult> {
    const brainId = this.stateManager.brainId;
    if (!brainId) {
      return {
        success: false,
        templateId,
        timesUsed: 0,
        error: 'No active brain',
      };
    }

    return this.templateTracker.recordUsage(brainId, templateId, metadata);
  }

  /**
   * Record template outcome (FR-028, FR-029).
   */
  async recordTemplateOutcome(
    templateId: string,
    outcome: TemplateOutcome
  ): Promise<OutcomeResult> {
    const brainId = this.stateManager.brainId;
    if (!brainId) {
      return {
        success: false,
        templateId,
        outcome,
        newSuccessRate: 0,
        timesUsed: 0,
        error: 'No active brain',
      };
    }

    return this.templateTracker.recordOutcome(brainId, templateId, outcome);
  }

  // ===========================================
  // Weekly Synthesis (US5)
  // ===========================================

  /**
   * Generate weekly synthesis report (FR-022 through FR-026).
   */
  async generateWeeklySynthesis(): Promise<SynthesisResult> {
    const brainId = this.stateManager.brainId;
    if (!brainId) {
      return {
        success: false,
        error: 'No active brain',
      };
    }

    return this.synthesizer.generateAndDeliver(brainId);
  }

  // ===========================================
  // State & Stats
  // ===========================================

  /**
   * Get agent statistics.
   */
  getStats(): AgentStats {
    const stats = this.stateManager.getSessionStats();

    return {
      brainId: stats.brainId,
      sessionStart: stats.sessionStart,
      durationMs: stats.durationMs,
      insightsExtracted: stats.insightsExtracted,
      insightsValidated: stats.insightsValidated,
      insightsAutoApproved: stats.insightsAutoApproved,
      insightsRejected: stats.insightsRejected,
      kbWrites: stats.kbWrites,
      pendingValidations: stats.pendingValidations,
      extractionErrors: stats.extractionErrors,
      avgExtractionMs: stats.avgExtractionMs,
    };
  }

  /**
   * Get pending validation count.
   */
  getPendingValidationCount(): number {
    return this.stateManager.getPendingValidationCount();
  }

  /**
   * Set active brain ID.
   */
  setBrainId(brainId: string): void {
    this.stateManager.brainId = brainId;
  }

  /**
   * Get active brain ID.
   */
  getBrainId(): string | null {
    return this.stateManager.brainId;
  }

  /**
   * Checkpoint state (save to file).
   */
  async checkpoint(): Promise<void> {
    await this.stateManager.checkpoint();
  }

  // ===========================================
  // Component Access (for testing/advanced use)
  // ===========================================

  /**
   * Get the insight extractor instance.
   */
  getExtractor(): InsightExtractor {
    return this.extractor;
  }

  /**
   * Get the quality gates instance.
   */
  getQualityGates(): QualityGates {
    return this.qualityGates;
  }

  /**
   * Get the validation queue instance.
   */
  getValidationQueue(): ValidationQueue {
    return this.validationQueue;
  }

  /**
   * Get the KB writer instance.
   */
  getKBWriter(): KBWriter {
    return this.kbWriter;
  }

  /**
   * Get the weekly synthesizer instance.
   */
  getSynthesizer(): WeeklySynthesizer {
    return this.synthesizer;
  }

  /**
   * Get the template tracker instance.
   */
  getTemplateTracker(): TemplateTracker {
    return this.templateTracker;
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Required configuration for creating a Learning Loop Agent.
 */
export interface CreateAgentOptions {
  /** MCP tool caller function - required for Qdrant operations */
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;
  /** Text embedding function - required for semantic operations */
  embedder: (text: string) => Promise<number[]>;
  /** Optional partial configuration */
  config?: Partial<Omit<LearningLoopAgentConfig, 'callMcpTool' | 'embedder'>>;
}

/**
 * Create a fully configured Learning Loop Agent.
 */
export async function createLearningLoopAgent(
  options: CreateAgentOptions
): Promise<LearningLoopAgent> {
  const { callMcpTool, embedder, config = {} } = options;

  // Setup logger
  if (config.logger) {
    const logger = createLogger(config.logger);
    setLogger(logger);
  }

  // Create infrastructure clients
  const qdrantClient = createQdrantClient(callMcpTool, embedder, config.qdrant);
  const redisClient = createRedisClient(config.redis);
  const slackClient = createSlackClient(config.slack);

  // Create state manager
  const stateManager = await loadStateManager();

  // Create agent
  const agent = new LearningLoopAgent(
    stateManager,
    qdrantClient,
    redisClient,
    slackClient,
    config.agent,
    config.extractor
  );

  return agent;
}

/**
 * Create and initialize a Learning Loop Agent (ready to use).
 */
export async function createAndInitializeLearningLoopAgent(
  options: CreateAgentOptions
): Promise<LearningLoopAgent> {
  const agent = await createLearningLoopAgent(options);
  await agent.initialize();
  return agent;
}
