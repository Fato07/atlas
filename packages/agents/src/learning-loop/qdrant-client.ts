/**
 * Learning Loop Qdrant Client
 *
 * Brain-scoped Qdrant client wrapper for the Learning Loop agent.
 * All queries automatically include brain_id filter per spec requirements.
 *
 * @module learning-loop/qdrant-client
 */

import type { InsightCategory, StoredInsightPayload } from './contracts';

// ===========================================
// Types
// ===========================================

export interface QdrantClientConfig {
  /** Qdrant server URL */
  url: string;
  /** API key for authentication */
  apiKey?: string;
  /** Collection name for insights */
  insightsCollection: string;
  /** Minimum similarity score for duplicate detection */
  duplicateSimilarityThreshold: number;
}

export const DEFAULT_QDRANT_CONFIG: QdrantClientConfig = {
  url: process.env.QDRANT_URL ?? 'http://localhost:6333',
  apiKey: process.env.QDRANT_API_KEY,
  insightsCollection: 'insights',
  duplicateSimilarityThreshold: 0.85,
};

export interface QdrantSearchResult<T> {
  id: string;
  score: number;
  payload: T;
}

export interface InsightSearchResult {
  id: string;
  score: number;
  category: InsightCategory;
  content: string;
  brain_id: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  similarId: string | null;
  similarity: number | null;
}

export interface WriteResult {
  success: boolean;
  pointId: string;
  error?: string;
}

// ===========================================
// Qdrant Client Class
// ===========================================

export class LearningLoopQdrantClient {
  private readonly config: QdrantClientConfig;
  private readonly callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;
  private readonly embedder: (text: string) => Promise<number[]>;

  constructor(
    callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>,
    embedder: (text: string) => Promise<number[]>,
    config?: Partial<QdrantClientConfig>
  ) {
    this.config = { ...DEFAULT_QDRANT_CONFIG, ...config };
    this.callMcpTool = callMcpTool;
    this.embedder = embedder;
  }

  // ===========================================
  // Duplicate Detection (FR-007)
  // ===========================================

  /**
   * Check if content is a duplicate of existing insights.
   * Uses vector similarity search with brain_id filter.
   *
   * @param brainId - Brain to search within
   * @param contentVector - Pre-computed embedding vector for the content
   * @returns Duplicate check result
   */
  async checkDuplicate(
    brainId: string,
    contentVector: number[]
  ): Promise<DuplicateCheckResult> {
    try {
      const results = await this.callMcpTool<QdrantSearchResult<{ brain_id: string }>[]>(
        'qdrant_search',
        {
          collection: this.config.insightsCollection,
          vector: contentVector,
          filter: {
            must: [{ key: 'brain_id', match: { value: brainId } }],
          },
          limit: 1,
          score_threshold: this.config.duplicateSimilarityThreshold,
        }
      );

      if (results && results.length > 0) {
        const topResult = results[0];
        return {
          isDuplicate: true,
          similarId: topResult.id,
          similarity: topResult.score,
        };
      }

      return {
        isDuplicate: false,
        similarId: null,
        similarity: null,
      };
    } catch (error) {
      // On error, assume not duplicate to avoid blocking valid insights
      console.warn('Duplicate check failed:', error);
      return {
        isDuplicate: false,
        similarId: null,
        similarity: null,
      };
    }
  }

  /**
   * Check duplicate using text content (generates embedding internally)
   */
  async checkDuplicateByContent(
    brainId: string,
    content: string
  ): Promise<DuplicateCheckResult> {
    const vector = await this.embedder(content);
    return this.checkDuplicate(brainId, vector);
  }

  // ===========================================
  // Insight Storage (FR-021, FR-022, FR-024)
  // ===========================================

  /**
   * Write an insight to Qdrant with full provenance.
   *
   * @param brainId - Brain to store in
   * @param insight - Insight payload with all metadata
   * @param vector - Pre-computed embedding vector
   * @returns Write result with point ID
   */
  async writeInsight(
    brainId: string,
    insight: StoredInsightPayload,
    vector: number[]
  ): Promise<WriteResult> {
    const pointId = crypto.randomUUID();

    try {
      await this.callMcpTool<void>('qdrant_upsert', {
        collection: this.config.insightsCollection,
        points: [
          {
            id: pointId,
            vector,
            payload: {
              ...insight,
              brain_id: brainId,
            },
          },
        ],
      });

      return {
        success: true,
        pointId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        pointId,
        error: errorMessage,
      };
    }
  }

  /**
   * Write insight with text content (generates embedding internally)
   */
  async writeInsightWithContent(
    brainId: string,
    insight: StoredInsightPayload
  ): Promise<WriteResult> {
    const vector = await this.embedder(insight.content);
    return this.writeInsight(brainId, insight, vector);
  }

  // ===========================================
  // Insight Retrieval
  // ===========================================

  /**
   * Search for insights by category within a brain.
   *
   * @param brainId - Brain to search within
   * @param category - Category to filter by
   * @param limit - Maximum results to return
   * @returns Matching insights
   */
  async getInsightsByCategory(
    brainId: string,
    category: InsightCategory,
    limit = 10
  ): Promise<QdrantSearchResult<StoredInsightPayload>[]> {
    try {
      const results = await this.callMcpTool<QdrantSearchResult<StoredInsightPayload>[]>(
        'qdrant_scroll',
        {
          collection: this.config.insightsCollection,
          filter: {
            must: [
              { key: 'brain_id', match: { value: brainId } },
              { key: 'category', match: { value: category } },
            ],
          },
          limit,
          with_payload: true,
        }
      );

      return results ?? [];
    } catch (error) {
      console.warn('Failed to get insights by category:', error);
      return [];
    }
  }

  /**
   * Search for similar insights using a query.
   *
   * @param brainId - Brain to search within
   * @param query - Search query text
   * @param limit - Maximum results to return
   * @param minScore - Minimum similarity score
   * @returns Matching insights
   */
  async searchInsights(
    brainId: string,
    query: string,
    limit = 5,
    minScore = 0.7
  ): Promise<InsightSearchResult[]> {
    try {
      const queryVector = await this.embedder(query);

      const results = await this.callMcpTool<QdrantSearchResult<StoredInsightPayload>[]>(
        'qdrant_search',
        {
          collection: this.config.insightsCollection,
          vector: queryVector,
          filter: {
            must: [{ key: 'brain_id', match: { value: brainId } }],
          },
          limit,
          score_threshold: minScore,
        }
      );

      return (results ?? []).map((result) => ({
        id: result.id,
        score: result.score,
        category: result.payload.category,
        content: result.payload.content,
        brain_id: result.payload.brain_id,
      }));
    } catch (error) {
      console.warn('Failed to search insights:', error);
      return [];
    }
  }

  /**
   * Get insights created within a time range (for weekly synthesis).
   *
   * @param brainId - Brain to search within
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @param limit - Maximum results to return
   * @returns Insights within the date range
   */
  async getInsightsByDateRange(
    brainId: string,
    startDate: Date,
    endDate: Date,
    limit = 100
  ): Promise<QdrantSearchResult<StoredInsightPayload>[]> {
    try {
      const results = await this.callMcpTool<QdrantSearchResult<StoredInsightPayload>[]>(
        'qdrant_scroll',
        {
          collection: this.config.insightsCollection,
          filter: {
            must: [
              { key: 'brain_id', match: { value: brainId } },
              {
                key: 'created_at',
                range: {
                  gte: startDate.toISOString(),
                  lte: endDate.toISOString(),
                },
              },
            ],
          },
          limit,
          with_payload: true,
        }
      );

      return results ?? [];
    } catch (error) {
      console.warn('Failed to get insights by date range:', error);
      return [];
    }
  }

  /**
   * Get insight by ID.
   *
   * @param pointId - Qdrant point ID
   * @returns Insight payload or null if not found
   */
  async getInsightById(pointId: string): Promise<StoredInsightPayload | null> {
    try {
      const result = await this.callMcpTool<{ payload: StoredInsightPayload } | null>(
        'qdrant_get_point',
        {
          collection: this.config.insightsCollection,
          id: pointId,
        }
      );

      return result?.payload ?? null;
    } catch (error) {
      console.warn('Failed to get insight by ID:', error);
      return null;
    }
  }

  // ===========================================
  // Insight Updates
  // ===========================================

  /**
   * Update insight application stats (FR-024).
   *
   * @param pointId - Qdrant point ID
   * @param stats - Updated application stats
   * @returns Success status
   */
  async updateApplicationStats(
    pointId: string,
    stats: {
      applied_count: number;
      success_rate: number;
      last_applied_at: string;
    }
  ): Promise<boolean> {
    try {
      await this.callMcpTool<void>('qdrant_set_payload', {
        collection: this.config.insightsCollection,
        points: [pointId],
        payload: {
          'application_stats.applied_count': stats.applied_count,
          'application_stats.success_rate': stats.success_rate,
          'application_stats.last_applied_at': stats.last_applied_at,
        },
      });

      return true;
    } catch (error) {
      console.warn('Failed to update application stats:', error);
      return false;
    }
  }

  /**
   * Archive an insight (FR-024).
   *
   * @param pointId - Qdrant point ID
   * @returns Success status
   */
  async archiveInsight(pointId: string): Promise<boolean> {
    try {
      await this.callMcpTool<void>('qdrant_set_payload', {
        collection: this.config.insightsCollection,
        points: [pointId],
        payload: {
          archived: true,
          archived_at: new Date().toISOString(),
        },
      });

      return true;
    } catch (error) {
      console.warn('Failed to archive insight:', error);
      return false;
    }
  }

  // ===========================================
  // Aggregation Queries (for Weekly Synthesis)
  // ===========================================

  /**
   * Get category counts for a brain within a date range.
   *
   * @param brainId - Brain to query
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @returns Category counts
   */
  async getCategoryCounts(
    brainId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Record<InsightCategory, number>> {
    const insights = await this.getInsightsByDateRange(brainId, startDate, endDate);

    const counts: Record<string, number> = {
      buying_process: 0,
      pain_point: 0,
      objection: 0,
      competitive_intel: 0,
      messaging_effectiveness: 0,
      icp_signal: 0,
    };

    for (const insight of insights) {
      const category = insight.payload.category;
      if (category in counts) {
        counts[category]++;
      }
    }

    return counts as Record<InsightCategory, number>;
  }

  /**
   * Get top objections for a brain within a date range.
   *
   * @param brainId - Brain to query
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @param limit - Maximum results
   * @returns Top objections
   */
  async getTopObjections(
    brainId: string,
    startDate: Date,
    endDate: Date,
    limit = 5
  ): Promise<Array<{ content: string; count: number }>> {
    try {
      const results = await this.callMcpTool<QdrantSearchResult<StoredInsightPayload>[]>(
        'qdrant_scroll',
        {
          collection: this.config.insightsCollection,
          filter: {
            must: [
              { key: 'brain_id', match: { value: brainId } },
              { key: 'category', match: { value: 'objection' } },
              {
                key: 'created_at',
                range: {
                  gte: startDate.toISOString(),
                  lte: endDate.toISOString(),
                },
              },
            ],
          },
          limit: 100, // Get more to count
          with_payload: true,
        }
      );

      // Count occurrences (simplified - could use clustering)
      const objectionCounts = new Map<string, number>();
      for (const result of results ?? []) {
        const content = result.payload.content;
        objectionCounts.set(content, (objectionCounts.get(content) ?? 0) + 1);
      }

      // Sort by count and return top N
      return Array.from(objectionCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([content, count]) => ({ content, count }));
    } catch (error) {
      console.warn('Failed to get top objections:', error);
      return [];
    }
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Learning Loop Qdrant client instance.
 */
export function createQdrantClient(
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>,
  embedder: (text: string) => Promise<number[]>,
  config?: Partial<QdrantClientConfig>
): LearningLoopQdrantClient {
  return new LearningLoopQdrantClient(callMcpTool, embedder, config);
}
