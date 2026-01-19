/**
 * Messaging Angle Recommendation Module
 *
 * Recommends the best messaging angle and personalization hints
 * based on top scoring signals from ICP rule evaluation.
 *
 * FR-008: Recommend messaging angle (technical, roi, compliance, speed, integration)
 * FR-009: Generate personalization hints based on matched signals
 *
 * @module lead-scorer/angles
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessagingAngle } from './contracts/scoring-result';
import type { RuleResult } from './contracts/scoring-result';
import type { LeadInput } from './contracts/lead-input';
import {
  getLangfuse,
  isLangfuseEnabled,
} from '@atlas-gtm/lib/observability';
import {
  isLakeraGuardEnabled,
  screenBeforeLLM,
} from '@atlas-gtm/lib/security';

// ===========================================
// Types
// ===========================================

export interface AngleRecommendation {
  angle: MessagingAngle;
  confidence: number;
  reasoning: string;
  personalization_hints: string[];
}

export interface SignalSummary {
  attribute: string;
  value: unknown;
  score: number;
  max_score: number;
  percentage: number;
  reasoning: string;
}

// ===========================================
// Signal Extraction
// ===========================================

/**
 * Extract top N highest-scoring rule results
 * Used as input for angle inference
 */
export function extractTopSignals(
  results: RuleResult[],
  topN: number = 5
): SignalSummary[] {
  // Filter to only passing rules (score > 0) and sort by score descending
  const passingRules = results
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return passingRules.map((r) => ({
    attribute: r.attribute,
    value: r.value,
    score: r.score,
    max_score: r.max_score,
    percentage: r.max_score > 0 ? Math.round((r.score / r.max_score) * 100) : 0,
    reasoning: r.reasoning,
  }));
}

// ===========================================
// Angle Inference Prompt
// ===========================================

/**
 * Generate the Claude prompt for angle inference
 */
export function buildAnglePrompt(
  lead: LeadInput,
  signals: SignalSummary[]
): string {
  const signalsText = signals
    .map(
      (s) =>
        `- ${s.attribute}: ${JSON.stringify(s.value)} (${s.percentage}% match, +${s.score}pts)`
    )
    .join('\n');

  return `You are an expert sales strategist analyzing a lead to determine the best messaging angle for outreach.

## Lead Information
- Company: ${lead.company}
- Industry: ${lead.industry || 'Unknown'}
- Title: ${lead.title || 'Unknown'}
- Company Size: ${lead.company_size || 'Unknown'}
- Funding Stage: ${lead.funding_stage || 'Unknown'}
- Tech Stack: ${lead.tech_stack?.join(', ') || 'Unknown'}
- Location: ${lead.location || 'Unknown'}

## Top Scoring Signals
${signalsText || 'No strong signals detected'}

## Available Messaging Angles
1. **technical** - Lead with product capabilities, automation, technical features
2. **roi** - Lead with cost savings, efficiency gains, time savings
3. **compliance** - Lead with regulatory requirements, reporting needs, audit readiness
4. **speed** - Lead with quick implementation, fast time-to-value, rapid deployment
5. **integration** - Lead with ecosystem compatibility, existing tool connections

## Your Task
Based on the lead information and scoring signals, determine:
1. The best messaging angle from the 5 options above
2. 2-4 specific personalization hints for the outreach (e.g., "Mention their recent Series B", "Reference their Salesforce integration")

Respond ONLY with valid JSON in this exact format:
{
  "angle": "technical" | "roi" | "compliance" | "speed" | "integration",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of why this angle fits best",
  "personalization_hints": ["hint 1", "hint 2", "hint 3"]
}`;
}

// ===========================================
// Claude API Integration
// ===========================================

// Default model for angle inference (fast, cheap, good enough)
const ANGLE_MODEL = 'claude-3-5-haiku-latest';

/**
 * Options for Claude angle inference with observability
 */
export interface ClaudeAngleOptions {
  apiKey?: string;
  /** Parent trace ID for Langfuse observability */
  traceId?: string;
  /** Lead ID for metadata */
  leadId?: string;
}

/**
 * Result from Claude angle call including observability metadata
 */
export interface ClaudeAngleResult extends AngleRecommendation {
  /** Langfuse observation ID for scoring */
  observationId?: string;
  /** Token usage from the API call */
  tokensUsed?: {
    input: number;
    output: number;
  };
}

/**
 * Call Claude to infer messaging angle
 *
 * Tracks the generation in Langfuse for observability when enabled.
 */
export async function callClaudeForAngle(
  prompt: string,
  apiKey?: string
): Promise<AngleRecommendation>;
export async function callClaudeForAngle(
  prompt: string,
  options: ClaudeAngleOptions
): Promise<ClaudeAngleResult>;
export async function callClaudeForAngle(
  prompt: string,
  apiKeyOrOptions?: string | ClaudeAngleOptions
): Promise<AngleRecommendation | ClaudeAngleResult> {
  // Parse options
  const options: ClaudeAngleOptions = typeof apiKeyOrOptions === 'string'
    ? { apiKey: apiKeyOrOptions }
    : apiKeyOrOptions || {};

  const { apiKey, traceId, leadId } = options;

  const anthropic = new Anthropic({
    apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
  });

  const langfuse = getLangfuse();
  const langfuseEnabled = isLangfuseEnabled() && langfuse !== null && traceId;

  // Create Langfuse generation for tracking
  type LangfuseGeneration = ReturnType<NonNullable<typeof langfuse>['generation']>;
  let generation: LangfuseGeneration | null = null;
  if (langfuseEnabled && langfuse !== null) {
    generation = langfuse.generation({
      traceId,
      name: 'angle_inference',
      model: ANGLE_MODEL,
      input: { prompt },
      metadata: {
        leadId,
        promptLength: prompt.length,
      },
    });
  }

  const startTime = Date.now();
  let errorOccurred: Error | null = null;

  // Security screening before LLM call
  let safePrompt = prompt;
  if (isLakeraGuardEnabled()) {
    const securityResult = await screenBeforeLLM(
      prompt,
      'angle_inference',
      traceId
    );

    if (!securityResult.passed) {
      // End Langfuse generation with security block
      if (generation) {
        generation.end({
          output: null,
          level: 'WARNING',
          statusMessage: `Security blocked: ${securityResult.reason}`,
          metadata: {
            latencyMs: Date.now() - startTime,
            securityBlocked: true,
            reason: securityResult.reason,
          },
        });
      }
      throw new Error(`Security blocked: ${securityResult.reason}`);
    }

    // Use sanitized content if PII was masked
    safePrompt = securityResult.sanitizedContent ?? prompt;
  }

  try {
    const response = await anthropic.messages.create({
      model: ANGLE_MODEL,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: safePrompt,
        },
      ],
    });

    const latencyMs = Date.now() - startTime;

    // Extract text content from response
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as AngleRecommendation;

    // Validate angle is one of the allowed values
    const validAngles: MessagingAngle[] = [
      'technical',
      'roi',
      'compliance',
      'speed',
      'integration',
    ];
    if (!validAngles.includes(parsed.angle)) {
      throw new Error(`Invalid angle from Claude: ${parsed.angle}`);
    }

    const result: ClaudeAngleResult = {
      angle: parsed.angle,
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
      reasoning: parsed.reasoning || 'No reasoning provided',
      personalization_hints: parsed.personalization_hints || [],
    };

    // Track token usage
    if (response.usage) {
      result.tokensUsed = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      };
    }

    // End Langfuse generation with success
    if (generation) {
      result.observationId = generation.id;
      generation.end({
        output: result,
        usage: response.usage ? {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          total: response.usage.input_tokens + response.usage.output_tokens,
        } : undefined,
        metadata: {
          latencyMs,
          angle: result.angle,
          confidence: result.confidence,
        },
      });
    }

    return result;
  } catch (error) {
    errorOccurred = error instanceof Error ? error : new Error(String(error));

    // End Langfuse generation with error
    if (generation) {
      generation.end({
        output: null,
        level: 'ERROR',
        statusMessage: errorOccurred.message,
        metadata: {
          latencyMs: Date.now() - startTime,
          error: errorOccurred.message,
        },
      });
    }

    throw errorOccurred;
  }
}

// ===========================================
// Main Recommendation Functions
// ===========================================

/**
 * Options for angle recommendation
 */
export interface RecommendAngleOptions {
  apiKey?: string;
  useHeuristicsOnly?: boolean;
  minSignalsForLLM?: number;
  /** Parent trace ID for Langfuse observability */
  traceId?: string;
}

/**
 * Result from angle recommendation including observability metadata
 */
export interface RecommendAngleResult extends AngleRecommendation {
  /** Langfuse observation ID for scoring */
  observationId?: string;
  /** Token usage if LLM was called */
  tokensUsed?: {
    input: number;
    output: number;
  };
  /** Whether heuristics were used instead of LLM */
  usedHeuristics: boolean;
}

/**
 * Recommend messaging angle based on scoring signals
 *
 * Uses Claude claude-3-5-haiku for inference when signals are strong enough,
 * falls back to heuristics for simple cases.
 *
 * Tracks the operation in Langfuse when traceId is provided.
 */
export async function recommendAngle(
  lead: LeadInput,
  results: RuleResult[],
  options: RecommendAngleOptions = {}
): Promise<RecommendAngleResult> {
  const {
    apiKey,
    useHeuristicsOnly = false,
    minSignalsForLLM = 2,
    traceId,
  } = options;

  const topSignals = extractTopSignals(results, 5);

  // If too few signals or heuristics-only mode, use rule-based approach
  if (useHeuristicsOnly || topSignals.length < minSignalsForLLM) {
    const heuristicResult = inferAngleFromHeuristics(lead, topSignals);
    return {
      ...heuristicResult,
      usedHeuristics: true,
    };
  }

  try {
    const prompt = buildAnglePrompt(lead, topSignals);
    const claudeResult = await callClaudeForAngle(prompt, {
      apiKey,
      traceId,
      leadId: lead.lead_id,
    });

    return {
      ...claudeResult,
      usedHeuristics: false,
    };
  } catch (error) {
    // Fallback to heuristics on LLM error
    console.warn('Claude angle inference failed, using heuristics:', error);
    const heuristicResult = inferAngleFromHeuristics(lead, topSignals);
    return {
      ...heuristicResult,
      usedHeuristics: true,
    };
  }
}

/**
 * Generate personalization hints from matched signals
 */
export function generatePersonalizationHints(
  lead: LeadInput,
  signals: SignalSummary[]
): string[] {
  const hints: string[] = [];

  // Funding stage hint
  if (lead.funding_stage) {
    const stageDisplay = lead.funding_stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    hints.push(`Mention their ${stageDisplay} funding stage`);
  }

  // Tech stack hints
  if (lead.tech_stack && lead.tech_stack.length > 0) {
    const topTech = lead.tech_stack.slice(0, 2).join(' and ');
    hints.push(`Reference their ${topTech} stack`);
  }

  // Company size hint
  if (lead.company_size) {
    if (lead.company_size >= 500) {
      hints.push('Emphasize enterprise-grade scalability');
    } else if (lead.company_size >= 100) {
      hints.push('Highlight growth-stage company features');
    } else {
      hints.push('Focus on quick setup and lean team benefits');
    }
  }

  // Industry-specific hints
  if (lead.industry) {
    const industry = lead.industry.toLowerCase();
    if (industry.includes('fintech') || industry.includes('financial')) {
      hints.push('Highlight compliance and security features');
    } else if (industry.includes('health')) {
      hints.push('Emphasize HIPAA compliance capabilities');
    } else if (industry.includes('investor') || industry.includes('ir')) {
      hints.push('Focus on investor communication efficiency');
    }
  }

  // Recent news/signals hints
  if (lead.recent_news && lead.recent_news.length > 0) {
    hints.push(`Reference their recent news: "${lead.recent_news[0]}"`);
  }

  // Hiring signals hint
  if (lead.hiring_signals && lead.hiring_signals.length > 0) {
    hints.push('Mention their growth trajectory based on hiring');
  }

  return hints.slice(0, 4); // Max 4 hints
}

// ===========================================
// Heuristic Fallback
// ===========================================

/**
 * Signal keywords that map to each angle
 */
const ANGLE_KEYWORDS: Record<MessagingAngle, string[]> = {
  technical: [
    'tech_stack',
    'engineering',
    'developer',
    'api',
    'integration',
    'automation',
    'platform',
    'software',
    'cto',
    'vp of engineering',
  ],
  roi: [
    'revenue',
    'cost',
    'efficiency',
    'savings',
    'budget',
    'cfo',
    'finance',
    'growth',
    'scale',
    'performance',
  ],
  compliance: [
    'regulatory',
    'compliance',
    'sec',
    'audit',
    'reporting',
    'legal',
    'governance',
    'risk',
    'public company',
    'investor relations',
  ],
  speed: [
    'startup',
    'fast',
    'agile',
    'launch',
    'rapid',
    'quick',
    'immediate',
    'urgent',
    'seed',
    'series_a',
  ],
  integration: [
    'salesforce',
    'hubspot',
    'slack',
    'microsoft',
    'google',
    'tools',
    'ecosystem',
    'workflow',
    'connect',
    'sync',
  ],
};

/**
 * Infer angle from heuristics when LLM is unavailable
 */
export function inferAngleFromHeuristics(
  lead: LeadInput,
  signals: SignalSummary[]
): AngleRecommendation {
  const scores: Record<MessagingAngle, number> = {
    technical: 0,
    roi: 0,
    compliance: 0,
    speed: 0,
    integration: 0,
  };

  // Build searchable text from lead and signals
  const searchText = [
    lead.title || '',
    lead.industry || '',
    lead.company || '',
    lead.funding_stage || '',
    ...(lead.tech_stack || []),
    ...signals.map((s) => `${s.attribute} ${JSON.stringify(s.value)}`),
  ]
    .join(' ')
    .toLowerCase();

  // Score each angle based on keyword matches
  for (const [angle, keywords] of Object.entries(ANGLE_KEYWORDS) as [
    MessagingAngle,
    string[],
  ][]) {
    for (const keyword of keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        scores[angle] += 1;
      }
    }
  }

  // Find highest scoring angle
  let bestAngle: MessagingAngle = 'technical'; // Default
  let bestScore = 0;

  for (const [angle, score] of Object.entries(scores) as [
    MessagingAngle,
    number,
  ][]) {
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }

  // Calculate confidence based on score difference
  const totalScore = Object.values(scores).reduce((sum, s) => sum + s, 0);
  const confidence =
    totalScore > 0 ? Math.min(0.8, bestScore / totalScore + 0.2) : 0.3;

  // Generate hints
  const hints = generatePersonalizationHints(lead, signals);

  return {
    angle: bestAngle,
    confidence,
    reasoning: `Heuristic match: ${bestScore} keyword matches for ${bestAngle} angle`,
    personalization_hints: hints,
  };
}
