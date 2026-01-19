/**
 * Reply Handler Agent - Tier Router
 *
 * Determines routing tier for replies based on classification, KB match,
 * and business rules. Implements FR-009, FR-010, FR-011 for tier routing.
 *
 * @module reply-handler/router
 */

import type {
  Classification,
  KBMatch,
  TierRouting,
  RoutingFactor,
  Intent,
} from './contracts/handler-result';
import type { LeadContext } from './contracts/reply-input';
import type { TierThresholds } from './types';
import { DEFAULT_TIER_THRESHOLDS } from './types';

// ===========================================
// Router Configuration
// ===========================================

export interface RouterConfig {
  /** Tier routing thresholds */
  thresholds?: Partial<TierThresholds>;

  /** Override rules */
  overrides?: {
    /** Always escalate specific intents */
    alwaysEscalateIntents?: Intent[];

    /** Always auto-respond to specific intents */
    alwaysAutoRespondIntents?: Intent[];
  };
}

// ===========================================
// Tier Router Class
// ===========================================

export class TierRouter {
  private thresholds: TierThresholds;
  private overrides: RouterConfig['overrides'];

  constructor(config: RouterConfig = {}) {
    this.thresholds = {
      ...DEFAULT_TIER_THRESHOLDS,
      ...config.thresholds,
    };
    this.overrides = config.overrides ?? {};
  }

  // ===========================================
  // Main Routing Method
  // ===========================================

  /**
   * Determine routing tier for a reply
   */
  route(params: {
    classification: Classification;
    kbMatch?: KBMatch;
    leadContext?: LeadContext;
  }): TierRouting {
    const { classification, kbMatch, leadContext } = params;
    const factors: RoutingFactor[] = [];

    // Step 1: Check for override conditions (Tier 3 escalation)
    const overrideResult = this.checkOverrides(classification, leadContext);
    if (overrideResult) {
      return this.createRoutingResult(3, overrideResult.reason, factors, true, overrideResult.reason);
    }

    // Step 2: Check for Tier 1 auto-respond conditions (FR-009)
    const tier1Result = this.checkTier1Eligibility(classification, kbMatch, factors);
    if (tier1Result.eligible) {
      return this.createRoutingResult(1, tier1Result.reason, factors);
    }

    // Step 3: Check for Tier 3 escalation conditions (FR-011)
    const tier3Result = this.checkTier3Conditions(classification, kbMatch, leadContext, factors);
    if (tier3Result.shouldEscalate) {
      return this.createRoutingResult(3, tier3Result.reason, factors, true, tier3Result.reason);
    }

    // Step 4: Default to Tier 2 (FR-010)
    return this.createRoutingResult(
      2,
      'KB match requires approval (confidence 50-85%)',
      factors
    );
  }

  // ===========================================
  // Override Checks
  // ===========================================

  /**
   * Check for business rule overrides
   */
  private checkOverrides(
    classification: Classification,
    leadContext?: LeadContext
  ): { reason: string } | undefined {
    // Check configured escalation intents
    if (this.overrides?.alwaysEscalateIntents?.includes(classification.intent)) {
      return { reason: `Intent "${classification.intent}" configured for automatic escalation` };
    }

    // Check high-value deal threshold (FR-011)
    if (
      leadContext?.deal_value &&
      leadContext.deal_value >= this.thresholds.high_value_deal_threshold
    ) {
      return {
        reason: `High-value deal ($${leadContext.deal_value.toLocaleString()}) exceeds $${this.thresholds.high_value_deal_threshold.toLocaleString()} threshold`,
      };
    }

    return undefined;
  }

  // ===========================================
  // Tier 1 Eligibility (FR-009)
  // ===========================================

  /**
   * Check if reply qualifies for Tier 1 auto-response
   */
  private checkTier1Eligibility(
    classification: Classification,
    kbMatch: KBMatch | undefined,
    factors: RoutingFactor[]
  ): { eligible: boolean; reason: string } {
    // Auto-respond intents (out_of_office, bounce, unsubscribe) always Tier 1
    const autoRespondIntents: Intent[] = ['out_of_office', 'bounce', 'unsubscribe'];

    // Add configured auto-respond intents
    if (this.overrides?.alwaysAutoRespondIntents) {
      autoRespondIntents.push(...this.overrides.alwaysAutoRespondIntents);
    }

    if (autoRespondIntents.includes(classification.intent)) {
      factors.push({
        factor: 'intent',
        value: classification.intent,
        weight: 1.0,
        direction: 'tier_1',
      });

      return {
        eligible: true,
        reason: `Auto-respond intent: ${classification.intent}`,
      };
    }

    // High-confidence positive interest with KB match (FR-009)
    if (
      classification.intent === 'positive_interest' &&
      kbMatch &&
      kbMatch.confidence >= this.thresholds.tier1_min_confidence
    ) {
      factors.push(
        {
          factor: 'intent',
          value: classification.intent,
          weight: 0.4,
          direction: 'tier_1',
        },
        {
          factor: 'kb_match_confidence',
          value: kbMatch.confidence,
          weight: 0.4,
          direction: 'tier_1',
        },
        {
          factor: 'intent_confidence',
          value: classification.intent_confidence,
          weight: 0.2,
          direction: 'tier_1',
        }
      );

      return {
        eligible: true,
        reason: `High-confidence positive interest (KB: ${(kbMatch.confidence * 100).toFixed(0)}%)`,
      };
    }

    // Not eligible for Tier 1
    factors.push({
      factor: 'tier1_check',
      value: 'failed',
      weight: 0,
      direction: 'neutral',
    });

    return {
      eligible: false,
      reason: 'Does not meet Tier 1 criteria',
    };
  }

  // ===========================================
  // Tier 3 Escalation Conditions (FR-011)
  // ===========================================

  /**
   * Check if reply should escalate to Tier 3
   */
  private checkTier3Conditions(
    classification: Classification,
    kbMatch: KBMatch | undefined,
    leadContext: LeadContext | undefined,
    factors: RoutingFactor[]
  ): { shouldEscalate: boolean; reason: string } {
    // Negative sentiment threshold (FR-011)
    if (classification.sentiment < this.thresholds.negative_sentiment_threshold) {
      factors.push({
        factor: 'sentiment',
        value: classification.sentiment,
        weight: 1.0,
        direction: 'tier_3',
      });

      return {
        shouldEscalate: true,
        reason: `Negative sentiment (${classification.sentiment.toFixed(2)}) below ${this.thresholds.negative_sentiment_threshold} threshold`,
      };
    }

    // Complex reply (FR-011)
    if (classification.complexity === 'complex') {
      factors.push({
        factor: 'complexity',
        value: classification.complexity,
        weight: 0.8,
        direction: 'tier_3',
      });

      return {
        shouldEscalate: true,
        reason: 'Complex reply requires human handling',
      };
    }

    // Low KB match confidence (FR-011)
    if (!kbMatch || kbMatch.confidence < this.thresholds.tier2_min_confidence) {
      factors.push({
        factor: 'kb_match_confidence',
        value: kbMatch?.confidence ?? 0,
        weight: 0.7,
        direction: 'tier_3',
      });

      return {
        shouldEscalate: true,
        reason: kbMatch
          ? `Low KB match confidence (${(kbMatch.confidence * 100).toFixed(0)}% < ${(this.thresholds.tier2_min_confidence * 100).toFixed(0)}%)`
          : 'No matching KB template found',
      };
    }

    // Unclear intent (FR-011)
    if (classification.intent === 'unclear') {
      factors.push({
        factor: 'intent',
        value: classification.intent,
        weight: 0.6,
        direction: 'tier_3',
      });

      return {
        shouldEscalate: true,
        reason: 'Unable to determine reply intent',
      };
    }

    // Not interested with potential (check lead score)
    if (
      classification.intent === 'not_interested' &&
      leadContext?.lead_score &&
      leadContext.lead_score >= 70
    ) {
      factors.push({
        factor: 'lead_score',
        value: leadContext.lead_score,
        weight: 0.5,
        direction: 'tier_3',
      });

      return {
        shouldEscalate: true,
        reason: `High-value lead (score: ${leadContext.lead_score}) declined - requires review`,
      };
    }

    // Tier 2 eligible
    factors.push({
      factor: 'tier3_check',
      value: 'passed',
      weight: 0,
      direction: 'tier_2',
    });

    return {
      shouldEscalate: false,
      reason: '',
    };
  }

  // ===========================================
  // Result Builder
  // ===========================================

  /**
   * Create routing result
   */
  private createRoutingResult(
    tier: 1 | 2 | 3,
    reason: string,
    factors: RoutingFactor[],
    overrideApplied: boolean = false,
    overrideReason?: string
  ): TierRouting {
    return {
      tier,
      reason,
      factors,
      override_applied: overrideApplied,
      override_reason: overrideReason,
      routed_at: new Date().toISOString(),
    };
  }

  // ===========================================
  // Threshold Management
  // ===========================================

  /**
   * Get current thresholds
   */
  getThresholds(): Readonly<TierThresholds> {
    return { ...this.thresholds };
  }

  /**
   * Update thresholds
   */
  updateThresholds(updates: Partial<TierThresholds>): void {
    this.thresholds = { ...this.thresholds, ...updates };
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a tier router
 */
export function createRouter(config?: RouterConfig): TierRouter {
  return new TierRouter(config);
}

// ===========================================
// Routing Utilities
// ===========================================

/**
 * Get human-readable tier description
 */
export function getTierDescription(tier: 1 | 2 | 3): string {
  switch (tier) {
    case 1:
      return 'Auto-Respond';
    case 2:
      return 'Draft for Approval';
    case 3:
      return 'Human Escalation';
  }
}

/**
 * Get tier action description
 */
export function getTierAction(tier: 1 | 2 | 3): string {
  switch (tier) {
    case 1:
      return 'Response will be sent automatically';
    case 2:
      return 'Draft will be sent to Slack for approval';
    case 3:
      return 'Reply will be escalated for human handling';
  }
}

/**
 * Calculate routing confidence score
 */
export function calculateRoutingConfidence(routing: TierRouting): number {
  if (routing.factors.length === 0) return 0.5;

  let totalWeight = 0;
  let weightedScore = 0;

  for (const factor of routing.factors) {
    totalWeight += factor.weight;

    // Calculate factor contribution based on direction alignment with tier
    const directionScore =
      factor.direction === `tier_${routing.tier}`
        ? 1.0
        : factor.direction === 'neutral'
          ? 0.5
          : 0.2;

    weightedScore += factor.weight * directionScore;
  }

  return totalWeight > 0 ? weightedScore / totalWeight : 0.5;
}
