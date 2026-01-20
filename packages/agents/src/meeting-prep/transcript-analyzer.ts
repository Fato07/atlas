/**
 * Transcript Analyzer
 *
 * Analyzes meeting transcripts to extract BANT qualification, objections,
 * action items, key quotes, and competitive mentions using Claude structured outputs.
 *
 * Implements FR-006 (structured analysis), FR-008 (BANT extraction).
 *
 * @module meeting-prep/transcript-analyzer
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { BrainId } from '@atlas-gtm/lib';

import type { MeetingPrepLogger } from './logger';
import type { TranscriptInput, AnalysisOutput, MeetingAnalysis, BANT } from './contracts/meeting-analysis';
import {
  AnalysisOutputSchema,
  createEmptyAnalysis,
  calculateBANTScore,
  getRecommendation,
} from './contracts/meeting-analysis';

// ===========================================
// Configuration
// ===========================================

export interface TranscriptAnalyzerConfig {
  /** Claude model to use */
  model: string;

  /** Maximum tokens for analysis output */
  maxTokens: number;

  /** Minimum transcript length to process */
  minTranscriptLength: number;

  /** Temperature for analysis (lower = more consistent) */
  temperature: number;
}

export const DEFAULT_TRANSCRIPT_ANALYZER_CONFIG: TranscriptAnalyzerConfig = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  minTranscriptLength: 100,
  temperature: 0.3,
};

export interface TranscriptAnalyzerDependencies {
  /** Anthropic client for Claude */
  client: Anthropic;

  /** Logger instance */
  logger: MeetingPrepLogger;
}

// ===========================================
// Types
// ===========================================

export interface AnalyzeTranscriptRequest {
  brainId: BrainId;
  input: TranscriptInput;

  /** Optional context from the pre-call brief */
  briefContext?: {
    company_name?: string;
    attendee_name?: string;
    industry?: string;
    known_objections?: string[];
    talking_points?: string[];
  };
}

export interface AnalyzeTranscriptResult {
  success: true;
  analysis: MeetingAnalysis;
}

export interface AnalyzeTranscriptError {
  success: false;
  error: string;
  code: 'TRANSCRIPT_TOO_SHORT' | 'ANALYSIS_FAILED' | 'PARSING_ERROR';
}

export type AnalyzeTranscriptOutput = AnalyzeTranscriptResult | AnalyzeTranscriptError;

// ===========================================
// System Prompt
// ===========================================

const ANALYSIS_SYSTEM_PROMPT = `You are an expert sales analyst specializing in analyzing B2B sales call transcripts. Your role is to extract actionable insights that help sales teams qualify leads and close deals.

## Your Expertise
- BANT qualification (Budget, Authority, Need, Timeline)
- Objection identification and categorization
- Action item extraction
- Identifying key quotes that reveal buying signals or concerns
- Competitive intelligence gathering

## Analysis Guidelines

### BANT Assessment
- **Budget**: Look for mentions of budget, pricing discussions, financial constraints, or approval processes for spending
- **Authority**: Identify decision-makers, influencers, and the buying committee structure
- **Need**: Extract pain points, challenges, goals, and urgency of the problem
- **Timeline**: Find references to deadlines, implementation windows, or decision timeframes

### Confidence Scoring
- 1.0: Direct, explicit statement from the prospect
- 0.7-0.9: Strong implication or indirect confirmation
- 0.4-0.6: Some evidence but unclear
- 0.1-0.3: Weak signal, needs confirmation

### Objection Categories
- **price**: Cost, budget, ROI concerns
- **timing**: Not the right time, other priorities
- **competition**: Using or considering alternatives
- **internal_process**: Procurement, legal, approval hurdles
- **technical**: Integration, security, capability concerns
- **trust**: Vendor credibility, references, case studies
- **need**: Questioning if they actually need this

### Action Item Extraction
- Look for explicit commitments ("I'll send you...", "We should schedule...")
- Identify implied next steps from the conversation flow
- Note who is responsible: us, them, or both

Be concise but thorough. Focus on signals that help determine deal quality and next steps.`;

// ===========================================
// Transcript Analyzer Class
// ===========================================

export class TranscriptAnalyzer {
  private readonly config: TranscriptAnalyzerConfig;
  private readonly deps: TranscriptAnalyzerDependencies;

  constructor(
    deps: TranscriptAnalyzerDependencies,
    config?: Partial<TranscriptAnalyzerConfig>
  ) {
    this.config = { ...DEFAULT_TRANSCRIPT_ANALYZER_CONFIG, ...config };
    this.deps = deps;
  }

  /**
   * Analyze a meeting transcript and extract structured insights.
   */
  async analyze(request: AnalyzeTranscriptRequest): Promise<AnalyzeTranscriptOutput> {
    const { brainId, input, briefContext } = request;
    const timer = this.deps.logger.startTimer();

    this.deps.logger.debug('Starting transcript analysis', {
      meeting_id: input.meeting_id,
      transcript_length: input.transcript_text.length,
      source: input.source,
    });

    // Validate transcript length
    if (input.transcript_text.length < this.config.minTranscriptLength) {
      return {
        success: false,
        error: `Transcript too short: ${input.transcript_text.length} chars (minimum: ${this.config.minTranscriptLength})`,
        code: 'TRANSCRIPT_TOO_SHORT',
      };
    }

    try {
      // Build user prompt with context
      const userPrompt = this.buildUserPrompt(input, briefContext);

      // Call Claude with structured output
      const analysisOutput = await this.callClaudeForAnalysis(userPrompt);

      // Build complete analysis from Claude's output
      const analysis = this.buildCompleteAnalysis(
        input,
        brainId,
        analysisOutput,
        timer()
      );

      this.deps.logger.debug('Transcript analysis completed', {
        meeting_id: input.meeting_id,
        bant_score: analysis.bant.overall.score,
        recommendation: analysis.bant.overall.recommendation,
        objections_count: analysis.objections.length,
        action_items_count: analysis.action_items.length,
        duration_ms: timer(),
      });

      return {
        success: true,
        analysis,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.deps.logger.error('Transcript analysis failed', {
        meeting_id: input.meeting_id,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
        code: 'ANALYSIS_FAILED',
      };
    }
  }

  /**
   * Build the user prompt for transcript analysis.
   */
  private buildUserPrompt(
    input: TranscriptInput,
    briefContext?: AnalyzeTranscriptRequest['briefContext']
  ): string {
    const parts: string[] = [];

    // Add context if available
    if (briefContext) {
      parts.push('## Meeting Context');
      if (briefContext.attendee_name) {
        parts.push(`- **Attendee**: ${briefContext.attendee_name}`);
      }
      if (briefContext.company_name) {
        parts.push(`- **Company**: ${briefContext.company_name}`);
      }
      if (briefContext.industry) {
        parts.push(`- **Industry**: ${briefContext.industry}`);
      }
      if (briefContext.known_objections && briefContext.known_objections.length > 0) {
        parts.push(`- **Previously Identified Objections**: ${briefContext.known_objections.join(', ')}`);
      }
      if (briefContext.talking_points && briefContext.talking_points.length > 0) {
        parts.push(`- **Planned Talking Points**: ${briefContext.talking_points.join(', ')}`);
      }
      parts.push('');
    }

    // Add metadata
    parts.push('## Meeting Details');
    parts.push(`- **Date**: ${input.meeting_date}`);
    parts.push(`- **Duration**: ${input.duration_minutes ?? 30} minutes`);
    parts.push(`- **Source**: ${input.source}`);
    parts.push('');

    // Add transcript
    parts.push('## Transcript');
    parts.push('```');
    parts.push(input.transcript_text);
    parts.push('```');
    parts.push('');

    // Add instructions
    parts.push('## Instructions');
    parts.push('Analyze this transcript and extract:');
    parts.push('1. BANT qualification (Budget, Authority, Need, Timeline)');
    parts.push('2. Any objections raised and their resolution status');
    parts.push('3. Action items for both parties');
    parts.push('4. Key quotes that reveal buying signals or concerns');
    parts.push('5. Any mentions of competitors');
    parts.push('6. Recommended next steps');
    parts.push('7. A brief meeting summary');

    return parts.join('\n');
  }

  /**
   * Call Claude with structured output for analysis.
   */
  private async callClaudeForAnalysis(userPrompt: string): Promise<AnalysisOutput> {
    // Convert schema to JSON Schema for Claude
    const jsonSchema = zodToJsonSchema(AnalysisOutputSchema, {
      name: 'MeetingAnalysis',
      $refStrategy: 'none',
    });

    const response = await this.deps.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      tools: [
        {
          name: 'submit_analysis',
          description: 'Submit the structured meeting analysis',
          input_schema: jsonSchema as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: {
        type: 'tool',
        name: 'submit_analysis',
      },
    });

    // Extract tool use response
    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (!toolUseBlock) {
      throw new Error('No tool use response received from Claude');
    }

    // Parse and validate the output
    const parseResult = AnalysisOutputSchema.safeParse(toolUseBlock.input);

    if (!parseResult.success) {
      throw new Error(`Invalid analysis output: ${parseResult.error.message}`);
    }

    return parseResult.data;
  }

  /**
   * Build complete MeetingAnalysis from Claude's output.
   */
  private buildCompleteAnalysis(
    input: TranscriptInput,
    brainId: BrainId,
    output: AnalysisOutput,
    durationMs: number
  ): MeetingAnalysis {
    // Calculate BANT score and recommendation
    const bantWithoutOverall = {
      budget: output.bant.budget,
      authority: output.bant.authority,
      need: output.bant.need,
      timeline: output.bant.timeline,
    };
    const score = calculateBANTScore(bantWithoutOverall);
    const recommendation = getRecommendation(score);

    // Build complete BANT with calculated overall
    const bant: BANT = {
      ...bantWithoutOverall,
      overall: {
        score,
        recommendation,
        summary: output.bant.overall.summary,
      },
    };

    // Create base analysis
    const baseAnalysis = createEmptyAnalysis(input.meeting_id, brainId, input);

    return {
      ...baseAnalysis,
      bant,
      objections: output.objections,
      action_items: output.action_items,
      key_quotes: output.key_quotes,
      competitive_mentions: output.competitive_mentions,
      analysis_duration_ms: durationMs,
    };
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a transcript analyzer instance.
 */
export function createTranscriptAnalyzer(
  deps: TranscriptAnalyzerDependencies,
  config?: Partial<TranscriptAnalyzerConfig>
): TranscriptAnalyzer {
  return new TranscriptAnalyzer(deps, config);
}
