/**
 * Learning Loop Insight Extractor
 *
 * Extracts insights from email replies and call transcripts using Claude.
 * Implements FR-001 through FR-005: insight extraction pipeline.
 *
 * @module learning-loop/insight-extractor
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  InsightCategory,
  InsightImportance,
  InsightSourceType,
  ExtractedInsight,
  InsightSource,
} from './contracts';
import { createExtractedInsight } from './contracts';
import type { ExtractionRequest, ExtractionResult, LearningLoopConfig } from './types';
import { getLogger } from './logger';

// ===========================================
// Types
// ===========================================

export interface InsightExtractorConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Model to use for extraction */
  model: string;
  /** Maximum tokens for response */
  maxTokens: number;
  /** Temperature for extraction */
  temperature: number;
}

export const DEFAULT_EXTRACTOR_CONFIG: InsightExtractorConfig = {
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  temperature: 0.2,
};

// ===========================================
// Extraction Prompt
// ===========================================

const EXTRACTION_SYSTEM_PROMPT = `You are an expert at extracting GTM (Go-To-Market) insights from sales conversations.

Your task is to analyze email replies or call transcripts and extract actionable insights that can improve sales effectiveness.

## Insight Categories

1. **buying_process** - Insights about how the prospect makes purchasing decisions
   - Decision makers, budget cycles, approval processes
   - Timeline expectations, evaluation criteria

2. **pain_point** - Specific problems or challenges the prospect faces
   - Current frustrations with existing solutions
   - Unmet needs, bottlenecks, inefficiencies

3. **objection** - Concerns or pushback from the prospect
   - Price concerns, competitor comparisons
   - Timing issues, internal resistance

4. **competitive_intel** - Information about competitors
   - Competitor mentions, feature comparisons
   - Pricing info, strengths/weaknesses

5. **messaging_effectiveness** - How our messaging resonated
   - What phrases/claims got positive reactions
   - What fell flat or caused confusion

6. **icp_signal** - Signals about ideal customer profile fit
   - Company size, industry, tech stack
   - Use case patterns, buying patterns

## Importance Levels

- **high** - Insights that could significantly impact deal outcomes or strategy
- **medium** - Useful insights for optimization
- **low** - Nice-to-know context

## Output Format

Return a JSON array of extracted insights. Each insight should have:
- category: One of the categories above
- content: Clear, actionable insight statement
- extracted_quote: Direct quote from source (if applicable)
- importance: high/medium/low
- actionable: Boolean - can this be acted upon?
- action_suggestion: What action to take (if actionable)
- confidence: 0.0-1.0 - how confident you are in this insight

Only extract insights that are:
1. Clearly supported by the conversation
2. Relevant to GTM operations
3. Not generic observations

If no meaningful insights can be extracted, return an empty array.`;

function buildExtractionUserPrompt(request: ExtractionRequest): string {
  const parts: string[] = [];

  parts.push(`## Source Type: ${request.source_type === 'email_reply' ? 'Email Reply' : 'Call Transcript'}`);
  parts.push(`## Source ID: ${request.source_id}`);

  if (request.lead.company_name) {
    parts.push(`## Company: ${request.lead.company_name}`);
  }
  if (request.lead.industry) {
    parts.push(`## Industry: ${request.lead.industry}`);
  }

  if (request.thread_context) {
    parts.push(`\n## Thread Context\n${request.thread_context}`);
  }

  parts.push(`\n## Content to Analyze\n${request.content}`);

  parts.push(`\n## Instructions
Extract all relevant GTM insights from the content above. Return a JSON array of insights.

Example output format:
\`\`\`json
[
  {
    "category": "pain_point",
    "content": "Prospect struggles with manual data entry taking 2+ hours daily",
    "extracted_quote": "We spend over 2 hours every day just entering data manually",
    "importance": "high",
    "actionable": true,
    "action_suggestion": "Emphasize automation capabilities in follow-up",
    "confidence": 0.9
  }
]
\`\`\`

Return ONLY the JSON array, no additional text.`);

  return parts.join('\n');
}

// ===========================================
// Insight Extractor Class
// ===========================================

export class InsightExtractor {
  private readonly config: InsightExtractorConfig;
  private readonly client: Anthropic;

  constructor(config?: Partial<InsightExtractorConfig>) {
    this.config = { ...DEFAULT_EXTRACTOR_CONFIG, ...config };
    this.client = new Anthropic({ apiKey: this.config.apiKey });
  }

  // ===========================================
  // Main Extraction Method
  // ===========================================

  /**
   * Extract insights from a source document.
   */
  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const logger = getLogger();
    const startTime = Date.now();

    try {
      // Call Claude for extraction
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildExtractionUserPrompt(request),
          },
        ],
      });

      // Parse response
      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text content in Claude response');
      }

      const extractedData = this.parseExtractionResponse(textContent.text);
      const extractionTimeMs = Date.now() - startTime;

      logger.info('Insights extracted successfully', {
        source_type: request.source_type,
        source_id: request.source_id,
        insight_count: extractedData.length,
        extraction_time_ms: extractionTimeMs,
      });

      return {
        success: true,
        insights: extractedData,
        extraction_time_ms: extractionTimeMs,
      };
    } catch (error) {
      const extractionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Insight extraction failed', {
        source_type: request.source_type,
        source_id: request.source_id,
        error: errorMessage,
        extraction_time_ms: extractionTimeMs,
      });

      return {
        success: false,
        insights: [],
        extraction_time_ms: extractionTimeMs,
        error: errorMessage,
      };
    }
  }

  /**
   * Parse Claude's response into structured insights.
   */
  private parseExtractionResponse(text: string): ExtractionResult['insights'] {
    // Try to extract JSON from response
    let jsonText = text.trim();

    // Handle markdown code blocks
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonText) as Array<{
        category: string;
        content: string;
        extracted_quote?: string | null;
        importance: string;
        actionable: boolean;
        action_suggestion?: string | null;
        confidence: number;
      }>;

      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array');
      }

      // Validate and normalize each insight
      return parsed.map(item => ({
        category: this.validateCategory(item.category),
        content: String(item.content),
        extracted_quote: item.extracted_quote ?? null,
        importance: this.validateImportance(item.importance),
        actionable: Boolean(item.actionable),
        action_suggestion: item.action_suggestion ?? null,
        initial_confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
      }));
    } catch (error) {
      getLogger().warn('Failed to parse extraction response', {
        error: error instanceof Error ? error.message : String(error),
        response_preview: text.slice(0, 200),
      });
      return [];
    }
  }

  /**
   * Validate and normalize category.
   */
  private validateCategory(category: string): InsightCategory {
    const valid: InsightCategory[] = [
      'buying_process',
      'pain_point',
      'objection',
      'competitive_intel',
      'messaging_effectiveness',
      'icp_signal',
    ];

    const normalized = category.toLowerCase().replace(/\s+/g, '_') as InsightCategory;
    return valid.includes(normalized) ? normalized : 'pain_point';
  }

  /**
   * Validate and normalize importance.
   */
  private validateImportance(importance: string): InsightImportance {
    const normalized = importance.toLowerCase() as InsightImportance;
    if (['high', 'medium', 'low'].includes(normalized)) {
      return normalized;
    }
    return 'medium';
  }

  // ===========================================
  // Helper Methods
  // ===========================================

  /**
   * Create ExtractedInsight objects from extraction results.
   */
  createInsights(
    request: ExtractionRequest,
    result: ExtractionResult
  ): ExtractedInsight[] {
    // Build source object per InsightSourceSchema
    const source: InsightSource = {
      type: request.source_type as InsightSourceType,
      source_id: request.source_id,
      lead_id: request.lead.id,
      company_id: request.lead.company_id ?? null,
      company_name: request.lead.company_name ?? null,
      conversation_context: request.thread_context ?? request.content.slice(0, 2000),
      extracted_quote: null, // Will be set per-insight
    };

    return result.insights.map(insight => {
      // Create insight-specific source with extracted quote
      const insightSource: InsightSource = {
        ...source,
        extracted_quote: insight.extracted_quote,
      };

      return createExtractedInsight({
        brainId: request.brain_id,
        category: insight.category,
        content: insight.content,
        extractedQuote: insight.extracted_quote,
        importance: insight.importance,
        actionable: insight.actionable,
        actionSuggestion: insight.action_suggestion,
        initialConfidence: insight.initial_confidence,
        source: insightSource,
      });
    });
  }

}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create an InsightExtractor instance.
 */
export function createInsightExtractor(
  config?: Partial<InsightExtractorConfig>
): InsightExtractor {
  return new InsightExtractor(config);
}
