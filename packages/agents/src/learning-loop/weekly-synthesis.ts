/**
 * Learning Loop Weekly Synthesis
 *
 * Generates weekly synthesis reports:
 * 1. Aggregate insights by category (FR-022)
 * 2. Rank objections and templates (FR-023)
 * 3. Generate ICP signals summary (FR-024)
 * 4. Deliver via Slack (FR-025, FR-026)
 *
 * @module learning-loop/weekly-synthesis
 */

import type {
  WeeklySynthesis,
  CategoryStats,
  ObjectionRanking,
  TemplateRanking,
  ICPSignalSummary,
  CompetitiveIntelSummary,
  InsightCategory,
} from './contracts';
import { createEmptySynthesis } from './contracts';
import type { LearningLoopQdrantClient } from './qdrant-client';
import type { LearningLoopRedisClient } from './redis-client';
import type { LearningLoopSlackClient } from './slack-client';
import type { LearningLoopStateManager } from './state';
import { getLogger } from './logger';

// ===========================================
// Types
// ===========================================

export interface WeeklySynthesizerConfig {
  /** Lookback period in days */
  lookbackDays: number;
  /** Top N items for rankings */
  topN: number;
  /** Slack channel for synthesis reports */
  synthesisChannel: string;
  /** Declining performance threshold */
  decliningThreshold: number;
}

export const DEFAULT_SYNTHESIZER_CONFIG: WeeklySynthesizerConfig = {
  lookbackDays: 7,
  topN: 5,
  synthesisChannel: 'learning-loop-reports',
  decliningThreshold: 0.2,
};

export interface SynthesisResult {
  success: boolean;
  synthesis?: WeeklySynthesis;
  slackMessageTs?: string;
  error?: string;
}

// ===========================================
// Weekly Synthesizer Class
// ===========================================

export class WeeklySynthesizer {
  private readonly config: WeeklySynthesizerConfig;
  private readonly qdrantClient: LearningLoopQdrantClient;
  private readonly redisClient: LearningLoopRedisClient;
  private readonly slackClient: LearningLoopSlackClient;
  private readonly stateManager: LearningLoopStateManager;

  constructor(
    qdrantClient: LearningLoopQdrantClient,
    redisClient: LearningLoopRedisClient,
    slackClient: LearningLoopSlackClient,
    stateManager: LearningLoopStateManager,
    config?: Partial<WeeklySynthesizerConfig>
  ) {
    this.config = { ...DEFAULT_SYNTHESIZER_CONFIG, ...config };
    this.qdrantClient = qdrantClient;
    this.redisClient = redisClient;
    this.slackClient = slackClient;
    this.stateManager = stateManager;
  }

  // ===========================================
  // Main Synthesis Method
  // ===========================================

  /**
   * Generate and deliver weekly synthesis.
   */
  async generateAndDeliver(brainId: string): Promise<SynthesisResult> {
    const logger = getLogger();

    try {
      logger.info('Starting weekly synthesis generation', {
        brain_id: brainId,
        lookback_days: this.config.lookbackDays,
      });

      // Generate synthesis
      const synthesis = await this.generate(brainId);

      // Deliver via Slack (FR-025, FR-026)
      const slackResult = await this.slackClient.sendWeeklySynthesis(synthesis);

      if (!slackResult.success) {
        logger.warn('Failed to deliver synthesis via Slack', {
          brain_id: brainId,
          error: slackResult.error,
        });
      }

      // Update last synthesis time
      await this.redisClient.setLastSynthesisRun(brainId, new Date().toISOString());

      // Check for declining templates and send alerts (FR-030)
      await this.checkDecliningTemplates(brainId);

      logger.info('Weekly synthesis complete', {
        brain_id: brainId,
        total_conversations: synthesis.overview.total_conversations_processed,
        total_insights: synthesis.overview.total_insights_extracted,
        slack_delivered: slackResult.success,
      });

      return {
        success: true,
        synthesis,
        slackMessageTs: slackResult.ts,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Weekly synthesis failed', {
        brain_id: brainId,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Generate synthesis without delivery.
   */
  async generate(brainId: string): Promise<WeeklySynthesis> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - this.config.lookbackDays);

    // Create base synthesis
    const synthesis = createEmptySynthesis(
      brainId,
      'default', // vertical - would be fetched from brain
      startDate,
      endDate,
      this.config.synthesisChannel
    );

    // Gather data in parallel
    const [
      categoryStats,
      topObjections,
      topTemplates,
      icpSignals,
      competitiveIntel,
      overviewStats,
    ] = await Promise.all([
      this.generateCategoryStats(brainId, startDate),
      this.generateTopObjections(brainId, startDate),
      this.generateTopTemplates(brainId),
      this.generateICPSignals(brainId, startDate),
      this.generateCompetitiveIntel(brainId, startDate),
      this.generateOverviewStats(brainId, startDate),
    ]);

    // Populate synthesis
    synthesis.overview = overviewStats;
    synthesis.category_stats = categoryStats;
    synthesis.top_objections = topObjections;
    synthesis.top_templates = topTemplates;
    synthesis.icp_signals = icpSignals;
    synthesis.competitive_intel = competitiveIntel;

    return synthesis;
  }

  // ===========================================
  // Data Aggregation Methods
  // ===========================================

  /**
   * Generate category statistics (FR-022).
   */
  private async generateCategoryStats(
    brainId: string,
    startDate: Date
  ): Promise<CategoryStats[]> {
    const endDate = new Date();

    // Get all insights in date range
    const allInsights = await this.qdrantClient.getInsightsByDateRange(
      brainId,
      startDate,
      endDate,
      1000
    );

    const categories: InsightCategory[] = [
      'buying_process',
      'pain_point',
      'objection',
      'competitive_intel',
      'messaging_effectiveness',
      'icp_signal',
    ];

    const stats: CategoryStats[] = [];

    for (const category of categories) {
      const categoryInsights = allInsights.filter(i => i.payload.category === category);

      if (categoryInsights.length > 0) {
        const avgConfidence =
          categoryInsights.reduce((sum, i) => sum + i.payload.confidence, 0) / categoryInsights.length;

        // Count by validation status
        const validated = categoryInsights.filter(i => i.payload.validation.status === 'validated').length;
        const autoApproved = categoryInsights.filter(i => i.payload.validation.status === 'auto_approved').length;

        stats.push({
          category,
          count: categoryInsights.length,
          validated_count: validated,
          auto_approved_count: autoApproved,
          rejected_count: 0, // Rejected insights aren't stored
          avg_confidence: avgConfidence,
        });
      }
    }

    // Sort by count descending
    return stats.sort((a, b) => b.count - a.count);
  }

  /**
   * Generate top objections ranking (FR-023).
   */
  private async generateTopObjections(
    brainId: string,
    startDate: Date
  ): Promise<ObjectionRanking[]> {
    const endDate = new Date();

    // Get all insights in date range and filter to objections
    const allInsights = await this.qdrantClient.getInsightsByDateRange(
      brainId,
      startDate,
      endDate,
      500
    );
    const objections = allInsights
      .filter(i => i.payload.category === 'objection')
      .map(i => ({
        content: i.payload.content,
        initial_confidence: i.payload.confidence,
      }));

    // Group by similar content
    const grouped = this.groupSimilarContent(objections);

    // Convert to rankings
    const rankings: ObjectionRanking[] = grouped
      .map((group, index) => ({
        objection_id: `obj_${Date.now()}_${index}`,
        content: group.representative,
        occurrence_count: group.count,
        example_quotes: [], // Would be populated from insights
        companies: [], // Would be extracted from insights
        suggested_response: null, // Would be populated by Claude
      }))
      .sort((a, b) => b.occurrence_count - a.occurrence_count)
      .slice(0, this.config.topN);

    return rankings;
  }

  /**
   * Generate top templates ranking (FR-023).
   */
  private async generateTopTemplates(brainId: string): Promise<TemplateRanking[]> {
    const performances = await this.redisClient.getAllTemplatePerformances(brainId);

    // Filter to templates with sufficient usage
    const qualifiedTemplates = performances.filter(p => p.times_used >= 5);

    // Sort by success rate
    const rankings: TemplateRanking[] = qualifiedTemplates
      .map(p => ({
        template_id: p.template_id,
        template_name: p.template_id, // Would be fetched from template store
        times_used: p.times_used,
        success_rate: p.success_rate,
        outcomes: p.outcomes,
        trend: this.calculateTrend(p) as 'improving' | 'stable' | 'declining',
        trend_percentage: null, // Would be calculated from historical data
      }))
      .sort((a, b) => b.success_rate - a.success_rate)
      .slice(0, this.config.topN);

    return rankings;
  }

  /**
   * Generate ICP signals summary (FR-024).
   */
  private async generateICPSignals(
    brainId: string,
    startDate: Date
  ): Promise<ICPSignalSummary[]> {
    const endDate = new Date();

    // Get all insights in date range and filter to ICP signals
    const allInsights = await this.qdrantClient.getInsightsByDateRange(
      brainId,
      startDate,
      endDate,
      500
    );
    const icpInsights = allInsights
      .filter(i => i.payload.category === 'icp_signal')
      .map(i => ({
        content: i.payload.content,
        initial_confidence: i.payload.confidence,
      }));

    // Group and analyze signals
    const signalGroups = this.groupSimilarContent(icpInsights);

    return signalGroups
      .map(group => ({
        signal_type: this.inferSignalType(group.representative),
        description: group.representative,
        occurrence_count: group.count,
        companies: [], // Would be extracted from insights
        confidence: group.avgConfidence,
        is_new: true, // Would be determined by comparing with previous period
      }))
      .sort((a, b) => b.occurrence_count - a.occurrence_count)
      .slice(0, this.config.topN);
  }

  /**
   * Generate competitive intelligence summary.
   */
  private async generateCompetitiveIntel(
    brainId: string,
    startDate: Date
  ): Promise<CompetitiveIntelSummary[]> {
    const endDate = new Date();

    // Get all insights in date range and filter to competitive intel
    const allInsights = await this.qdrantClient.getInsightsByDateRange(
      brainId,
      startDate,
      endDate,
      500
    );
    const compInsights = allInsights
      .filter(i => i.payload.category === 'competitive_intel')
      .map(i => ({
        content: i.payload.content,
      }));

    // Extract competitor mentions
    const competitorMentions = new Map<string, {
      count: number;
      insights: typeof compInsights;
    }>();

    for (const insight of compInsights) {
      const competitors = this.extractCompetitorNames(insight.content);
      for (const competitor of competitors) {
        const existing = competitorMentions.get(competitor);
        if (existing) {
          existing.count++;
          existing.insights.push(insight);
        } else {
          competitorMentions.set(competitor, { count: 1, insights: [insight] });
        }
      }
    }

    // Convert to summaries
    return Array.from(competitorMentions.entries())
      .map(([name, data]) => ({
        competitor_name: name,
        mentions: data.count,
        context_snippets: data.insights.slice(0, 3).map(i => i.content.slice(0, 200)),
        sentiment: 'neutral' as const, // Would be analyzed from content
        positioning_opportunities: [], // Would be generated by Claude
      }))
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, this.config.topN);
  }

  /**
   * Generate overview statistics.
   */
  private async generateOverviewStats(
    brainId: string,
    startDate: Date
  ): Promise<WeeklySynthesis['overview']> {
    const metrics = this.stateManager.getMetrics();
    const endDate = new Date();

    // Get all insights from period using date range query
    const allInsights = await this.qdrantClient.getInsightsByDateRange(
      brainId,
      startDate,
      endDate,
      1000
    );

    // Calculate average confidence from payload
    const avgConfidence = allInsights.length > 0
      ? allInsights.reduce((sum, i) => sum + i.payload.confidence, 0) / allInsights.length
      : 0;

    return {
      total_conversations_processed: metrics.insights_extracted, // Use insights_extracted as proxy
      total_insights_extracted: allInsights.length,
      insights_validated: metrics.insights_validated,
      insights_auto_approved: metrics.insights_auto_approved,
      insights_rejected: metrics.insights_rejected,
      kb_growth: allInsights.length - (metrics.insights_rejected ?? 0),
      avg_extraction_confidence: avgConfidence,
      avg_validation_time_hours: null, // Would be calculated from validation timestamps
    };
  }

  // ===========================================
  // Template Performance Monitoring
  // ===========================================

  /**
   * Check for declining template performance (FR-030).
   */
  private async checkDecliningTemplates(brainId: string): Promise<void> {
    const logger = getLogger();

    const decliningTemplates = await this.redisClient.getDecliningTemplates(
      brainId,
      this.config.decliningThreshold
    );

    for (const template of decliningTemplates) {
      logger.warn('Template performance declining', {
        brain_id: brainId,
        template_id: template.template_id,
        success_rate: template.success_rate,
      });

      // Send alert
      await this.slackClient.sendDecliningTemplateAlert(
        brainId,
        template.template_id,
        template.template_id, // Would be fetched name
        template.success_rate,
        0.5 // Previous rate - would be tracked
      );
    }
  }

  /**
   * Check if synthesis is due.
   */
  async isSynthesisDue(brainId: string): Promise<boolean> {
    return this.redisClient.isSynthesisDue(brainId, this.config.lookbackDays);
  }

  // ===========================================
  // Helper Methods
  // ===========================================

  /**
   * Extract top themes from insights.
   */
  private extractTopThemes(
    insights: Array<{ content: string }>,
    count: number
  ): string[] {
    // Simple keyword extraction - would use NLP in production
    const words = insights
      .flatMap(i => i.content.toLowerCase().split(/\s+/))
      .filter(w => w.length > 4);

    const frequency = new Map<string, number>();
    for (const word of words) {
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }

    return Array.from(frequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([word]) => word);
  }

  /**
   * Group similar content together.
   */
  private groupSimilarContent(
    insights: Array<{ content: string; initial_confidence: number }>
  ): Array<{
    representative: string;
    count: number;
    avgConfidence: number;
  }> {
    // Simple grouping by first 50 chars - would use embeddings in production
    const groups = new Map<string, {
      contents: string[];
      confidences: number[];
    }>();

    for (const insight of insights) {
      const key = insight.content.slice(0, 50).toLowerCase();
      const existing = groups.get(key);
      if (existing) {
        existing.contents.push(insight.content);
        existing.confidences.push(insight.initial_confidence);
      } else {
        groups.set(key, {
          contents: [insight.content],
          confidences: [insight.initial_confidence],
        });
      }
    }

    return Array.from(groups.values()).map(group => ({
      representative: group.contents[0],
      count: group.contents.length,
      avgConfidence:
        group.confidences.reduce((a, b) => a + b, 0) / group.confidences.length,
    }));
  }

  /**
   * Get top outcomes from distribution.
   */
  private getTopOutcomes(
    outcomes: {
      meeting_booked: number;
      positive_reply: number;
      no_response: number;
      negative_reply: number;
    }
  ): string[] {
    const ranked = [
      { type: 'meeting_booked', count: outcomes.meeting_booked },
      { type: 'positive_reply', count: outcomes.positive_reply },
      { type: 'no_response', count: outcomes.no_response },
      { type: 'negative_reply', count: outcomes.negative_reply },
    ].sort((a, b) => b.count - a.count);

    return ranked.slice(0, 2).map(o => o.type);
  }

  /**
   * Calculate trend from template performance.
   */
  private calculateTrend(
    performance: { success_rate: number; times_used: number }
  ): 'improving' | 'stable' | 'declining' {
    // Simple heuristic - would use historical data in production
    if (performance.success_rate > 0.6) return 'improving';
    if (performance.success_rate < 0.3) return 'declining';
    return 'stable';
  }

  /**
   * Infer signal type from content.
   */
  private inferSignalType(content: string): string {
    const lower = content.toLowerCase();
    if (lower.includes('size') || lower.includes('employee')) return 'company_size';
    if (lower.includes('industry') || lower.includes('sector')) return 'industry';
    if (lower.includes('budget') || lower.includes('spend')) return 'budget';
    if (lower.includes('tech') || lower.includes('stack')) return 'tech_stack';
    return 'behavior';
  }

  /**
   * Extract competitor names from content.
   */
  private extractCompetitorNames(content: string): string[] {
    // Simple extraction - would use NER in production
    const competitors: string[] = [];

    // Look for common patterns
    const patterns = [
      /(?:using|with|from|to|vs|versus|compared to)\s+([A-Z][a-zA-Z]+)/g,
      /([A-Z][a-zA-Z]+)\s+(?:is|are|was|were|does|do)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];
        if (name && name.length > 2 && !competitors.includes(name)) {
          competitors.push(name);
        }
      }
    }

    return competitors;
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a WeeklySynthesizer instance.
 */
export function createWeeklySynthesizer(
  qdrantClient: LearningLoopQdrantClient,
  redisClient: LearningLoopRedisClient,
  slackClient: LearningLoopSlackClient,
  stateManager: LearningLoopStateManager,
  config?: Partial<WeeklySynthesizerConfig>
): WeeklySynthesizer {
  return new WeeklySynthesizer(
    qdrantClient,
    redisClient,
    slackClient,
    stateManager,
    config
  );
}
