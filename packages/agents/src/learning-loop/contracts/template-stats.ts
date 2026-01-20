/**
 * Template Performance Schema
 *
 * Defines schemas for tracking response template usage
 * and outcomes for A/B optimization.
 *
 * Implements: FR-027 through FR-031
 *
 * @module learning-loop/contracts/template-stats
 */

import { z } from 'zod';

// ===========================================
// Template Outcomes (FR-028)
// ===========================================

export const TemplateOutcomeSchema = z.enum([
  'meeting_booked',
  'positive_reply',
  'no_response',
  'negative_reply',
]);

export type TemplateOutcome = z.infer<typeof TemplateOutcomeSchema>;

// ===========================================
// Outcome Distribution
// ===========================================

export const OutcomeDistributionSchema = z.object({
  meeting_booked: z.number().int().min(0),
  positive_reply: z.number().int().min(0),
  no_response: z.number().int().min(0),
  negative_reply: z.number().int().min(0),
});

export type OutcomeDistribution = z.infer<typeof OutcomeDistributionSchema>;

// ===========================================
// A/B Comparison Metrics (FR-031)
// ===========================================

export const ABComparisonSchema = z.object({
  vs_group_average: z.number().nullable().describe('Success rate vs group average'),
  rank_in_group: z.number().int().min(1).nullable().describe('Rank within A/B group'),
  total_in_group: z.number().int().min(1).nullable(),
});

export type ABComparison = z.infer<typeof ABComparisonSchema>;

// ===========================================
// Template Performance (FR-027 through FR-031)
// ===========================================

export const TemplatePerformanceSchema = z.object({
  template_id: z.string().min(1),
  brain_id: z.string().min(1),
  times_used: z.number().int().min(0).describe('FR-027'),
  outcomes: OutcomeDistributionSchema.describe('FR-028'),
  success_rate: z.number().min(0).max(1).describe('FR-029'),
  last_used: z.string().datetime({ offset: true }).nullable().describe('FR-030'),
  ab_group: z.string().nullable().describe('A/B test group ID'),
  variant: z.string().nullable().describe('Variant identifier (A, B, C, etc.)'),
  comparison: ABComparisonSchema.nullable().describe('FR-031'),
});

export type TemplatePerformance = z.infer<typeof TemplatePerformanceSchema>;

// ===========================================
// Template Usage Event
// ===========================================

export const TemplateUsageEventSchema = z.object({
  template_id: z.string().min(1),
  brain_id: z.string().min(1),
  lead_id: z.string().min(1),
  reply_id: z.string().min(1),
  used_at: z.string().datetime({ offset: true }),
});

export type TemplateUsageEvent = z.infer<typeof TemplateUsageEventSchema>;

// ===========================================
// Template Outcome Event
// ===========================================

export const TemplateOutcomeEventSchema = z.object({
  template_id: z.string().min(1),
  brain_id: z.string().min(1),
  lead_id: z.string().min(1),
  reply_id: z.string().min(1),
  outcome: TemplateOutcomeSchema,
  recorded_at: z.string().datetime({ offset: true }),
});

export type TemplateOutcomeEvent = z.infer<typeof TemplateOutcomeEventSchema>;

// ===========================================
// Performance Calculation
// ===========================================

export function calculateSuccessRate(outcomes: OutcomeDistribution): number {
  const totalResponses =
    outcomes.meeting_booked +
    outcomes.positive_reply +
    outcomes.no_response +
    outcomes.negative_reply;

  if (totalResponses === 0) return 0;

  // Success = meeting_booked + positive_reply (favorable outcomes)
  const successes = outcomes.meeting_booked + outcomes.positive_reply;
  return successes / totalResponses;
}

// ===========================================
// Performance Creation Helper
// ===========================================

export function createTemplatePerformance(
  templateId: string,
  brainId: string,
  abGroup?: string,
  variant?: string
): TemplatePerformance {
  return {
    template_id: templateId,
    brain_id: brainId,
    times_used: 0,
    outcomes: {
      meeting_booked: 0,
      positive_reply: 0,
      no_response: 0,
      negative_reply: 0,
    },
    success_rate: 0,
    last_used: null,
    ab_group: abGroup ?? null,
    variant: variant ?? null,
    comparison: null,
  };
}

// ===========================================
// Performance Update Helpers
// ===========================================

export function recordTemplateUsage(
  performance: TemplatePerformance
): TemplatePerformance {
  return {
    ...performance,
    times_used: performance.times_used + 1,
    last_used: new Date().toISOString(),
  };
}

export function recordTemplateOutcome(
  performance: TemplatePerformance,
  outcome: TemplateOutcome
): TemplatePerformance {
  const updatedOutcomes = {
    ...performance.outcomes,
    [outcome]: performance.outcomes[outcome] + 1,
  };

  return {
    ...performance,
    outcomes: updatedOutcomes,
    success_rate: calculateSuccessRate(updatedOutcomes),
  };
}

// ===========================================
// A/B Group Comparison (FR-031)
// ===========================================

export function calculateABComparison(
  performance: TemplatePerformance,
  groupPerformances: TemplatePerformance[]
): ABComparison {
  if (!performance.ab_group || groupPerformances.length === 0) {
    return {
      vs_group_average: null,
      rank_in_group: null,
      total_in_group: null,
    };
  }

  // Filter to same group
  const groupMembers = groupPerformances.filter(
    (p) => p.ab_group === performance.ab_group
  );

  if (groupMembers.length === 0) {
    return {
      vs_group_average: null,
      rank_in_group: null,
      total_in_group: null,
    };
  }

  // Calculate group average
  const groupTotalSuccessRate = groupMembers.reduce(
    (sum, p) => sum + p.success_rate,
    0
  );
  const groupAverage = groupTotalSuccessRate / groupMembers.length;

  // Calculate rank (sorted by success_rate descending)
  const sorted = [...groupMembers].sort(
    (a, b) => b.success_rate - a.success_rate
  );
  const rank =
    sorted.findIndex((p) => p.template_id === performance.template_id) + 1;

  return {
    vs_group_average: performance.success_rate - groupAverage,
    rank_in_group: rank,
    total_in_group: groupMembers.length,
  };
}

export function updateABComparison(
  performance: TemplatePerformance,
  groupPerformances: TemplatePerformance[]
): TemplatePerformance {
  return {
    ...performance,
    comparison: calculateABComparison(performance, groupPerformances),
  };
}

// ===========================================
// Declining Performance Alert
// ===========================================

const DECLINING_THRESHOLD = 0.1; // 10% drop triggers alert
const MIN_SAMPLES_FOR_ALERT = 10;

export interface DecliningAlert {
  template_id: string;
  current_success_rate: number;
  previous_success_rate: number;
  drop_percentage: number;
}

export function checkDecliningPerformance(
  current: TemplatePerformance,
  previous: TemplatePerformance
): DecliningAlert | null {
  // Need minimum samples to detect meaningful decline
  const currentTotal = Object.values(current.outcomes).reduce((a, b) => a + b, 0);
  const previousTotal = Object.values(previous.outcomes).reduce((a, b) => a + b, 0);

  if (currentTotal < MIN_SAMPLES_FOR_ALERT || previousTotal < MIN_SAMPLES_FOR_ALERT) {
    return null;
  }

  const drop = previous.success_rate - current.success_rate;
  const dropPercentage = previous.success_rate > 0 ? drop / previous.success_rate : 0;

  if (dropPercentage >= DECLINING_THRESHOLD) {
    return {
      template_id: current.template_id,
      current_success_rate: current.success_rate,
      previous_success_rate: previous.success_rate,
      drop_percentage: dropPercentage,
    };
  }

  return null;
}
