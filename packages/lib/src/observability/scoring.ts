/**
 * Custom Scoring Helpers for Atlas GTM
 *
 * Provides utilities for recording custom quality scores in Langfuse.
 * Used for tracking accuracy, quality metrics, and ML model performance.
 */

import type {
  CreateScoreInput,
  AtlasScoreName,
} from './types';
import { getLangfuse, isLangfuseEnabled } from './langfuse-client';
import type { BrainId, LeadId, ScoringTier, MessagingAngle } from '../types';

// ===========================================
// Score Recording
// ===========================================

/**
 * Record a custom score for a trace or observation
 *
 * @param input - Score configuration
 */
export async function recordScore(input: CreateScoreInput): Promise<void> {
  const langfuse = getLangfuse();

  if (!langfuse || !isLangfuseEnabled()) {
    return;
  }

  try {
    await langfuse.score({
      traceId: input.traceId,
      observationId: input.observationId,
      name: input.name,
      value: input.value,
      dataType: input.dataType,
      comment: input.comment,
    });
  } catch (error) {
    console.error('[Langfuse] Failed to record score:', error);
  }
}

/**
 * Record multiple scores in batch
 *
 * @param scores - Array of score inputs
 */
export async function recordScores(scores: CreateScoreInput[]): Promise<void> {
  for (const score of scores) {
    await recordScore(score);
  }
}

// ===========================================
// Lead Scorer Specific Scores
// ===========================================

/**
 * Record lead scoring accuracy score
 *
 * @param traceId - Trace ID for the scoring operation
 * @param accuracy - Accuracy value (0-1)
 * @param comment - Optional comment
 */
export async function recordLeadScoringAccuracy(
  traceId: string,
  accuracy: number,
  comment?: string
): Promise<void> {
  await recordScore({
    traceId,
    name: 'lead_scoring_accuracy',
    value: Math.max(0, Math.min(1, accuracy)),
    dataType: 'NUMERIC',
    comment: comment || `Lead scoring accuracy: ${(accuracy * 100).toFixed(1)}%`,
  });
}

/**
 * Record tier assignment correctness
 *
 * @param traceId - Trace ID
 * @param assignedTier - Tier assigned by the system
 * @param expectedTier - Expected tier (if known for validation)
 * @param isCorrect - Whether the assignment was correct
 */
export async function recordTierCorrectness(
  traceId: string,
  assignedTier: ScoringTier,
  expectedTier?: ScoringTier,
  isCorrect?: boolean
): Promise<void> {
  const value = isCorrect !== undefined ? (isCorrect ? 1 : 0) : 0.5; // 0.5 for unknown

  await recordScore({
    traceId,
    name: 'tier_correctness',
    value,
    dataType: isCorrect !== undefined ? 'BOOLEAN' : 'NUMERIC',
    stringValue: assignedTier,
    comment: expectedTier
      ? `Assigned: ${assignedTier}, Expected: ${expectedTier}`
      : `Assigned tier: ${assignedTier}`,
    metadata: {
      assignedTier,
      expectedTier,
    },
  });
}

/**
 * Record vertical detection confidence
 *
 * @param traceId - Trace ID
 * @param detectedVertical - Detected vertical
 * @param confidence - Confidence score (0-1)
 * @param brainId - Brain ID used
 */
export async function recordVerticalConfidence(
  traceId: string,
  detectedVertical: string,
  confidence: number,
  brainId: BrainId
): Promise<void> {
  await recordScore({
    traceId,
    name: 'vertical_confidence',
    value: Math.max(0, Math.min(1, confidence)),
    dataType: 'NUMERIC',
    stringValue: detectedVertical,
    comment: `Detected vertical: ${detectedVertical} with ${(confidence * 100).toFixed(1)}% confidence`,
    metadata: {
      detectedVertical,
      brainId,
    },
  });
}

/**
 * Record angle quality score
 *
 * @param traceId - Trace ID
 * @param observationId - Generation observation ID
 * @param angles - Generated angles
 * @param qualityScore - Overall quality (0-1)
 */
export async function recordAngleQuality(
  traceId: string,
  observationId: string,
  angles: MessagingAngle[],
  qualityScore: number
): Promise<void> {
  await recordScore({
    traceId,
    observationId,
    name: 'angle_quality',
    value: Math.max(0, Math.min(1, qualityScore)),
    dataType: 'NUMERIC',
    comment: `Generated ${angles.length} angles: ${angles.join(', ')}`,
    metadata: {
      angleCount: angles.length,
      angles,
    },
  });
}

/**
 * Record ICP rule match quality
 *
 * @param traceId - Trace ID
 * @param rulesMatched - Number of rules that matched
 * @param totalRules - Total rules evaluated
 * @param knockoutTriggered - Whether a knockout rule was triggered
 */
export async function recordRuleMatchQuality(
  traceId: string,
  rulesMatched: number,
  totalRules: number,
  knockoutTriggered: boolean
): Promise<void> {
  const matchRate = totalRules > 0 ? rulesMatched / totalRules : 0;

  await recordScore({
    traceId,
    name: 'rule_match_quality',
    value: matchRate,
    dataType: 'NUMERIC',
    comment: knockoutTriggered
      ? `Knockout triggered. ${rulesMatched}/${totalRules} rules matched`
      : `${rulesMatched}/${totalRules} rules matched (${(matchRate * 100).toFixed(1)}%)`,
    metadata: {
      rulesMatched,
      totalRules,
      knockoutTriggered,
    },
  });
}

// ===========================================
// Reply Handler Specific Scores
// ===========================================

/**
 * Record reply classification accuracy
 *
 * @param traceId - Trace ID
 * @param classifiedIntent - Intent classified by the system
 * @param confidence - Classification confidence (0-1)
 * @param isCorrect - Whether classification was correct (if validated)
 */
export async function recordClassificationAccuracy(
  traceId: string,
  classifiedIntent: string,
  confidence: number,
  isCorrect?: boolean
): Promise<void> {
  await recordScore({
    traceId,
    name: 'classification_accuracy',
    value: isCorrect !== undefined ? (isCorrect ? 1 : 0) : confidence,
    dataType: isCorrect !== undefined ? 'BOOLEAN' : 'NUMERIC',
    stringValue: classifiedIntent,
    comment: `Classified as: ${classifiedIntent} with ${(confidence * 100).toFixed(1)}% confidence`,
    metadata: {
      classifiedIntent,
      confidence,
      validated: isCorrect !== undefined,
    },
  });
}

/**
 * Record response relevance score
 *
 * @param traceId - Trace ID
 * @param observationId - Generation observation ID
 * @param relevanceScore - Relevance score (0-1)
 * @param templateUsed - Template ID used for response
 */
export async function recordResponseRelevance(
  traceId: string,
  observationId: string,
  relevanceScore: number,
  templateUsed?: string
): Promise<void> {
  await recordScore({
    traceId,
    observationId,
    name: 'response_relevance',
    value: Math.max(0, Math.min(1, relevanceScore)),
    dataType: 'NUMERIC',
    comment: templateUsed
      ? `Response using template: ${templateUsed}`
      : 'Response generated without template',
    metadata: {
      templateUsed,
    },
  });
}

// ===========================================
// Meeting Prep Specific Scores
// ===========================================

/**
 * Record brief generation quality
 *
 * @param traceId - Trace ID
 * @param sectionsGenerated - Number of sections successfully generated
 * @param totalSections - Total sections expected
 */
export async function recordBriefQuality(
  traceId: string,
  sectionsGenerated: number,
  totalSections: number
): Promise<void> {
  const quality = totalSections > 0 ? sectionsGenerated / totalSections : 0;

  await recordScore({
    traceId,
    name: 'brief_quality',
    value: Math.max(0, Math.min(1, quality)),
    dataType: 'NUMERIC',
    comment: `Generated ${sectionsGenerated}/${totalSections} sections (${(quality * 100).toFixed(1)}%)`,
    metadata: {
      sectionsGenerated,
      totalSections,
    },
  });
}

/**
 * Record BANT extraction confidence
 *
 * @param traceId - Trace ID
 * @param bantScore - BANT score (0-100)
 * @param recommendation - Meeting recommendation
 */
export async function recordBANTConfidence(
  traceId: string,
  bantScore: number,
  recommendation: string
): Promise<void> {
  // Normalize BANT score to 0-1 range
  const normalizedScore = bantScore / 100;

  await recordScore({
    traceId,
    name: 'bant_extraction_confidence',
    value: Math.max(0, Math.min(1, normalizedScore)),
    dataType: 'NUMERIC',
    stringValue: recommendation,
    comment: `BANT score: ${bantScore}/100, Recommendation: ${recommendation}`,
    metadata: {
      bantScore,
      recommendation,
    },
  });
}

/**
 * Record context gathering completeness
 *
 * @param traceId - Trace ID
 * @param sourcesGathered - Number of sources successfully gathered
 * @param totalSources - Total sources attempted
 */
export async function recordContextCompleteness(
  traceId: string,
  sourcesGathered: number,
  totalSources: number
): Promise<void> {
  const completeness = totalSources > 0 ? sourcesGathered / totalSources : 0;

  await recordScore({
    traceId,
    name: 'context_completeness',
    value: Math.max(0, Math.min(1, completeness)),
    dataType: 'NUMERIC',
    comment: `Gathered ${sourcesGathered}/${totalSources} sources`,
    metadata: {
      sourcesGathered,
      totalSources,
    },
  });
}

// ===========================================
// Learning Loop Specific Scores
// ===========================================

/**
 * Record insight extraction quality
 *
 * @param traceId - Trace ID
 * @param insightCount - Number of insights extracted
 * @param avgConfidence - Average confidence across insights
 */
export async function recordInsightQuality(
  traceId: string,
  insightCount: number,
  avgConfidence: number
): Promise<void> {
  await recordScore({
    traceId,
    name: 'insight_extraction_quality',
    value: Math.max(0, Math.min(1, avgConfidence)),
    dataType: 'NUMERIC',
    comment: `Extracted ${insightCount} insights with ${(avgConfidence * 100).toFixed(1)}% avg confidence`,
    metadata: {
      insightCount,
      avgConfidence,
    },
  });
}

/**
 * Record insight validation rate
 *
 * @param traceId - Trace ID
 * @param insightsValidated - Number of insights validated (approved)
 * @param totalInsights - Total insights submitted for validation
 */
export async function recordInsightValidationRate(
  traceId: string,
  insightsValidated: number,
  totalInsights: number
): Promise<void> {
  const rate = totalInsights > 0 ? insightsValidated / totalInsights : 0;

  await recordScore({
    traceId,
    name: 'insight_validation_rate',
    value: Math.max(0, Math.min(1, rate)),
    dataType: 'NUMERIC',
    comment: `${insightsValidated}/${totalInsights} insights validated (${(rate * 100).toFixed(1)}%)`,
    metadata: {
      insightsValidated,
      totalInsights,
    },
  });
}

/**
 * Record KB write success rate
 *
 * @param traceId - Trace ID
 * @param successfulWrites - Number of successful KB writes
 * @param totalWrites - Total write attempts
 */
export async function recordKBWriteSuccessRate(
  traceId: string,
  successfulWrites: number,
  totalWrites: number
): Promise<void> {
  const rate = totalWrites > 0 ? successfulWrites / totalWrites : 0;

  await recordScore({
    traceId,
    name: 'kb_write_success_rate',
    value: Math.max(0, Math.min(1, rate)),
    dataType: 'NUMERIC',
    comment: `${successfulWrites}/${totalWrites} KB writes successful (${(rate * 100).toFixed(1)}%)`,
    metadata: {
      successfulWrites,
      totalWrites,
    },
  });
}

/**
 * Record personalization quality score
 *
 * @param traceId - Trace ID
 * @param observationId - Generation observation ID
 * @param qualityScore - Quality score (0-1)
 * @param templateUsed - Whether a template was used
 */
export async function recordPersonalizationQuality(
  traceId: string,
  observationId: string,
  qualityScore: number,
  templateUsed: boolean
): Promise<void> {
  await recordScore({
    traceId,
    observationId,
    name: 'personalization_quality',
    value: Math.max(0, Math.min(1, qualityScore)),
    dataType: 'NUMERIC',
    comment: templateUsed ? 'Personalized from template' : 'Generated without template',
    metadata: {
      templateUsed,
    },
  });
}

/**
 * Record category classification confidence
 *
 * @param traceId - Trace ID
 * @param category - Category (A, B, or C)
 * @param confidence - Confidence score (0-1)
 */
export async function recordCategoryConfidence(
  traceId: string,
  category: 'A' | 'B' | 'C',
  confidence: number
): Promise<void> {
  await recordScore({
    traceId,
    name: 'category_confidence',
    value: Math.max(0, Math.min(1, confidence)),
    dataType: 'NUMERIC',
    stringValue: category,
    comment: `Classified as Category ${category} with ${(confidence * 100).toFixed(1)}% confidence`,
    metadata: {
      category,
    },
  });
}

// ===========================================
// Batch Scoring for Lead Processing
// ===========================================

/**
 * Record all scores for a lead scoring operation
 *
 * @param traceId - Trace ID
 * @param results - Lead scoring results
 */
export async function recordLeadScoringResults(
  traceId: string,
  results: {
    leadId: LeadId;
    brainId: BrainId;
    tier: ScoringTier;
    totalScore: number;
    maxScore: number;
    rulesMatched: number;
    totalRules: number;
    knockoutTriggered: boolean;
    detectedVertical?: string;
    verticalConfidence?: number;
    angles: MessagingAngle[];
    angleQuality?: number;
    angleObservationId?: string;
  }
): Promise<void> {
  // Calculate accuracy as score percentage
  const accuracy = results.maxScore > 0 ? results.totalScore / results.maxScore : 0;

  // Record all scores
  await Promise.all([
    recordLeadScoringAccuracy(traceId, accuracy),
    recordTierCorrectness(traceId, results.tier),
    recordRuleMatchQuality(
      traceId,
      results.rulesMatched,
      results.totalRules,
      results.knockoutTriggered
    ),
    // Vertical confidence if detected
    results.detectedVertical && results.verticalConfidence !== undefined
      ? recordVerticalConfidence(
          traceId,
          results.detectedVertical,
          results.verticalConfidence,
          results.brainId
        )
      : Promise.resolve(),
    // Angle quality if generated
    results.angles.length > 0 && results.angleObservationId
      ? recordAngleQuality(
          traceId,
          results.angleObservationId,
          results.angles,
          results.angleQuality || 0.8 // Default quality if not provided
        )
      : Promise.resolve(),
  ]);
}
