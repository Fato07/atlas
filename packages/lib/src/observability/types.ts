/**
 * Observability Types for Atlas GTM
 *
 * Type definitions for Langfuse integration and tracing.
 */

import type { BrainId, LeadId, ScoringTier, MessagingAngle } from '../types';

// Re-export for convenience
export type { ScoringTier, MessagingAngle } from '../types';

// ===========================================
// Agent Names
// ===========================================

/** Agent names for tracing */
export type AgentName =
  | 'lead_scorer'
  | 'reply_handler'
  | 'meeting_prep'
  | 'insight_extractor'
  | 'learning_loop';

// ===========================================
// Trace Types
// ===========================================

/** Trace metadata for agent operations */
export interface TraceMetadata {
  agentName: AgentName;
  brainId: BrainId;
  vertical?: string;
  sessionId?: string;
  userId?: string;
  tags?: string[];
  environment?: 'development' | 'staging' | 'production';
}

/** Input for creating an agent trace */
export interface CreateTraceInput {
  name: string;
  metadata: TraceMetadata;
  input?: Record<string, unknown>;
}

// ===========================================
// Generation Types (LLM Calls)
// ===========================================

/** LLM generation input */
export interface GenerationInput {
  name: string;
  model: string;
  input: unknown;
  modelParameters?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stopSequences?: string[];
  };
  metadata?: Record<string, unknown>;
}

/** LLM generation output */
export interface GenerationOutput {
  output: unknown;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
  };
  latencyMs?: number;
  error?: string;
}

// ===========================================
// Score Types
// ===========================================

/** Score data types supported by Langfuse */
export type ScoreDataType = 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN';

/** Custom score names for Atlas GTM */
export type AtlasScoreName =
  // Lead Scorer
  | 'lead_scoring_accuracy'
  | 'angle_quality'
  | 'tier_correctness'
  | 'vertical_confidence'
  | 'rule_match_quality'
  // Reply Handler
  | 'response_relevance'
  | 'classification_accuracy'
  | 'personalization_quality'
  | 'category_confidence'
  // Meeting Prep
  | 'brief_quality'
  | 'bant_extraction_confidence'
  | 'context_completeness'
  // Learning Loop
  | 'insight_extraction_quality'
  | 'insight_validation_rate'
  | 'kb_write_success_rate';

/** Input for creating a score */
export interface CreateScoreInput {
  traceId: string;
  observationId?: string;
  name: AtlasScoreName | string;
  value: number;
  dataType?: ScoreDataType;
  stringValue?: string;
  comment?: string;
  metadata?: Record<string, unknown>;
}

// ===========================================
// Lead Scorer Specific Types
// ===========================================

/** Lead scoring trace input */
export interface LeadScoringTraceInput {
  leadId: LeadId;
  brainId: BrainId;
  leadData: {
    company?: string;
    title?: string;
    industry?: string;
    employeeCount?: number;
    source?: string;
  };
}

/** Lead scoring trace output */
export interface LeadScoringTraceOutput {
  tier: ScoringTier;
  totalScore: number;
  maxPossibleScore: number;
  rulesEvaluated: number;
  knockoutTriggered: boolean;
  detectedVertical?: string;
  angles: MessagingAngle[];
  processingTimeMs: number;
}

/** Angle generation input */
export interface AngleGenerationInput {
  leadId: LeadId;
  tier: ScoringTier;
  context: {
    company: string;
    vertical: string;
    matchedRules: string[];
  };
}

/** Angle generation output */
export interface AngleGenerationOutput {
  angles: Array<{
    type: MessagingAngle;
    reasoning: string;
    confidence: number;
  }>;
  tokensUsed: {
    input: number;
    output: number;
  };
}

// ===========================================
// Span Types
// ===========================================

/** Span types for different operations */
export type SpanType = 'span' | 'generation' | 'tool';

/** Span input for creating child observations */
export interface SpanInput {
  name: string;
  type?: SpanType;
  input?: unknown;
  metadata?: Record<string, unknown>;
}

/** Span output for ending observations */
export interface SpanOutput {
  output?: unknown;
  statusMessage?: string;
  level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
}

// ===========================================
// Configuration Types
// ===========================================

/** Langfuse client configuration */
export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
  enabled?: boolean;
  flushAt?: number;
  flushInterval?: number;
  requestTimeout?: number;
}

/** Environment variable names for Langfuse */
export const LANGFUSE_ENV_VARS = {
  publicKey: 'LANGFUSE_PUBLIC_KEY',
  secretKey: 'LANGFUSE_SECRET_KEY',
  baseUrl: 'LANGFUSE_BASE_URL',
} as const;
