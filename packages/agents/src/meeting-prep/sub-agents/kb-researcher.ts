/**
 * KB Researcher Sub-Agent
 *
 * Queries Qdrant knowledge base for objection handlers and similar deals.
 * All queries are brain-scoped per FR-014 requirement.
 *
 * @module meeting-prep/sub-agents/kb-researcher
 */

import type { BrainId } from '@atlas-gtm/lib';

// ===========================================
// Types
// ===========================================

export interface ObjectionHandler {
  id: string;
  objection: string;
  response: string;
  category: string;
  confidence: number;
}

export interface SimilarDeal {
  company: string;
  industry: string;
  why_won: string;
  deal_size: string | null;
  closing_date: string | null;
  relevance_score: number;
}

export interface ICPRule {
  dimension: string;
  rule: string;
  weight: number;
}

export interface KBResearchData {
  objection_handlers: ObjectionHandler[];
  similar_deals: SimilarDeal[];
  icp_rules: ICPRule[];
}

export interface KBResearcherConfig {
  /** Maximum objection handlers to return */
  maxObjectionHandlers: number;

  /** Maximum similar deals to return */
  maxSimilarDeals: number;

  /** Maximum ICP rules to return */
  maxIcpRules: number;

  /** Minimum similarity score for results */
  minSimilarityScore: number;
}

export const DEFAULT_KB_CONFIG: KBResearcherConfig = {
  maxObjectionHandlers: 3,
  maxSimilarDeals: 3,
  maxIcpRules: 5,
  minSimilarityScore: 0.7,
};

export interface KBResearcherResult {
  success: true;
  data: KBResearchData;
  query_duration_ms: number;
}

export interface KBResearcherError {
  success: false;
  error: string;
  code: 'QDRANT_ERROR' | 'TIMEOUT' | 'EMBEDDING_ERROR' | 'NO_BRAIN';
}

export type KBResearchResult = KBResearcherResult | KBResearcherError;

// ===========================================
// Qdrant Search Result Types
// ===========================================

interface QdrantSearchResult<T> {
  id: string;
  score: number;
  payload: T;
}

interface ObjectionPayload {
  objection: string;
  response: string;
  category: string;
  brain_id: string;
}

interface DealPayload {
  company_name: string;
  industry: string;
  why_won: string;
  deal_size?: string;
  closing_date?: string;
  brain_id: string;
}

interface ICPRulePayload {
  dimension: string;
  rule: string;
  weight: number;
  brain_id: string;
}

// ===========================================
// KB Researcher Class
// ===========================================

export class KBResearcher {
  private readonly config: KBResearcherConfig;
  private readonly callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;
  private readonly embedder: (text: string) => Promise<number[]>;

  constructor(
    callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>,
    embedder: (text: string) => Promise<number[]>,
    config?: Partial<KBResearcherConfig>
  ) {
    this.config = { ...DEFAULT_KB_CONFIG, ...config };
    this.callMcpTool = callMcpTool;
    this.embedder = embedder;
  }

  /**
   * Research KB for a meeting with a given attendee.
   * Queries are scoped to the brain_id per FR-014.
   */
  async research(
    brainId: BrainId,
    attendeeEmail: string,
    company: string | null,
    industry: string | null
  ): Promise<KBResearchResult> {
    const startTime = performance.now();

    try {
      // Build search context
      const searchContext = this.buildSearchContext(attendeeEmail, company, industry);

      // Generate embedding for similarity search
      const queryVector = await this.generateEmbedding(searchContext);

      if (!queryVector) {
        return {
          success: false,
          error: 'Failed to generate embedding for search query',
          code: 'EMBEDDING_ERROR',
        };
      }

      // Run all KB queries in parallel
      const [objectionHandlers, similarDeals, icpRules] = await Promise.all([
        this.searchObjectionHandlers(brainId, queryVector),
        this.searchSimilarDeals(brainId, queryVector, industry),
        this.getICPRules(brainId),
      ]);

      const duration = Math.round(performance.now() - startTime);

      return {
        success: true,
        data: {
          objection_handlers: objectionHandlers,
          similar_deals: similarDeals,
          icp_rules: icpRules,
        },
        query_duration_ms: duration,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
        return {
          success: false,
          error: 'Qdrant query timeout',
          code: 'TIMEOUT',
        };
      }

      return {
        success: false,
        error: errorMessage,
        code: 'QDRANT_ERROR',
      };
    }
  }

  /**
   * Build a search context string from meeting data.
   */
  private buildSearchContext(
    email: string,
    company: string | null,
    industry: string | null
  ): string {
    const parts: string[] = [];

    if (company) {
      parts.push(`Company: ${company}`);
    }

    if (industry) {
      parts.push(`Industry: ${industry}`);
    }

    // Extract domain from email
    const domain = email.split('@')[1];
    if (domain && !company) {
      parts.push(`Domain: ${domain}`);
    }

    return parts.join('. ') || 'General sales context';
  }

  /**
   * Generate embedding for search query.
   */
  private async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      return await this.embedder(text);
    } catch {
      return null;
    }
  }

  /**
   * Search for relevant objection handlers.
   * All queries include brain_id filter (FR-014).
   */
  private async searchObjectionHandlers(
    brainId: BrainId,
    queryVector: number[]
  ): Promise<ObjectionHandler[]> {
    try {
      const results = await this.callMcpTool<QdrantSearchResult<ObjectionPayload>[]>(
        'qdrant_search',
        {
          collection: 'objection_handlers',
          vector: queryVector,
          filter: {
            must: [{ key: 'brain_id', match: { value: brainId } }],
          },
          limit: this.config.maxObjectionHandlers,
          score_threshold: this.config.minSimilarityScore,
        }
      );

      return (results ?? []).map((result) => ({
        id: result.id,
        objection: result.payload.objection,
        response: result.payload.response,
        category: result.payload.category,
        confidence: result.score,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Search for similar won deals.
   * All queries include brain_id filter (FR-014).
   */
  private async searchSimilarDeals(
    brainId: BrainId,
    queryVector: number[],
    industry: string | null
  ): Promise<SimilarDeal[]> {
    try {
      // Build filter conditions
      const mustConditions: Array<{ key: string; match: { value: string } }> = [
        { key: 'brain_id', match: { value: brainId } },
      ];

      // Optionally filter by industry if available
      if (industry) {
        mustConditions.push({ key: 'industry', match: { value: industry } });
      }

      const results = await this.callMcpTool<QdrantSearchResult<DealPayload>[]>(
        'qdrant_search',
        {
          collection: 'market_research',
          vector: queryVector,
          filter: { must: mustConditions },
          limit: this.config.maxSimilarDeals,
          score_threshold: this.config.minSimilarityScore,
        }
      );

      return (results ?? []).map((result) => ({
        company: result.payload.company_name,
        industry: result.payload.industry,
        why_won: result.payload.why_won,
        deal_size: result.payload.deal_size ?? null,
        closing_date: result.payload.closing_date ?? null,
        relevance_score: result.score,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get ICP rules for the brain.
   * All queries include brain_id filter (FR-014).
   */
  private async getICPRules(brainId: BrainId): Promise<ICPRule[]> {
    try {
      const results = await this.callMcpTool<QdrantSearchResult<ICPRulePayload>[]>(
        'qdrant_scroll',
        {
          collection: 'icp_rules',
          filter: {
            must: [{ key: 'brain_id', match: { value: brainId } }],
          },
          limit: this.config.maxIcpRules,
        }
      );

      return (results ?? []).map((result) => ({
        dimension: result.payload.dimension,
        rule: result.payload.rule,
        weight: result.payload.weight,
      }));
    } catch {
      return [];
    }
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a KB researcher instance.
 */
export function createKBResearcher(
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>,
  embedder: (text: string) => Promise<number[]>,
  config?: Partial<KBResearcherConfig>
): KBResearcher {
  return new KBResearcher(callMcpTool, embedder, config);
}
