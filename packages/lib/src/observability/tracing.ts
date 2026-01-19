/**
 * Tracing Helpers for Atlas GTM
 *
 * Provides high-level tracing utilities for agent operations.
 * Wraps Langfuse's trace and span APIs with domain-specific helpers.
 */

import type {
  TraceMetadata,
  CreateTraceInput,
  GenerationInput,
  GenerationOutput,
  SpanInput,
  SpanOutput,
  LeadScoringTraceInput,
  LeadScoringTraceOutput,
  AngleGenerationInput,
  AngleGenerationOutput,
} from './types';
import { getLangfuse, isLangfuseEnabled } from './langfuse-client';

// ===========================================
// Types for Langfuse Objects
// ===========================================

// Langfuse trace and span types (using any for flexibility with SDK)
type LangfuseTrace = ReturnType<NonNullable<ReturnType<typeof getLangfuse>>['trace']>;
type LangfuseSpan = ReturnType<LangfuseTrace['span']>;
type LangfuseGeneration = ReturnType<LangfuseTrace['generation']>;

// ===========================================
// Trace Context Management
// ===========================================

interface TraceContext {
  trace: LangfuseTrace;
  traceId: string;
  metadata: TraceMetadata;
}

// Store for active trace contexts (keyed by trace ID)
const activeTraces = new Map<string, TraceContext>();

/**
 * Create a new agent trace
 *
 * @param input - Trace configuration
 * @returns Trace context or null if observability is disabled
 */
export function createAgentTrace(input: CreateTraceInput): TraceContext | null {
  const langfuse = getLangfuse();

  if (!langfuse || !isLangfuseEnabled()) {
    return null;
  }

  const trace = langfuse.trace({
    name: input.name,
    userId: input.metadata.userId,
    sessionId: input.metadata.sessionId,
    tags: [
      input.metadata.agentName,
      input.metadata.brainId,
      ...(input.metadata.vertical ? [input.metadata.vertical] : []),
      ...(input.metadata.tags || []),
    ],
    metadata: {
      agentName: input.metadata.agentName,
      brainId: input.metadata.brainId,
      vertical: input.metadata.vertical,
      environment: input.metadata.environment || process.env.NODE_ENV || 'development',
    },
    input: input.input,
  });

  const context: TraceContext = {
    trace,
    traceId: trace.id,
    metadata: input.metadata,
  };

  activeTraces.set(trace.id, context);

  return context;
}

/**
 * Get an active trace context by ID
 */
export function getTraceContext(traceId: string): TraceContext | null {
  return activeTraces.get(traceId) || null;
}

/**
 * End a trace and remove from active contexts
 */
export function endTrace(
  traceId: string,
  output?: Record<string, unknown>
): void {
  const context = activeTraces.get(traceId);

  if (context) {
    context.trace.update({
      output,
    });
    activeTraces.delete(traceId);
  }
}

// ===========================================
// Span Helpers
// ===========================================

/**
 * Create a child span within a trace
 */
export function createSpan(
  traceId: string,
  input: SpanInput
): LangfuseSpan | null {
  const context = activeTraces.get(traceId);

  if (!context) {
    return null;
  }

  return context.trace.span({
    name: input.name,
    input: input.input,
    metadata: input.metadata,
  });
}

/**
 * End a span with output
 */
export function endSpan(
  span: LangfuseSpan | null,
  output?: SpanOutput
): void {
  if (span) {
    span.end({
      output: output?.output,
      statusMessage: output?.statusMessage,
      level: output?.level,
    });
  }
}

// ===========================================
// Generation (LLM Call) Helpers
// ===========================================

/**
 * Create a generation span for an LLM call
 */
export function createGeneration(
  traceId: string,
  input: GenerationInput
): LangfuseGeneration | null {
  const context = activeTraces.get(traceId);

  if (!context) {
    return null;
  }

  return context.trace.generation({
    name: input.name,
    model: input.model,
    input: input.input,
    modelParameters: input.modelParameters,
    metadata: input.metadata,
  });
}

/**
 * End a generation with output and usage details
 */
export function endGeneration(
  generation: LangfuseGeneration | null,
  output: GenerationOutput
): void {
  if (generation) {
    generation.end({
      output: output.output,
      usage: output.usage
        ? {
            input: output.usage.inputTokens,
            output: output.usage.outputTokens,
            total: output.usage.totalTokens,
            ...(output.usage.cacheReadTokens && {
              cacheReadInputTokens: output.usage.cacheReadTokens,
            }),
          }
        : undefined,
      metadata: {
        latencyMs: output.latencyMs,
        ...(output.error && { error: output.error }),
      },
    });
  }
}

// ===========================================
// Lead Scorer Specific Helpers
// ===========================================

/**
 * Create a trace for lead scoring operation
 */
export function createLeadScoringTrace(
  input: LeadScoringTraceInput
): TraceContext | null {
  return createAgentTrace({
    name: `score_lead_${input.leadId}`,
    metadata: {
      agentName: 'lead_scorer',
      brainId: input.brainId,
      environment: (process.env.NODE_ENV as 'development' | 'production') || 'development',
    },
    input: {
      leadId: input.leadId,
      leadData: input.leadData,
    },
  });
}

/**
 * End a lead scoring trace with results
 */
export function endLeadScoringTrace(
  traceId: string,
  output: LeadScoringTraceOutput
): void {
  endTrace(traceId, {
    tier: output.tier,
    totalScore: output.totalScore,
    maxPossibleScore: output.maxPossibleScore,
    rulesEvaluated: output.rulesEvaluated,
    knockoutTriggered: output.knockoutTriggered,
    detectedVertical: output.detectedVertical,
    angles: output.angles,
    processingTimeMs: output.processingTimeMs,
  });
}

/**
 * Create a generation for angle recommendation
 */
export function createAngleGeneration(
  traceId: string,
  input: AngleGenerationInput
): LangfuseGeneration | null {
  return createGeneration(traceId, {
    name: 'generate_angles',
    model: 'claude-sonnet-4-20250514',
    input: {
      leadId: input.leadId,
      tier: input.tier,
      context: input.context,
    },
    metadata: {
      operation: 'angle_generation',
    },
  });
}

/**
 * End an angle generation with results
 */
export function endAngleGeneration(
  generation: LangfuseGeneration | null,
  output: AngleGenerationOutput
): void {
  endGeneration(generation, {
    output: {
      angles: output.angles,
    },
    usage: {
      inputTokens: output.tokensUsed.input,
      outputTokens: output.tokensUsed.output,
      totalTokens: output.tokensUsed.input + output.tokensUsed.output,
    },
  });
}

// ===========================================
// Utility Functions
// ===========================================

/**
 * Wrap an async function with tracing
 *
 * @param name - Name for the span
 * @param traceId - Parent trace ID
 * @param fn - Function to wrap
 * @returns Result of the function
 */
export async function withSpan<T>(
  name: string,
  traceId: string,
  fn: () => Promise<T>
): Promise<T> {
  const span = createSpan(traceId, { name });
  const startTime = Date.now();

  try {
    const result = await fn();
    endSpan(span, {
      output: { success: true },
      statusMessage: 'Completed successfully',
    });
    return result;
  } catch (error) {
    endSpan(span, {
      output: { success: false, error: String(error) },
      statusMessage: String(error),
      level: 'ERROR',
    });
    throw error;
  } finally {
    if (span) {
      span.update({
        metadata: { durationMs: Date.now() - startTime },
      });
    }
  }
}

/**
 * Wrap an LLM call with generation tracking
 *
 * @param traceId - Parent trace ID
 * @param input - Generation input
 * @param fn - Function that makes the LLM call
 * @returns Result of the LLM call
 */
export async function withGeneration<T extends { usage?: { input_tokens: number; output_tokens: number } }>(
  traceId: string,
  input: GenerationInput,
  fn: () => Promise<T>
): Promise<T> {
  const generation = createGeneration(traceId, input);
  const startTime = Date.now();

  try {
    const result = await fn();
    const latencyMs = Date.now() - startTime;

    endGeneration(generation, {
      output: result,
      usage: result.usage
        ? {
            inputTokens: result.usage.input_tokens,
            outputTokens: result.usage.output_tokens,
            totalTokens: result.usage.input_tokens + result.usage.output_tokens,
          }
        : undefined,
      latencyMs,
    });

    return result;
  } catch (error) {
    endGeneration(generation, {
      output: null,
      error: String(error),
      latencyMs: Date.now() - startTime,
    });
    throw error;
  }
}
