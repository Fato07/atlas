/**
 * Vertical Detection Module
 *
 * Data-driven vertical detection using Qdrant verticals collection.
 * Implements Clay-inspired waterfall detection strategy:
 *
 * 1. Explicit vertical (if provided in lead data) - confidence: 1.0
 * 2. Industry-based mapping (keyword matching) - confidence: 0.9
 * 3. Campaign pattern matching - confidence: 0.7
 * 4. Title keyword matching - confidence: 0.5
 * 5. AI classification fallback (optional) - confidence: 0.6+
 * 6. Default fallback - confidence: 0.1
 *
 * @module lead-scorer/vertical-detector
 */

import type { LeadInput } from './contracts/lead-input';
import type { VerticalDetectionResult, VerticalSignal } from './types';
import type {
  VerticalDetectionIndex,
  VerticalDetectionInput,
  VerticalDetectionOptions,
  AIClassificationResult,
} from '@atlas-gtm/lib';
import {
  VerticalRegistry,
  matchKeyword,
  matchCampaignPattern,
} from '@atlas-gtm/lib';

// ===========================================
// Default Vertical
// ===========================================

/**
 * Default vertical when no detection method succeeds.
 * Should be the most generic/broadly applicable vertical.
 */
export const DEFAULT_VERTICAL = 'saas';

// ===========================================
// Detection Functions (Database-Driven)
// ===========================================

/**
 * Detect vertical from explicit field
 */
function detectFromExplicit(
  input: VerticalDetectionInput,
  index: VerticalDetectionIndex
): VerticalSignal | null {
  if (!input.vertical || input.vertical.trim().length === 0) {
    return null;
  }

  const verticalLower = input.vertical.toLowerCase();

  // Check if it's a known vertical slug or alias
  const isKnownSlug =
    Array.from(index.industryToVertical.values()).includes(verticalLower) ||
    index.aliasToVertical.has(verticalLower);

  if (isKnownSlug) {
    return {
      attribute: 'vertical',
      value: input.vertical,
      matched_vertical: index.aliasToVertical.get(verticalLower) ?? verticalLower,
      weight: 1.0,
    };
  }

  // Accept any explicit vertical even if not in index
  return {
    attribute: 'vertical',
    value: input.vertical,
    matched_vertical: verticalLower,
    weight: 1.0,
  };
}

/**
 * Detect vertical from industry field using detection index
 */
function detectFromIndustry(
  input: VerticalDetectionInput,
  index: VerticalDetectionIndex
): VerticalSignal | null {
  if (!input.industry) return null;

  const match = matchKeyword(
    input.industry,
    index.industryToVertical,
    index.exclusions
  );

  if (match) {
    return {
      attribute: 'industry',
      value: input.industry,
      matched_vertical: match.vertical,
      weight: 0.9,
      matched_keyword: match.matchedKeyword,
    };
  }

  return null;
}

/**
 * Detect vertical from job title using detection index
 */
function detectFromTitle(
  input: VerticalDetectionInput,
  index: VerticalDetectionIndex
): VerticalSignal | null {
  if (!input.title) return null;

  const match = matchKeyword(
    input.title,
    index.titleToVertical,
    index.exclusions
  );

  if (match) {
    return {
      attribute: 'title',
      value: input.title,
      matched_vertical: match.vertical,
      weight: 0.5,
      matched_keyword: match.matchedKeyword,
    };
  }

  return null;
}

/**
 * Detect vertical from campaign ID using pattern matching
 */
function detectFromCampaign(
  input: VerticalDetectionInput,
  index: VerticalDetectionIndex
): VerticalSignal | null {
  if (!input.campaign_id) return null;

  const match = matchCampaignPattern(input.campaign_id, index.campaignToVertical);

  if (match) {
    return {
      attribute: 'campaign',
      value: input.campaign_id,
      matched_vertical: match.vertical,
      weight: 0.7,
      matched_keyword: match.matchedPattern,
    };
  }

  return null;
}

/**
 * Get default vertical signal
 */
function getDefaultSignal(): VerticalSignal {
  return {
    attribute: 'default',
    value: 'none',
    matched_vertical: DEFAULT_VERTICAL,
    weight: 0.1,
  };
}

// ===========================================
// Main Detection Function
// ===========================================

/**
 * Detect vertical for a lead using database-driven detection index.
 *
 * Waterfall detection order:
 * 1. Explicit vertical field (confidence: 1.0) - instant
 * 2. Industry keyword match (confidence: 0.9) - instant
 * 3. Campaign pattern match (confidence: 0.7) - instant
 * 4. Title keyword match (confidence: 0.5) - instant
 * 5. AI classification fallback (optional, confidence: 0.6+) - slower
 * 6. Default fallback (confidence: 0.1)
 *
 * @param input - Lead detection input with vertical, industry, title, campaign_id, company_name
 * @param index - Pre-built detection index for O(1) keyword lookups
 * @param options - Detection options (enableAI, aiThreshold, forceMethod)
 * @param aiClassifier - Optional AI classifier function for ambiguous cases
 * @returns Detection result with vertical, confidence, signals, and method
 *
 * @example
 * ```typescript
 * const registry = await createVerticalRegistry();
 * const index = await registry.buildDetectionIndex();
 *
 * const result = await detectVertical(
 *   { industry: 'aerospace manufacturing', title: 'Program Manager' },
 *   index,
 *   { enableAI: true }
 * );
 *
 * console.log(result);
 * // { vertical: 'defense', confidence: 0.9, method: 'industry', signals: [...] }
 * ```
 */
export async function detectVertical(
  input: VerticalDetectionInput,
  index: VerticalDetectionIndex,
  options?: VerticalDetectionOptions,
  aiClassifier?: (input: VerticalDetectionInput) => Promise<AIClassificationResult>
): Promise<VerticalDetectionResult> {
  const signals: VerticalSignal[] = [];

  // 1. Explicit vertical check
  if (!options?.forceMethod || options.forceMethod === 'explicit') {
    const explicitSignal = detectFromExplicit(input, index);
    if (explicitSignal) {
      signals.push(explicitSignal);
      return {
        vertical: explicitSignal.matched_vertical,
        confidence: explicitSignal.weight,
        signals,
        method: 'explicit',
      };
    }
  }

  // 2. Industry keyword match
  if (!options?.forceMethod || options.forceMethod === 'industry') {
    const industrySignal = detectFromIndustry(input, index);
    if (industrySignal) {
      signals.push(industrySignal);
      return {
        vertical: industrySignal.matched_vertical,
        confidence: industrySignal.weight,
        signals,
        method: 'industry',
      };
    }
  }

  // 3. Campaign pattern match
  if (!options?.forceMethod || options.forceMethod === 'campaign') {
    const campaignSignal = detectFromCampaign(input, index);
    if (campaignSignal) {
      signals.push(campaignSignal);
      return {
        vertical: campaignSignal.matched_vertical,
        confidence: campaignSignal.weight,
        signals,
        method: 'campaign',
      };
    }
  }

  // 4. Title keyword match
  if (!options?.forceMethod || options.forceMethod === 'title') {
    const titleSignal = detectFromTitle(input, index);
    if (titleSignal) {
      signals.push(titleSignal);
      return {
        vertical: titleSignal.matched_vertical,
        confidence: titleSignal.weight,
        signals,
        method: 'title',
      };
    }
  }

  // 5. AI classification fallback (if enabled and classifier provided)
  if (
    options?.enableAI !== false &&
    aiClassifier &&
    (!options?.forceMethod || options.forceMethod === 'ai')
  ) {
    try {
      const aiResult = await aiClassifier(input);
      const aiThreshold = options?.aiThreshold ?? 0.5;

      if (aiResult.confidence >= aiThreshold) {
        signals.push({
          attribute: 'ai_classification',
          value: `${input.company_name ?? input.industry ?? 'unknown'}`,
          matched_vertical: aiResult.vertical,
          weight: aiResult.confidence,
        });

        return {
          vertical: aiResult.vertical,
          confidence: aiResult.confidence,
          signals,
          method: 'ai',
          reasoning: aiResult.reasoning,
        };
      }
    } catch (error) {
      // AI classification failed - continue to default
      console.warn('AI classification failed:', error);
    }
  }

  // 6. Default fallback
  const defaultSignal = getDefaultSignal();
  signals.push(defaultSignal);
  return {
    vertical: defaultSignal.matched_vertical,
    confidence: defaultSignal.weight,
    signals,
    method: 'default',
  };
}

// ===========================================
// Convenience Wrapper
// ===========================================

/**
 * Detect vertical from a LeadInput using a VerticalRegistry.
 *
 * This is a convenience wrapper that:
 * 1. Builds the detection index from the registry
 * 2. Converts LeadInput to VerticalDetectionInput
 * 3. Calls the main detectVertical function
 *
 * @param lead - Lead input data
 * @param registry - Vertical registry instance
 * @param options - Detection options
 * @param aiClassifier - Optional AI classifier function
 * @returns Detection result
 *
 * @example
 * ```typescript
 * const registry = await createVerticalRegistry();
 *
 * const result = await detectVerticalFromLead(
 *   { industry: 'fintech', title: 'VP of Engineering', company_name: 'Stripe' },
 *   registry
 * );
 *
 * console.log(result.vertical); // 'fintech'
 * ```
 */
export async function detectVerticalFromLead(
  lead: LeadInput,
  registry: VerticalRegistry,
  options?: VerticalDetectionOptions,
  aiClassifier?: (input: VerticalDetectionInput) => Promise<AIClassificationResult>
): Promise<VerticalDetectionResult> {
  // Build detection index (cached in registry)
  const index = await registry.buildDetectionIndex();

  // Convert LeadInput to VerticalDetectionInput
  const input: VerticalDetectionInput = {
    vertical: lead.vertical,
    industry: lead.industry,
    title: lead.title,
    campaign_id: lead.campaign_id,
    company_name: lead.company,
  };

  return detectVertical(input, index, options, aiClassifier);
}

// ===========================================
// Utility Functions
// ===========================================

/**
 * Get detection method name for a confidence level
 */
export function getDetectionMethod(
  confidence: number
): 'explicit' | 'industry' | 'campaign' | 'title' | 'ai' | 'default' {
  if (confidence >= 1.0) return 'explicit';
  if (confidence >= 0.9) return 'industry';
  if (confidence >= 0.7) return 'campaign';
  if (confidence >= 0.5) return 'title';
  if (confidence >= 0.3) return 'ai';
  return 'default';
}
