/**
 * Reply Handler Agent - KB Matcher
 *
 * Matches replies to knowledge base templates and handlers using Qdrant.
 * Implements FR-005, FR-006, FR-007, FR-008 for brain-scoped KB matching.
 *
 * @module reply-handler/matcher
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import type { Classification, KBMatch, Intent } from './contracts/handler-result';

// ===========================================
// Matcher Configuration
// ===========================================

export interface MatcherConfig {
  /** Qdrant client instance */
  qdrantClient: QdrantClient;

  /** Embedding function (e.g., Voyage AI) */
  embedder: (text: string) => Promise<number[]>;

  /** Collection names */
  collections?: {
    responseTemplates?: string;
    objectionHandlers?: string;
  };

  /** Search configuration */
  searchConfig?: {
    /** Number of results to return per search */
    limit?: number;

    /** Minimum score threshold */
    minScore?: number;
  };
}

const DEFAULT_COLLECTIONS = {
  responseTemplates: 'response_templates',
  objectionHandlers: 'objection_handlers',
};

const DEFAULT_SEARCH_CONFIG = {
  limit: 5,
  minScore: 0.5,
};

// ===========================================
// KB Template/Handler Interfaces
// ===========================================

interface ResponseTemplatePayload {
  id: string;
  brain_id: string;
  reply_type: string;
  tier_eligible: number[];
  content: string;
  personalization_instructions?: string;
  variables?: string[];
  created_at: string;
}

interface ObjectionHandlerPayload {
  id: string;
  brain_id: string;
  objection_type: string;
  strategy: string;
  content: string;
  examples?: string[];
  created_at: string;
}

// ===========================================
// KB Matcher Class
// ===========================================

export class KBMatcher {
  private qdrant: QdrantClient;
  private embedder: (text: string) => Promise<number[]>;
  private collections: typeof DEFAULT_COLLECTIONS;
  private searchConfig: typeof DEFAULT_SEARCH_CONFIG;

  constructor(config: MatcherConfig) {
    this.qdrant = config.qdrantClient;
    this.embedder = config.embedder;
    this.collections = {
      ...DEFAULT_COLLECTIONS,
      ...config.collections,
    };
    this.searchConfig = {
      ...DEFAULT_SEARCH_CONFIG,
      ...config.searchConfig,
    };
  }

  // ===========================================
  // Main Matching Method
  // ===========================================

  /**
   * Find the best KB match for a classified reply
   */
  async findMatch(params: {
    classification: Classification;
    replyText: string;
    brainId: string;
  }): Promise<KBMatch | undefined> {
    const { classification, replyText, brainId } = params;

    // Route to appropriate matcher based on intent
    if (classification.intent === 'objection') {
      return this.matchObjectionHandler(replyText, brainId);
    }

    // For most intents, match against response templates
    return this.matchResponseTemplate(
      replyText,
      classification.reply_type,
      brainId
    );
  }

  // ===========================================
  // Response Template Matching (FR-005)
  // ===========================================

  /**
   * Match reply to response templates
   */
  async matchResponseTemplate(
    replyText: string,
    replyType: string,
    brainId: string
  ): Promise<KBMatch | undefined> {
    // Generate embedding for the reply
    const embedding = await this.embedder(replyText);

    // Search with brain_id filter (FR-008)
    const results = await this.qdrant.search(this.collections.responseTemplates, {
      vector: embedding,
      limit: this.searchConfig.limit,
      filter: {
        must: [
          { key: 'brain_id', match: { value: brainId } },
          { key: 'reply_type', match: { value: replyType } },
        ],
      },
      with_payload: true,
    });

    // Find best match above threshold
    for (const result of results) {
      if (result.score >= this.searchConfig.minScore) {
        const payload = result.payload as unknown as ResponseTemplatePayload;

        return {
          type: 'template',
          id: payload.id,
          confidence: result.score,
          content: payload.content,
          personalization_instructions: payload.personalization_instructions,
        };
      }
    }

    // Try fallback: search without reply_type filter
    const fallbackResults = await this.qdrant.search(this.collections.responseTemplates, {
      vector: embedding,
      limit: this.searchConfig.limit,
      filter: {
        must: [{ key: 'brain_id', match: { value: brainId } }],
      },
      with_payload: true,
    });

    for (const result of fallbackResults) {
      if (result.score >= this.searchConfig.minScore) {
        const payload = result.payload as unknown as ResponseTemplatePayload;

        return {
          type: 'template',
          id: payload.id,
          confidence: result.score * 0.9, // Slight confidence penalty for fallback
          content: payload.content,
          personalization_instructions: payload.personalization_instructions,
        };
      }
    }

    return undefined;
  }

  // ===========================================
  // Objection Handler Matching (FR-006)
  // ===========================================

  /**
   * Match objection reply to handlers
   */
  async matchObjectionHandler(
    replyText: string,
    brainId: string
  ): Promise<KBMatch | undefined> {
    // Generate embedding for the reply
    const embedding = await this.embedder(replyText);

    // Detect objection type from content
    const objectionType = this.detectObjectionType(replyText);

    // Build filter
    const filter: any = {
      must: [{ key: 'brain_id', match: { value: brainId } }],
    };

    // Add objection type filter if detected
    if (objectionType) {
      filter.must.push({ key: 'objection_type', match: { value: objectionType } });
    }

    // Search with brain_id filter (FR-008)
    const results = await this.qdrant.search(this.collections.objectionHandlers, {
      vector: embedding,
      limit: this.searchConfig.limit,
      filter,
      with_payload: true,
    });

    // Find best match above threshold
    for (const result of results) {
      if (result.score >= this.searchConfig.minScore) {
        const payload = result.payload as unknown as ObjectionHandlerPayload;

        return {
          type: 'handler',
          id: payload.id,
          confidence: result.score,
          content: payload.content,
          strategy: payload.strategy,
        };
      }
    }

    // Fallback: search all objection handlers without type filter
    if (objectionType) {
      const fallbackResults = await this.qdrant.search(this.collections.objectionHandlers, {
        vector: embedding,
        limit: this.searchConfig.limit,
        filter: {
          must: [{ key: 'brain_id', match: { value: brainId } }],
        },
        with_payload: true,
      });

      for (const result of fallbackResults) {
        if (result.score >= this.searchConfig.minScore) {
          const payload = result.payload as unknown as ObjectionHandlerPayload;

          return {
            type: 'handler',
            id: payload.id,
            confidence: result.score * 0.85, // Penalty for non-specific match
            content: payload.content,
            strategy: payload.strategy,
          };
        }
      }
    }

    return undefined;
  }

  // ===========================================
  // Objection Type Detection
  // ===========================================

  /**
   * Detect objection type from reply content
   */
  detectObjectionType(
    content: string
  ): 'budget' | 'timing' | 'authority' | 'competitor' | undefined {
    const lowerContent = content.toLowerCase();

    // Budget objection patterns
    if (
      /\b(budget|afford|expensive|cost|price|pricing|too much|investment)\b/.test(
        lowerContent
      )
    ) {
      return 'budget';
    }

    // Timing objection patterns
    if (
      /\b(not the right time|bad timing|maybe later|next quarter|next year|revisit|circle back|not now)\b/.test(
        lowerContent
      )
    ) {
      return 'timing';
    }

    // Authority objection patterns
    if (
      /\b(check with|approval|talk to|run it by|decision|manager|boss|leadership|exec)\b/.test(
        lowerContent
      )
    ) {
      return 'authority';
    }

    // Competitor objection patterns
    if (
      /\b(already using|current solution|competitor|alternative|other vendor|signed with|contract with)\b/.test(
        lowerContent
      )
    ) {
      return 'competitor';
    }

    return undefined;
  }

  // ===========================================
  // Batch Matching
  // ===========================================

  /**
   * Match multiple replies in batch
   */
  async matchBatch(
    params: Array<{
      classification: Classification;
      replyText: string;
      brainId: string;
    }>
  ): Promise<Array<KBMatch | undefined>> {
    return Promise.all(params.map(p => this.findMatch(p)));
  }

  // ===========================================
  // Collection Health Check
  // ===========================================

  /**
   * Check if KB collections exist and have content for a brain
   */
  async checkKBHealth(brainId: string): Promise<{
    healthy: boolean;
    templateCount: number;
    handlerCount: number;
  }> {
    try {
      // Check template collection
      const templateCount = await this.qdrant.count(this.collections.responseTemplates, {
        filter: {
          must: [{ key: 'brain_id', match: { value: brainId } }],
        },
        exact: false,
      });

      // Check handler collection
      const handlerCount = await this.qdrant.count(this.collections.objectionHandlers, {
        filter: {
          must: [{ key: 'brain_id', match: { value: brainId } }],
        },
        exact: false,
      });

      return {
        healthy: templateCount.count > 0 || handlerCount.count > 0,
        templateCount: templateCount.count,
        handlerCount: handlerCount.count,
      };
    } catch (error) {
      return {
        healthy: false,
        templateCount: 0,
        handlerCount: 0,
      };
    }
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a KB matcher
 */
export function createMatcher(config: MatcherConfig): KBMatcher {
  return new KBMatcher(config);
}

// ===========================================
// Tier Eligibility Helpers
// ===========================================

/**
 * Check if a KB match is eligible for a specific tier
 */
export function isEligibleForTier(match: KBMatch, tier: 1 | 2 | 3): boolean {
  // Without tier_eligible info, use confidence thresholds
  // Per spec.md:
  // - Tier 1: confidence >= 0.85
  // - Tier 2: 0.50 <= confidence < 0.85
  // - Tier 3: confidence < 0.50

  switch (tier) {
    case 1:
      return match.confidence >= 0.85;
    case 2:
      return match.confidence >= 0.50 && match.confidence < 0.85;
    case 3:
      return match.confidence < 0.50;
    default:
      return false;
  }
}

/**
 * Get recommended tier based on match confidence
 */
export function getRecommendedTier(match: KBMatch | undefined): 1 | 2 | 3 {
  if (!match) return 3;

  if (match.confidence >= 0.85) return 1;
  if (match.confidence >= 0.50) return 2;
  return 3;
}
