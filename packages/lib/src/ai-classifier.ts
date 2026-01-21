/**
 * AI Classifier Service
 *
 * Clay-inspired AI-powered vertical classification for ambiguous cases.
 * Uses Claude Haiku for fast, cost-effective classification when
 * rule-based detection fails or produces low confidence.
 *
 * Features:
 * - Claude Haiku for speed (~200ms) and cost (~$0.001/call)
 * - Caching by company domain (24h TTL)
 * - Structured responses with confidence scoring
 * - Context-rich prompts with vertical descriptions and examples
 *
 * @module ai-classifier
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  VerticalDetectionInput,
  VerticalPayload,
  AIClassificationResult,
} from './types';

// ===========================================
// Configuration
// ===========================================

export interface AIClassifierConfig {
  /** Anthropic API key (defaults to ANTHROPIC_API_KEY env var) */
  apiKey?: string;
  /** Model to use (default: claude-3-haiku-20240307) */
  model: string;
  /** Maximum tokens for response (default: 256) */
  maxTokens: number;
  /** Cache TTL in milliseconds (default: 24 hours) */
  cacheTtlMs: number;
  /** Minimum confidence threshold (default: 0.5) */
  minConfidence: number;
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs: number;
}

export const DEFAULT_AI_CLASSIFIER_CONFIG: AIClassifierConfig = {
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-haiku-20240307',
  maxTokens: 256,
  cacheTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  minConfidence: 0.5,
  timeoutMs: 10000,
};

// ===========================================
// Types
// ===========================================

/** Cache entry for classification results */
interface CacheEntry {
  result: AIClassificationResult;
  timestamp: number;
}

/** Tool result schema for structured output */
interface ClassificationToolResult {
  vertical_slug: string;
  confidence: number;
  reasoning: string;
}

// ===========================================
// AI Classifier Class
// ===========================================

/**
 * AI-powered vertical classifier using Claude Haiku.
 *
 * Use this as a fallback when rule-based detection fails or produces
 * low confidence results. It handles messy, inconsistent industry data
 * that doesn't match keywords.
 *
 * @example
 * ```typescript
 * const classifier = new AIClassifier();
 *
 * // Load verticals from registry
 * const verticals = await registry.getVerticals();
 *
 * // Classify a lead
 * const result = await classifier.classifyVertical(
 *   { industry: 'aerospace manufacturing', company_name: 'SpaceX' },
 *   verticals
 * );
 *
 * console.log(result);
 * // { vertical: 'defense', confidence: 0.85, reasoning: '...', model: '...', cached: false }
 * ```
 */
export class AIClassifier {
  private readonly config: AIClassifierConfig;
  private readonly client: Anthropic;
  private readonly cache: Map<string, CacheEntry> = new Map();

  constructor(config?: Partial<AIClassifierConfig>) {
    this.config = { ...DEFAULT_AI_CLASSIFIER_CONFIG, ...config };

    if (!this.config.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for AIClassifier');
    }

    this.client = new Anthropic({
      apiKey: this.config.apiKey,
    });
  }

  // ===========================================
  // Main Classification Method
  // ===========================================

  /**
   * Classify a lead into a vertical using AI.
   *
   * @param input - Lead data for classification
   * @param verticals - Available verticals with descriptions and examples
   * @returns Classification result with confidence and reasoning
   */
  async classifyVertical(
    input: VerticalDetectionInput,
    verticals: VerticalPayload[]
  ): Promise<AIClassificationResult> {
    // Generate cache key from company domain or company name
    const cacheKey = this.generateCacheKey(input);

    // Check cache
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    // Build the classification prompt
    const { systemPrompt, userPrompt } = this.buildPrompt(input, verticals);

    // Define the tool for structured output
    const classificationTool: Anthropic.Tool = {
      name: 'classify_vertical',
      description: 'Classify the company into one of the available verticals',
      input_schema: {
        type: 'object' as const,
        properties: {
          vertical_slug: {
            type: 'string',
            description: 'The slug of the best-fitting vertical',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score between 0 and 1',
            minimum: 0,
            maximum: 1,
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation for the classification (1-2 sentences)',
          },
        },
        required: ['vertical_slug', 'confidence', 'reasoning'],
      },
    };

    try {
      // Call Claude with tool use
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: systemPrompt,
        tools: [classificationTool],
        tool_choice: { type: 'tool', name: 'classify_vertical' },
        messages: [{ role: 'user', content: userPrompt }],
      });

      // Extract tool use result
      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (!toolUse) {
        throw new Error('No tool use in response');
      }

      const toolInput = toolUse.input as ClassificationToolResult;

      // Validate the vertical slug exists
      const validVertical = verticals.find(
        (v) => v.slug === toolInput.vertical_slug
      );

      if (!validVertical) {
        console.warn(
          `AI returned unknown vertical: ${toolInput.vertical_slug}, using first vertical`
        );
        toolInput.vertical_slug = verticals[0]?.slug ?? 'saas';
        toolInput.confidence = 0.3;
      }

      const result: AIClassificationResult = {
        vertical: toolInput.vertical_slug,
        confidence: toolInput.confidence,
        reasoning: toolInput.reasoning,
        model: this.config.model,
        cached: false,
      };

      // Cache the result
      this.setCache(cacheKey, result);

      return result;
    } catch (error) {
      // Log error and return low-confidence default
      console.error('AI classification failed:', error);
      throw error;
    }
  }

  // ===========================================
  // Prompt Building
  // ===========================================

  /**
   * Build the classification prompt with vertical descriptions and examples.
   * Follows Clay's pattern of providing category definitions with examples.
   */
  private buildPrompt(
    input: VerticalDetectionInput,
    verticals: VerticalPayload[]
  ): { systemPrompt: string; userPrompt: string } {
    // Filter to active verticals only
    const activeVerticals = verticals.filter((v) => v.is_active);

    // Build vertical descriptions
    const verticalDescriptions = activeVerticals
      .map((v, index) => {
        const examples =
          v.example_companies.length > 0
            ? `\n   Examples: ${v.example_companies.slice(0, 5).join(', ')}`
            : '';
        const customPrompt = v.classification_prompt
          ? `\n   Note: ${v.classification_prompt}`
          : '';

        return `${index + 1}. ${v.name} (slug: "${v.slug}")
   ${v.description}${examples}${customPrompt}`;
      })
      .join('\n\n');

    const systemPrompt = `You are an expert at categorizing companies into industry verticals.
Your task is to review company data and assign the single best-fitting vertical category.

Available Verticals:
${verticalDescriptions}

Guidelines:
- Choose the SINGLE most appropriate vertical
- Assign confidence between 0-1 based on how well the data fits
- High confidence (0.8-1.0): Clear match with strong signals
- Medium confidence (0.5-0.7): Reasonable match but some ambiguity
- Low confidence (0.3-0.5): Weak match, limited information
- Provide brief reasoning (1-2 sentences) explaining your choice`;

    // Build company context
    const companyInfo: string[] = [];
    if (input.company_name) {
      companyInfo.push(`Company: ${input.company_name}`);
    }
    if (input.industry) {
      companyInfo.push(`Industry: ${input.industry}`);
    }
    if (input.title) {
      companyInfo.push(`Contact Title: ${input.title}`);
    }
    if (input.campaign_id) {
      companyInfo.push(`Campaign: ${input.campaign_id}`);
    }

    const userPrompt = `Classify this company into one of the available verticals:

${companyInfo.join('\n')}

Use the classify_vertical tool to provide your classification.`;

    return { systemPrompt, userPrompt };
  }

  // ===========================================
  // Cache Management
  // ===========================================

  /**
   * Generate cache key from input data.
   * Uses company domain or company name for deduplication.
   */
  private generateCacheKey(input: VerticalDetectionInput): string {
    // Extract domain from email if available
    const companyIdentifier = input.company_name?.toLowerCase().replace(/\s+/g, '_') ?? 'unknown';
    const industryPart = input.industry?.toLowerCase().replace(/\s+/g, '_') ?? '';

    return `${companyIdentifier}:${industryPart}`;
  }

  /**
   * Get cached result if valid.
   */
  private getFromCache(key: string): AIClassificationResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > this.config.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  /**
   * Store result in cache.
   */
  private setCache(key: string, result: AIClassificationResult): void {
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    });

    // Cleanup old entries periodically
    if (this.cache.size > 1000) {
      this.cleanupCache();
    }
  }

  /**
   * Remove expired cache entries.
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.config.cacheTtlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached results.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): { size: number; oldestAge: number | null } {
    if (this.cache.size === 0) {
      return { size: 0, oldestAge: null };
    }

    const now = Date.now();
    let oldestTimestamp = now;

    for (const entry of this.cache.values()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
    }

    return {
      size: this.cache.size,
      oldestAge: now - oldestTimestamp,
    };
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create an AI classifier instance.
 */
export function createAIClassifier(
  config?: Partial<AIClassifierConfig>
): AIClassifier {
  return new AIClassifier(config);
}

// ===========================================
// Utility Functions
// ===========================================

/**
 * Check if AI classification should be triggered.
 * Returns true when rule-based detection confidence is below threshold.
 *
 * @param ruleConfidence - Confidence from rule-based detection
 * @param aiThreshold - Threshold below which to trigger AI (default: 0.5)
 */
export function shouldTriggerAI(
  ruleConfidence: number,
  aiThreshold = 0.5
): boolean {
  return ruleConfidence < aiThreshold;
}

/**
 * Combine rule-based and AI classification results.
 * Uses AI result if it has higher confidence than the threshold.
 *
 * @param ruleResult - Result from rule-based detection
 * @param aiResult - Result from AI classification
 * @param aiMinConfidence - Minimum AI confidence to prefer AI result (default: 0.5)
 */
export function combineClassificationResults(
  ruleResult: { vertical: string; confidence: number },
  aiResult: AIClassificationResult,
  aiMinConfidence = 0.5
): { vertical: string; confidence: number; method: 'rule' | 'ai' } {
  if (aiResult.confidence >= aiMinConfidence && aiResult.confidence > ruleResult.confidence) {
    return {
      vertical: aiResult.vertical,
      confidence: aiResult.confidence,
      method: 'ai',
    };
  }

  return {
    vertical: ruleResult.vertical,
    confidence: ruleResult.confidence,
    method: 'rule',
  };
}
