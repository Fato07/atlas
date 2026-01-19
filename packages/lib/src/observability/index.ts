/**
 * Observability Module for Atlas GTM
 *
 * Langfuse integration for tracing, scoring, and monitoring agent operations.
 *
 * @example
 * ```typescript
 * import {
 *   initLangfuse,
 *   createLeadScoringTrace,
 *   endLeadScoringTrace,
 *   recordLeadScoringResults,
 *   flushLangfuse,
 * } from '@atlas-gtm/lib/observability';
 *
 * // Initialize on startup
 * initLangfuse();
 *
 * // Create trace for lead scoring
 * const trace = createLeadScoringTrace({
 *   leadId: 'lead_123' as LeadId,
 *   brainId: 'brain_iro_v1' as BrainId,
 *   leadData: { company: 'Acme Corp' },
 * });
 *
 * // ... do scoring work ...
 *
 * // End trace with results
 * if (trace) {
 *   endLeadScoringTrace(trace.traceId, {
 *     tier: 'qualified',
 *     totalScore: 75,
 *     maxPossibleScore: 100,
 *     rulesEvaluated: 15,
 *     knockoutTriggered: false,
 *     angles: ['roi', 'speed'],
 *     processingTimeMs: 1500,
 *   });
 *
 *   // Record quality scores
 *   await recordLeadScoringResults(trace.traceId, { ... });
 * }
 *
 * // Flush before shutdown
 * await flushLangfuse();
 * ```
 */

// Client management
export {
  initLangfuse,
  getLangfuse,
  isLangfuseEnabled,
  flushLangfuse,
  shutdownLangfuse,
  resetLangfuse,
} from './langfuse-client';

// Tracing utilities
export {
  createAgentTrace,
  getTraceContext,
  endTrace,
  createSpan,
  endSpan,
  createGeneration,
  endGeneration,
  // Lead Scorer specific
  createLeadScoringTrace,
  endLeadScoringTrace,
  createAngleGeneration,
  endAngleGeneration,
  // Utility wrappers
  withSpan,
  withGeneration,
} from './tracing';

// Scoring utilities
export {
  recordScore,
  recordScores,
  // Lead Scorer specific
  recordLeadScoringAccuracy,
  recordTierCorrectness,
  recordVerticalConfidence,
  recordAngleQuality,
  recordRuleMatchQuality,
  recordLeadScoringResults,
  // Reply Handler specific
  recordClassificationAccuracy,
  recordResponseRelevance,
} from './scoring';

// Types
export type {
  // Core types
  AgentName,
  TraceMetadata,
  CreateTraceInput,
  GenerationInput,
  GenerationOutput,
  SpanInput,
  SpanOutput,
  SpanType,
  // Score types
  ScoreDataType,
  AtlasScoreName,
  CreateScoreInput,
  // Lead Scorer types
  LeadScoringTraceInput,
  LeadScoringTraceOutput,
  AngleGenerationInput,
  AngleGenerationOutput,
  // Config types
  LangfuseConfig,
} from './types';

export { LANGFUSE_ENV_VARS } from './types';
