/**
 * Lead Scorer Agent
 *
 * Main agent class for lead scoring operations.
 * Evaluates leads against ICP rules, detects verticals,
 * calculates scores/tiers, and recommends messaging angles.
 *
 * Context Budget: 80,000 tokens
 *
 * Observability: Integrates with Langfuse for tracing when enabled.
 *
 * @module lead-scorer/agent
 */

import type { BrainId, Brain, ICPRule, LeadId, ScoringTier, MessagingAngle } from '@atlas-gtm/lib';
import {
  initLangfuse,
  getLangfuse,
  isLangfuseEnabled,
  flushLangfuse,
  createLeadScoringTrace,
  endLeadScoringTrace,
  recordLeadScoringResults,
} from '@atlas-gtm/lib/observability';
import type { LeadInput } from './contracts/lead-input';
import type { ScoringResult, TierThresholds } from './contracts/scoring-result';
import type {
  LeadScorerConfig,
  LeadScorerState,
  BatchScoringOptions,
  BatchScoringResult,
  BatchScoringError,
  ScoredLeadRecord,
  DuplicateCheckResult,
  RetryConfig,
} from './types';
import { DEFAULT_LEAD_SCORER_CONFIG } from './types';
import { needsEnrichment, countMissingFields } from './contracts/lead-input';
import { detectVertical, getDetectionMethod } from './vertical-detector';
import { evaluateAllRules, resolveRuleConflicts } from './rules';
import { calculateScore, assignTier, loadThresholds } from './scoring';
import { logger, LeadScorerLogger } from './logger';
import { recommendAngle, extractTopSignals } from './angles';
import type { RecommendAngleResult } from './angles';
import {
  createState,
  generateSessionId,
  saveState,
  checkpoint,
  clearState,
  loadState,
  canResume,
} from './state';

// ===========================================
// Agent Class
// ===========================================

/**
 * Lead Scorer Agent
 *
 * Scores leads against ICP rules from a brain (vertical-specific KB).
 */
export class LeadScorerAgent {
  private config: LeadScorerConfig;
  private logger: LeadScorerLogger;
  private brainCache: Map<string, Brain> = new Map();
  private rulesCache: Map<string, ICPRule[]> = new Map();

  constructor(config: Partial<LeadScorerConfig> = {}) {
    this.config = { ...DEFAULT_LEAD_SCORER_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * Set a custom logger
   */
  setLogger(customLogger: LeadScorerLogger): void {
    this.logger = customLogger;
  }

  // ===========================================
  // Brain Loading
  // ===========================================

  /**
   * Load brain for a vertical
   * Uses Qdrant MCP get_brain tool
   */
  async loadBrainForVertical(vertical: string): Promise<Brain | null> {
    // Check cache first
    if (this.config.enableBrainCache && this.brainCache.has(vertical)) {
      return this.brainCache.get(vertical)!;
    }

    // TODO: Replace with actual Qdrant MCP call
    // For now, return a mock brain for testing
    const brain: Brain = {
      id: `brain_${vertical}_v1` as BrainId,
      vertical,
      name: `${vertical.toUpperCase()} Brain`,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Cache the brain
    if (this.config.enableBrainCache) {
      this.brainCache.set(vertical, brain);
    }

    return brain;
  }

  /**
   * Clear the brain cache
   */
  clearBrainCache(): void {
    this.brainCache.clear();
    this.rulesCache.clear();
  }

  // ===========================================
  // Rule Querying
  // ===========================================

  /**
   * Query ICP rules for a brain
   * Uses Qdrant MCP query_icp_rules tool with brain_id filter
   */
  async queryICPRules(brainId: BrainId): Promise<ICPRule[]> {
    // Check cache first
    const cacheKey = brainId;
    if (this.config.enableBrainCache && this.rulesCache.has(cacheKey)) {
      return this.rulesCache.get(cacheKey)!;
    }

    // TODO: Replace with actual Qdrant MCP call
    // For now, return mock rules for testing
    const rules: ICPRule[] = [
      // Company size rule
      {
        id: 'rule_company_size_1',
        brain_id: brainId,
        vertical: 'iro',
        category: 'firmographic',
        attribute: 'company_size',
        display_name: 'Company Size (50-500 employees)',
        condition: { type: 'range', min: 50, max: 500 },
        operator: 'range',
        score_weight: 1.0,
        max_score: 30,
        is_knockout: false,
        reasoning: 'Target SMB segment',
        source: 'market_research',
        validated: true,
      },
      // Title rule
      {
        id: 'rule_title_vp_1',
        brain_id: brainId,
        vertical: 'iro',
        category: 'firmographic',
        attribute: 'title',
        display_name: 'VP+ Title',
        condition: { type: 'contains', value: 'vp' },
        operator: 'contains',
        score_weight: 1.0,
        max_score: 25,
        is_knockout: false,
        reasoning: 'Decision maker level',
        source: 'customer_feedback',
        validated: true,
      },
      // Funding stage rule
      {
        id: 'rule_funding_1',
        brain_id: brainId,
        vertical: 'iro',
        category: 'firmographic',
        attribute: 'funding_stage',
        display_name: 'Series B+ Funding',
        condition: { type: 'in_list', values: ['series_b', 'series_c', 'series_d_plus', 'public'] },
        operator: 'in_list',
        score_weight: 1.0,
        max_score: 20,
        is_knockout: false,
        reasoning: 'Likely to have IR needs',
        source: 'hypothesis',
        validated: false,
      },
      // Industry knockout rule
      {
        id: 'rule_industry_knockout',
        brain_id: brainId,
        vertical: 'iro',
        category: 'firmographic',
        attribute: 'industry',
        display_name: 'Excluded Industries',
        condition: { type: 'in_list', values: ['gambling', 'tobacco', 'weapons'] },
        operator: 'in_list',
        score_weight: 0,
        max_score: 0,
        is_knockout: true,
        reasoning: 'Excluded industries',
        source: 'market_research',
        validated: true,
      },
    ];

    // Cache the rules
    if (this.config.enableBrainCache) {
      this.rulesCache.set(cacheKey, rules);
    }

    return rules;
  }

  // ===========================================
  // Enrichment Check
  // ===========================================

  /**
   * Check if lead needs enrichment before scoring
   * Per FR-017: Skip scoring if >3 missing important fields
   */
  checkNeedsEnrichment(lead: LeadInput): {
    needsEnrichment: boolean;
    missingCount: number;
  } {
    const missingCount = countMissingFields(lead);
    return {
      needsEnrichment: needsEnrichment(lead),
      missingCount,
    };
  }

  // ===========================================
  // Single Lead Scoring
  // ===========================================

  /**
   * Score a single lead
   *
   * @param lead - Lead input data
   * @returns Scoring result with score, tier, angle, and breakdown
   *
   * Observability: Creates a Langfuse trace for the entire scoring operation
   * when Langfuse is enabled via environment variables.
   */
  async scoreLead(lead: LeadInput): Promise<ScoringResult> {
    const startTime = Date.now();

    // Create Langfuse trace for observability
    let traceContext: ReturnType<typeof createLeadScoringTrace> = null;
    let traceId: string | undefined;

    try {
      // 1. Detect vertical
      const verticalResult = detectVertical(lead);
      const vertical = verticalResult.vertical;

      this.logger.verticalDetected({
        lead_id: lead.lead_id,
        vertical,
        confidence: verticalResult.confidence,
        method: getDetectionMethod(verticalResult.confidence),
        signals: verticalResult.signals.map((s) => s.attribute),
      });

      // 2. Load brain for vertical
      const brain = await this.loadBrainForVertical(vertical);
      if (!brain) {
        throw new Error(`No brain found for vertical: ${vertical}`);
      }

      // Initialize Langfuse trace after we have brain context
      if (isLangfuseEnabled()) {
        traceContext = createLeadScoringTrace({
          leadId: lead.lead_id as LeadId,
          brainId: brain.id,
          leadData: {
            company: lead.company,
            title: lead.title,
            industry: lead.industry,
            employeeCount: lead.company_size,
            source: lead.source,
          },
        });
        traceId = traceContext?.traceId;
      }

      // 3. Query ICP rules
      const rules = await this.queryICPRules(brain.id);

      // 4. Evaluate all rules
      const { results, knockoutFailed } = evaluateAllRules(lead, rules);

      // 5. Resolve conflicts (highest-scoring match per attribute)
      const resolvedResults = resolveRuleConflicts(results);

      // 6. Calculate score
      const thresholds = loadThresholds();
      const { score, knockedOut } = calculateScore(resolvedResults, knockoutFailed);

      // 7. Assign tier
      const tier = assignTier(score, knockedOut, thresholds);

      // 8. Recommend messaging angle (FR-008, FR-009)
      // Use heuristics by default to avoid Claude API calls in fast path
      // Set useHeuristicsOnly: false in config to enable LLM inference
      // Pass traceId for Langfuse observability
      const angleRecommendation: RecommendAngleResult = await recommendAngle(lead, resolvedResults, {
        apiKey: this.config.anthropicApiKey,
        useHeuristicsOnly: this.config.useHeuristicsForAngle ?? true,
        minSignalsForLLM: 2,
        traceId,
      });
      const recommendedAngle = angleRecommendation.angle;
      const personalizationHints = angleRecommendation.personalization_hints;

      const processingTime = Date.now() - startTime;

      // Build result
      const result: ScoringResult = {
        lead_id: lead.lead_id,
        score,
        tier,
        scoring_breakdown: resolvedResults,
        recommended_angle: recommendedAngle,
        personalization_hints: personalizationHints,
        vertical_detected: vertical,
        brain_used: brain.id,
        knockout_failed: knockoutFailed ?? undefined,
        processing_time_ms: processingTime,
        rules_evaluated: rules.length,
        timestamp: new Date().toISOString(),
      };

      // End Langfuse trace with success
      if (traceId) {
        // Calculate max possible score from rules
        const maxPossibleScore = rules.reduce((sum, r) => sum + r.max_score, 0);

        endLeadScoringTrace(traceId, {
          tier: tier as ScoringTier,
          totalScore: score,
          maxPossibleScore,
          rulesEvaluated: rules.length,
          knockoutTriggered: knockedOut,
          detectedVertical: vertical,
          angles: [recommendedAngle] as MessagingAngle[],
          processingTimeMs: processingTime,
        });

        // Record custom scores for quality tracking
        await recordLeadScoringResults(traceId, {
          leadId: lead.lead_id as LeadId,
          brainId: brain.id,
          tier: tier as ScoringTier,
          totalScore: score,
          maxScore: maxPossibleScore,
          rulesMatched: resolvedResults.filter((r) => r.score > 0).length,
          totalRules: rules.length,
          knockoutTriggered: knockedOut,
          detectedVertical: vertical,
          verticalConfidence: verticalResult.confidence,
          angles: [recommendedAngle] as MessagingAngle[],
          angleQuality: angleRecommendation.confidence,
          angleObservationId: angleRecommendation.observationId,
        });

        // Flush traces asynchronously (don't block response)
        flushLangfuse().catch((err) => {
          console.warn('[Langfuse] Failed to flush traces:', err);
        });
      }

      // Log success
      this.logger.leadScored({
        lead_id: lead.lead_id,
        score,
        tier,
        angle: recommendedAngle,
        brain_id: brain.id,
        vertical,
        rules_evaluated: rules.length,
        processing_time_ms: processingTime,
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // End Langfuse trace with error if it was created
      if (traceId) {
        const langfuse = getLangfuse();
        if (langfuse) {
          const trace = langfuse.trace({ id: traceId });
          trace.update({
            output: { error: message },
            metadata: { failed: true, errorMessage: message },
          });
          flushLangfuse().catch(() => {});
        }
      }

      this.logger.scoringFailed({
        lead_id: lead.lead_id,
        error_code: 'SCORING_FAILED',
        error_message: message,
      });

      throw error;
    }
  }

  // ===========================================
  // Duplicate Detection (FR-014)
  // ===========================================

  /**
   * Check if lead has already been scored
   * Per FR-014: Skip already-scored unless force_rescore or data changed
   *
   * @param lead - Lead to check
   * @param forceRescore - Force re-scoring even if already scored
   * @returns Duplicate check result
   */
  async checkDuplicate(
    lead: LeadInput,
    forceRescore: boolean = false
  ): Promise<DuplicateCheckResult> {
    // Get existing record from scoring history
    const existingRecord = await this.getScoredLeadRecord(lead.lead_id);

    if (!existingRecord) {
      return {
        isDuplicate: false,
        shouldRescore: true,
        reason: 'not_found',
      };
    }

    // Force rescore overrides duplicate check
    if (forceRescore) {
      return {
        isDuplicate: true,
        existingRecord,
        shouldRescore: true,
        reason: 'force_rescore',
      };
    }

    // Check if data has changed
    const currentHash = this.hashLeadData(lead);
    if (existingRecord.data_hash && existingRecord.data_hash !== currentHash) {
      return {
        isDuplicate: true,
        existingRecord,
        shouldRescore: true,
        reason: 'data_changed',
      };
    }

    // Already scored, skip
    return {
      isDuplicate: true,
      existingRecord,
      shouldRescore: false,
      reason: 'already_scored',
    };
  }

  /**
   * Get existing score record for a lead
   * TODO: Implement with actual storage (Airtable/cache)
   */
  private async getScoredLeadRecord(
    leadId: string
  ): Promise<ScoredLeadRecord | null> {
    // TODO: Query Airtable or cache for existing score
    // For now, return null (no existing record)
    return null;
  }

  /**
   * Create a hash of lead data for change detection
   */
  private hashLeadData(lead: LeadInput): string {
    // Create deterministic hash from relevant fields
    const data = {
      company: lead.company,
      title: lead.title,
      company_size: lead.company_size,
      industry: lead.industry,
      funding_stage: lead.funding_stage,
    };
    return Buffer.from(JSON.stringify(data)).toString('base64');
  }

  // ===========================================
  // Retry with Exponential Backoff (T046)
  // ===========================================

  /**
   * Retry an operation with exponential backoff
   *
   * @param operation - Async operation to retry
   * @param config - Retry configuration
   * @returns Operation result
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig = {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 4000,
    }
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < config.maxAttempts) {
          // Calculate delay with exponential backoff: 1s, 2s, 4s
          const delay = Math.min(
            config.baseDelayMs * Math.pow(2, attempt - 1),
            config.maxDelayMs
          );

          // Wait before next attempt
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  // ===========================================
  // Batch Scoring with State Persistence (T043, T044)
  // ===========================================

  /**
   * Score multiple leads in batch with state persistence
   *
   * @param leads - Array of lead inputs
   * @param options - Batch processing options
   * @returns Array of scoring results
   */
  async scoreBatch(
    leads: LeadInput[],
    options: BatchScoringOptions = {}
  ): Promise<ScoringResult[]> {
    const {
      checkpointInterval = this.config.checkpointInterval,
      onProgress,
      resumeFromState,
    } = options;

    const results: ScoringResult[] = [];
    const errors: BatchScoringError[] = [];
    const startTime = Date.now();

    // Initialize or resume state
    let state: LeadScorerState;
    let leadsToProcess: LeadInput[];

    if (resumeFromState) {
      // Resume from provided state
      state = resumeFromState;
      const remainingIds = new Set(state.batch.remaining_ids);
      leadsToProcess = leads.filter((l) => remainingIds.has(l.lead_id));

      this.logger.info('Resuming batch from state', {
        processed: state.batch.processed,
        remaining: leadsToProcess.length,
      });
    } else {
      // Create new state
      const sessionId = generateSessionId();
      const brainId = 'batch' as BrainId; // Will be updated per-lead
      state = createState(
        sessionId,
        brainId,
        leads.map((l) => l.lead_id)
      );
      leadsToProcess = leads;
    }

    // Set session ID for logging
    this.logger.setSessionId(state.session_id);

    this.logger.batchStarted({
      batch_id: state.session_id,
      total_leads: leadsToProcess.length,
      brain_id: state.brain_id,
    });

    // Process each lead
    for (let i = 0; i < leadsToProcess.length; i++) {
      const lead = leadsToProcess[i];

      try {
        // Score with retry
        const result = await this.withRetry(() => this.scoreLead(lead));
        results.push(result);

        // Update state with checkpoint
        state = checkpoint(state, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({
          lead_id: lead.lead_id,
          error_code: 'SCORING_FAILED',
          message,
        });
      }

      // Progress callback
      if (onProgress) {
        onProgress(i + 1, leadsToProcess.length);
      }

      // Checkpoint at interval - save state to disk
      if ((i + 1) % checkpointInterval === 0) {
        saveState(state);
        this.logger.checkpointSaved({
          processed: state.batch.processed,
          remaining: state.batch.remaining_ids.length,
          last_lead_id: lead.lead_id,
        });
      }
    }

    // Final state save
    saveState(state);

    // Log batch completion
    const totalTime = Date.now() - startTime;
    const byTier = results.reduce(
      (acc, r) => {
        acc[r.tier] = (acc[r.tier] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    this.logger.batchCompleted({
      batch_id: state.session_id,
      total_processed: results.length,
      by_tier: byTier as Record<any, number>,
      avg_processing_time_ms:
        results.length > 0
          ? results.reduce((sum, r) => sum + r.processing_time_ms, 0) / results.length
          : 0,
      errors_count: errors.length,
      total_time_ms: totalTime,
    });

    // Clear state on successful completion
    if (errors.length === 0) {
      clearState();
    }

    return results;
  }

  /**
   * Resume batch processing from saved state
   *
   * @param leads - All leads (will be filtered to remaining)
   * @param options - Batch processing options
   * @returns Scoring results for remaining leads, or null if no resumable state
   */
  async resumeBatch(
    leads: LeadInput[],
    options: Omit<BatchScoringOptions, 'resumeFromState'> = {}
  ): Promise<ScoringResult[] | null> {
    const resumeCheck = canResume();

    if (!resumeCheck.canResume || !resumeCheck.state) {
      this.logger.info('No resumable state found', { reason: resumeCheck.reason });
      return null;
    }

    return this.scoreBatch(leads, {
      ...options,
      resumeFromState: resumeCheck.state,
    });
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a new LeadScorerAgent instance
 */
export function createLeadScorerAgent(
  config?: Partial<LeadScorerConfig>
): LeadScorerAgent {
  return new LeadScorerAgent(config);
}
