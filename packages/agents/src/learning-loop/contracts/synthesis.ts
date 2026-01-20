/**
 * Weekly Synthesis Schema
 *
 * Defines schemas for weekly synthesis reports that summarize
 * learnings from the Learning Loop.
 *
 * Implements: FR-022 through FR-026
 *
 * @module learning-loop/contracts/synthesis
 */

import { z } from 'zod';
import { InsightCategorySchema, InsightImportanceSchema } from './insight';
import { TemplatePerformanceSchema } from './template-stats';

// ===========================================
// Objection Ranking (FR-023)
// ===========================================

export const ObjectionRankingSchema = z.object({
  objection_id: z.string().min(1),
  content: z.string().max(500),
  occurrence_count: z.number().int().min(1),
  example_quotes: z.array(z.string().max(300)).max(3),
  companies: z.array(z.string()).max(5),
  suggested_response: z.string().max(1000).nullable(),
});

export type ObjectionRanking = z.infer<typeof ObjectionRankingSchema>;

// ===========================================
// Template Ranking (FR-024)
// ===========================================

export const TemplateRankingSchema = z.object({
  template_id: z.string().min(1),
  template_name: z.string(),
  times_used: z.number().int().min(0),
  success_rate: z.number().min(0).max(1),
  outcomes: z.object({
    meeting_booked: z.number().int().min(0),
    positive_reply: z.number().int().min(0),
    no_response: z.number().int().min(0),
    negative_reply: z.number().int().min(0),
  }),
  trend: z.enum(['improving', 'stable', 'declining']),
  trend_percentage: z.number().nullable(),
});

export type TemplateRanking = z.infer<typeof TemplateRankingSchema>;

// ===========================================
// ICP Signal Summary (FR-025)
// ===========================================

export const ICPSignalSummarySchema = z.object({
  signal_type: z.string(),
  description: z.string().max(500),
  occurrence_count: z.number().int().min(1),
  companies: z.array(z.string()).max(5),
  confidence: z.number().min(0).max(1),
  is_new: z.boolean(),
});

export type ICPSignalSummary = z.infer<typeof ICPSignalSummarySchema>;

// ===========================================
// Competitive Intel Summary
// ===========================================

export const CompetitiveIntelSummarySchema = z.object({
  competitor_name: z.string(),
  mentions: z.number().int().min(1),
  context_snippets: z.array(z.string().max(200)).max(3),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  positioning_opportunities: z.array(z.string().max(300)).max(3),
});

export type CompetitiveIntelSummary = z.infer<typeof CompetitiveIntelSummarySchema>;

// ===========================================
// Insight Category Stats
// ===========================================

export const CategoryStatsSchema = z.object({
  category: InsightCategorySchema,
  count: z.number().int().min(0),
  validated_count: z.number().int().min(0),
  auto_approved_count: z.number().int().min(0),
  rejected_count: z.number().int().min(0),
  avg_confidence: z.number().min(0).max(1),
});

export type CategoryStats = z.infer<typeof CategoryStatsSchema>;

// ===========================================
// Weekly Synthesis Report (FR-022)
// ===========================================

export const WeeklySynthesisSchema = z.object({
  id: z.string().min(1).describe('Unique synthesis ID'),
  brain_id: z.string().min(1),
  vertical: z.string().min(1),

  // Time period
  period: z.object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  }),

  // Overview metrics
  overview: z.object({
    total_conversations_processed: z.number().int().min(0),
    total_insights_extracted: z.number().int().min(0),
    insights_validated: z.number().int().min(0),
    insights_auto_approved: z.number().int().min(0),
    insights_rejected: z.number().int().min(0),
    kb_growth: z.number().int(), // Can be negative if more archived than added
    avg_extraction_confidence: z.number().min(0).max(1),
    avg_validation_time_hours: z.number().min(0).nullable(),
  }),

  // Category breakdown
  category_stats: z.array(CategoryStatsSchema),

  // Top objections (FR-023)
  top_objections: z.array(ObjectionRankingSchema).max(5),

  // Top templates (FR-024)
  top_templates: z.array(TemplateRankingSchema).max(5),
  declining_templates: z.array(TemplateRankingSchema).max(3),

  // ICP signals (FR-025)
  icp_signals: z.array(ICPSignalSummarySchema).max(10),
  new_icp_signals: z.array(ICPSignalSummarySchema).max(5),

  // Competitive intel
  competitive_intel: z.array(CompetitiveIntelSummarySchema).max(5),

  // Recommendations
  recommendations: z.array(
    z.object({
      priority: z.enum(['high', 'medium', 'low']),
      category: z.string(),
      recommendation: z.string().max(500),
      supporting_data: z.string().max(300).nullable(),
    })
  ).max(5),

  // Delivery info
  delivery: z.object({
    slack_channel: z.string(),
    message_ts: z.string().nullable(),
    delivered_at: z.string().datetime({ offset: true }).nullable(),
  }),

  // Metadata
  generated_at: z.string().datetime({ offset: true }),
  generation_time_ms: z.number().int().min(0),
});

export type WeeklySynthesis = z.infer<typeof WeeklySynthesisSchema>;

// ===========================================
// Synthesis Request (for scheduling)
// ===========================================

export const SynthesisScheduleSchema = z.object({
  brain_id: z.string().min(1),
  schedule_cron: z.string().describe('Cron expression for scheduling'),
  slack_channel: z.string().min(1),
  enabled: z.boolean(),
  last_run_at: z.string().datetime({ offset: true }).nullable(),
  next_run_at: z.string().datetime({ offset: true }).nullable(),
});

export type SynthesisSchedule = z.infer<typeof SynthesisScheduleSchema>;

// ===========================================
// Empty Synthesis Creation Helper
// ===========================================

export function createEmptySynthesis(
  brainId: string,
  vertical: string,
  periodStart: Date,
  periodEnd: Date,
  slackChannel: string
): WeeklySynthesis {
  const now = new Date().toISOString();

  return {
    id: `synthesis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    brain_id: brainId,
    vertical,
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
    },
    overview: {
      total_conversations_processed: 0,
      total_insights_extracted: 0,
      insights_validated: 0,
      insights_auto_approved: 0,
      insights_rejected: 0,
      kb_growth: 0,
      avg_extraction_confidence: 0,
      avg_validation_time_hours: null,
    },
    category_stats: [],
    top_objections: [],
    top_templates: [],
    declining_templates: [],
    icp_signals: [],
    new_icp_signals: [],
    competitive_intel: [],
    recommendations: [],
    delivery: {
      slack_channel: slackChannel,
      message_ts: null,
      delivered_at: null,
    },
    generated_at: now,
    generation_time_ms: 0,
  };
}

// ===========================================
// Slack Block Kit Helper Types
// ===========================================

export interface SynthesisSlackBlocks {
  header: object;
  overview: object;
  objections: object;
  templates: object;
  icp_signals: object;
  recommendations: object;
  footer: object;
}
