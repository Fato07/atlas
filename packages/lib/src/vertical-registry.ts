/**
 * Vertical Registry Service
 *
 * Data-driven vertical registry with caching and detection index building.
 * Replaces hardcoded vertical mappings with database-driven approach (Clay-inspired).
 *
 * @module vertical-registry
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import type {
  VerticalPayload,
  VerticalDetectionIndex,
  VerticalDetectionWeights,
  BrainId,
} from './types';

// ===========================================
// Configuration
// ===========================================

export interface VerticalRegistryConfig {
  /** Qdrant server URL */
  qdrantUrl: string;
  /** Qdrant API key */
  qdrantApiKey?: string;
  /** Collection name for verticals */
  verticalsCollection: string;
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtlMs: number;
  /** Stale-while-revalidate window in milliseconds (default: 1 minute) */
  staleWhileRevalidateMs: number;
}

export const DEFAULT_REGISTRY_CONFIG: VerticalRegistryConfig = {
  qdrantUrl: process.env.QDRANT_URL ?? 'http://localhost:6333',
  qdrantApiKey: process.env.QDRANT_API_KEY,
  verticalsCollection: 'verticals',
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
  staleWhileRevalidateMs: 60 * 1000, // 1 minute
};

// ===========================================
// Types
// ===========================================

/** Stored vertical with Qdrant point ID */
export interface StoredVertical extends VerticalPayload {
  /** Qdrant point ID */
  id: string;
}

/** Input for creating a new vertical */
export interface CreateVerticalInput {
  slug: string;
  name: string;
  description: string;
  parent_id?: string;
  level?: number;
  industry_keywords?: string[];
  title_keywords?: string[];
  campaign_patterns?: string[];
  detection_weights?: Partial<VerticalDetectionWeights>;
  aliases?: string[];
  exclusion_keywords?: string[];
  ai_fallback_threshold?: number;
  example_companies?: string[];
  classification_prompt?: string;
  default_brain_id?: string;
  is_active?: boolean;
}

/** Input for updating an existing vertical */
export interface UpdateVerticalInput {
  name?: string;
  description?: string;
  parent_id?: string;
  level?: number;
  industry_keywords?: string[];
  title_keywords?: string[];
  campaign_patterns?: string[];
  detection_weights?: Partial<VerticalDetectionWeights>;
  aliases?: string[];
  exclusion_keywords?: string[];
  ai_fallback_threshold?: number;
  example_companies?: string[];
  classification_prompt?: string;
  default_brain_id?: string;
  is_active?: boolean;
}

/** Cache entry with metadata */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  isStale: boolean;
}

// ===========================================
// Vertical Registry Class
// ===========================================

/**
 * Data-driven vertical registry with caching and detection index.
 *
 * Features:
 * - Stale-while-revalidate caching pattern
 * - O(1) keyword lookup via inverted index
 * - CRUD operations for verticals
 * - Hierarchy support (parent/child relationships)
 *
 * @example
 * ```typescript
 * const registry = new VerticalRegistry();
 * await registry.initialize();
 *
 * // Get all verticals
 * const verticals = await registry.getVerticals();
 *
 * // Build detection index for fast lookups
 * const index = await registry.buildDetectionIndex();
 * const vertical = index.industryToVertical.get('aerospace');
 * ```
 */
export class VerticalRegistry {
  private readonly config: VerticalRegistryConfig;
  private readonly client: QdrantClient;

  // Cache storage
  private verticalsCache: CacheEntry<StoredVertical[]> | null = null;
  private verticalBySlugCache: Map<string, CacheEntry<StoredVertical>> = new Map();
  private detectionIndexCache: CacheEntry<VerticalDetectionIndex> | null = null;

  // Background revalidation tracking
  private revalidationInProgress: Set<string> = new Set();

  constructor(config?: Partial<VerticalRegistryConfig>) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
    this.client = new QdrantClient({
      url: this.config.qdrantUrl,
      apiKey: this.config.qdrantApiKey,
    });
  }

  // ===========================================
  // Initialization
  // ===========================================

  /**
   * Initialize the registry by ensuring collection exists.
   */
  async initialize(): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === this.config.verticalsCollection
    );

    if (!exists) {
      // Create verticals collection with vector config
      // Using voyage-3.5-lite dimensions (1024)
      await this.client.createCollection(this.config.verticalsCollection, {
        vectors: {
          size: 1024,
          distance: 'Cosine',
        },
      });

      // Create payload indexes for filtering
      await this.client.createPayloadIndex(this.config.verticalsCollection, {
        field_name: 'slug',
        field_schema: 'keyword',
      });

      await this.client.createPayloadIndex(this.config.verticalsCollection, {
        field_name: 'is_active',
        field_schema: 'bool',
      });

      await this.client.createPayloadIndex(this.config.verticalsCollection, {
        field_name: 'parent_id',
        field_schema: 'keyword',
      });
    }
  }

  // ===========================================
  // Read Operations
  // ===========================================

  /**
   * Get all verticals with caching.
   *
   * Uses stale-while-revalidate pattern:
   * - Fresh data: Return immediately
   * - Stale data: Return immediately, revalidate in background
   * - Expired: Wait for fresh data
   */
  async getVerticals(options?: { includeInactive?: boolean }): Promise<StoredVertical[]> {
    const cacheKey = 'all_verticals';

    // Check cache
    if (this.verticalsCache) {
      const age = Date.now() - this.verticalsCache.timestamp;

      // Fresh: return immediately
      if (age < this.config.cacheTtlMs) {
        return this.filterVerticals(this.verticalsCache.data, options);
      }

      // Stale but within revalidation window: return and revalidate
      if (age < this.config.cacheTtlMs + this.config.staleWhileRevalidateMs) {
        this.revalidateInBackground(cacheKey);
        return this.filterVerticals(this.verticalsCache.data, options);
      }
    }

    // Expired or no cache: fetch fresh
    const verticals = await this.fetchAllVerticals();
    this.verticalsCache = {
      data: verticals,
      timestamp: Date.now(),
      isStale: false,
    };

    return this.filterVerticals(verticals, options);
  }

  /**
   * Get a vertical by slug with caching.
   */
  async getVertical(slug: string): Promise<StoredVertical | null> {
    const normalizedSlug = slug.toLowerCase();

    // Check cache
    const cached = this.verticalBySlugCache.get(normalizedSlug);
    if (cached) {
      const age = Date.now() - cached.timestamp;

      if (age < this.config.cacheTtlMs) {
        return cached.data;
      }

      if (age < this.config.cacheTtlMs + this.config.staleWhileRevalidateMs) {
        this.revalidateVerticalInBackground(normalizedSlug);
        return cached.data;
      }
    }

    // Fetch fresh
    const vertical = await this.fetchVerticalBySlug(normalizedSlug);
    if (vertical) {
      this.verticalBySlugCache.set(normalizedSlug, {
        data: vertical,
        timestamp: Date.now(),
        isStale: false,
      });
    }

    return vertical;
  }

  /**
   * Get verticals by parent ID (for hierarchy traversal).
   */
  async getChildVerticals(parentId: string): Promise<StoredVertical[]> {
    const allVerticals = await this.getVerticals({ includeInactive: true });
    return allVerticals.filter((v) => v.parent_id === parentId);
  }

  // ===========================================
  // Detection Index
  // ===========================================

  /**
   * Build inverted index for O(1) keyword lookups.
   *
   * Creates maps for:
   * - Industry keyword → vertical slug
   * - Title keyword → vertical slug
   * - Campaign pattern → vertical slug
   * - Alias → vertical slug
   * - Exclusions per vertical
   */
  async buildDetectionIndex(): Promise<VerticalDetectionIndex> {
    // Check cache
    if (this.detectionIndexCache) {
      const age = Date.now() - this.detectionIndexCache.timestamp;

      if (age < this.config.cacheTtlMs) {
        return this.detectionIndexCache.data;
      }

      if (age < this.config.cacheTtlMs + this.config.staleWhileRevalidateMs) {
        this.revalidateIndexInBackground();
        return this.detectionIndexCache.data;
      }
    }

    // Build fresh index
    const verticals = await this.getVerticals();
    const index = this.buildIndexFromVerticals(verticals);

    this.detectionIndexCache = {
      data: index,
      timestamp: Date.now(),
      isStale: false,
    };

    return index;
  }

  /**
   * Build detection index from vertical list.
   */
  private buildIndexFromVerticals(verticals: StoredVertical[]): VerticalDetectionIndex {
    const industryToVertical = new Map<string, string>();
    const titleToVertical = new Map<string, string>();
    const campaignToVertical = new Map<string, string>();
    const aliasToVertical = new Map<string, string>();
    const exclusions = new Map<string, Set<string>>();

    for (const vertical of verticals) {
      if (!vertical.is_active) continue;

      // Index industry keywords (lowercase for case-insensitive matching)
      for (const keyword of vertical.industry_keywords) {
        industryToVertical.set(keyword.toLowerCase(), vertical.slug);
      }

      // Index title keywords
      for (const keyword of vertical.title_keywords) {
        titleToVertical.set(keyword.toLowerCase(), vertical.slug);
      }

      // Index campaign patterns
      for (const pattern of vertical.campaign_patterns) {
        campaignToVertical.set(pattern.toLowerCase(), vertical.slug);
      }

      // Index aliases
      for (const alias of vertical.aliases) {
        aliasToVertical.set(alias.toLowerCase(), vertical.slug);
      }

      // Index exclusions
      if (vertical.exclusion_keywords.length > 0) {
        exclusions.set(
          vertical.slug,
          new Set(vertical.exclusion_keywords.map((k) => k.toLowerCase()))
        );
      }
    }

    return {
      industryToVertical,
      titleToVertical,
      campaignToVertical,
      aliasToVertical,
      exclusions,
      builtAt: new Date(),
    };
  }

  // ===========================================
  // Write Operations
  // ===========================================

  /**
   * Create a new vertical.
   */
  async createVertical(
    input: CreateVerticalInput,
    vector?: number[]
  ): Promise<StoredVertical> {
    const now = new Date().toISOString();
    const pointId = crypto.randomUUID();

    const defaultWeights: VerticalDetectionWeights = {
      industry: 0.9,
      title: 0.5,
      campaign: 0.7,
    };

    const payload: VerticalPayload = {
      slug: input.slug.toLowerCase(),
      name: input.name,
      description: input.description,
      parent_id: input.parent_id,
      level: input.level ?? 0,
      industry_keywords: input.industry_keywords ?? [],
      title_keywords: input.title_keywords ?? [],
      campaign_patterns: input.campaign_patterns ?? [],
      detection_weights: { ...defaultWeights, ...input.detection_weights },
      aliases: input.aliases ?? [],
      exclusion_keywords: input.exclusion_keywords ?? [],
      ai_fallback_threshold: input.ai_fallback_threshold ?? 0.5,
      example_companies: input.example_companies ?? [],
      classification_prompt: input.classification_prompt,
      default_brain_id: input.default_brain_id,
      is_active: input.is_active ?? true,
      created_at: now,
      updated_at: now,
      version: 1,
    };

    // Use provided vector or generate a zero vector placeholder
    // In production, this should be embedded using the description
    const pointVector = vector ?? new Array(1024).fill(0);

    await this.client.upsert(this.config.verticalsCollection, {
      wait: true,
      points: [
        {
          id: pointId,
          vector: pointVector,
          payload: payload as unknown as Record<string, unknown>,
        },
      ],
    });

    // Invalidate caches
    this.invalidateCaches();

    return { ...payload, id: pointId };
  }

  /**
   * Update an existing vertical.
   */
  async updateVertical(
    slug: string,
    input: UpdateVerticalInput
  ): Promise<StoredVertical> {
    const existing = await this.getVertical(slug);
    if (!existing) {
      throw new Error(`Vertical not found: ${slug}`);
    }

    const now = new Date().toISOString();

    // Build the update payload explicitly to avoid type spreading issues
    const updatedPayload: Record<string, unknown> = {
      updated_at: now,
      version: existing.version + 1,
    };

    // Copy over individual fields from input
    if (input.name !== undefined) updatedPayload.name = input.name;
    if (input.description !== undefined) updatedPayload.description = input.description;
    if (input.parent_id !== undefined) updatedPayload.parent_id = input.parent_id;
    if (input.level !== undefined) updatedPayload.level = input.level;
    if (input.industry_keywords !== undefined) updatedPayload.industry_keywords = input.industry_keywords;
    if (input.title_keywords !== undefined) updatedPayload.title_keywords = input.title_keywords;
    if (input.campaign_patterns !== undefined) updatedPayload.campaign_patterns = input.campaign_patterns;
    if (input.aliases !== undefined) updatedPayload.aliases = input.aliases;
    if (input.exclusion_keywords !== undefined) updatedPayload.exclusion_keywords = input.exclusion_keywords;
    if (input.ai_fallback_threshold !== undefined) updatedPayload.ai_fallback_threshold = input.ai_fallback_threshold;
    if (input.example_companies !== undefined) updatedPayload.example_companies = input.example_companies;
    if (input.classification_prompt !== undefined) updatedPayload.classification_prompt = input.classification_prompt;
    if (input.default_brain_id !== undefined) updatedPayload.default_brain_id = input.default_brain_id;
    if (input.is_active !== undefined) updatedPayload.is_active = input.is_active;

    // Merge detection weights if provided
    if (input.detection_weights) {
      updatedPayload.detection_weights = {
        ...existing.detection_weights,
        ...input.detection_weights,
      };
    }

    await this.client.setPayload(this.config.verticalsCollection, {
      wait: true,
      points: [existing.id],
      payload: updatedPayload,
    });

    // Invalidate caches
    this.invalidateCaches();
    this.verticalBySlugCache.delete(slug.toLowerCase());

    return { ...existing, ...updatedPayload } as StoredVertical;
  }

  /**
   * Delete a vertical (soft delete by setting is_active = false).
   */
  async deleteVertical(slug: string, hardDelete = false): Promise<void> {
    const existing = await this.getVertical(slug);
    if (!existing) {
      throw new Error(`Vertical not found: ${slug}`);
    }

    if (hardDelete) {
      await this.client.delete(this.config.verticalsCollection, {
        wait: true,
        points: [existing.id],
      });
    } else {
      await this.client.setPayload(this.config.verticalsCollection, {
        wait: true,
        points: [existing.id],
        payload: {
          is_active: false,
          updated_at: new Date().toISOString(),
        },
      });
    }

    // Invalidate caches
    this.invalidateCaches();
    this.verticalBySlugCache.delete(slug.toLowerCase());
  }

  /**
   * Link a brain to a vertical.
   */
  async linkBrain(slug: string, brainId: BrainId): Promise<void> {
    await this.updateVertical(slug, { default_brain_id: brainId });
  }

  // ===========================================
  // Cache Management
  // ===========================================

  /**
   * Invalidate all caches.
   */
  invalidateCaches(): void {
    this.verticalsCache = null;
    this.verticalBySlugCache.clear();
    this.detectionIndexCache = null;
  }

  /**
   * Force refresh of all cached data.
   */
  async refreshCache(): Promise<void> {
    this.invalidateCaches();
    await this.getVerticals();
    await this.buildDetectionIndex();
  }

  /**
   * Set detection index directly for testing purposes.
   * This bypasses Qdrant and allows unit tests to work without a database.
   *
   * @internal Only use in tests
   */
  setDetectionIndexForTesting(index: VerticalDetectionIndex): void {
    this.detectionIndexCache = {
      data: index,
      timestamp: Date.now(),
      isStale: false,
    };
  }

  /**
   * Set verticals directly for testing purposes.
   * This bypasses Qdrant and allows unit tests to work without a database.
   *
   * @internal Only use in tests
   */
  setVerticalsForTesting(verticals: StoredVertical[]): void {
    this.verticalsCache = {
      data: verticals,
      timestamp: Date.now(),
      isStale: false,
    };
  }

  // ===========================================
  // Private Helpers
  // ===========================================

  private filterVerticals(
    verticals: StoredVertical[],
    options?: { includeInactive?: boolean }
  ): StoredVertical[] {
    if (options?.includeInactive) {
      return verticals;
    }
    return verticals.filter((v) => v.is_active);
  }

  private async fetchAllVerticals(): Promise<StoredVertical[]> {
    const results: StoredVertical[] = [];
    let offset: string | number | undefined = undefined;

    // Scroll through all verticals
    while (true) {
      const response = await this.client.scroll(this.config.verticalsCollection, {
        limit: 100,
        offset,
        with_payload: true,
        with_vector: false,
      });

      for (const point of response.points) {
        results.push({
          ...(point.payload as unknown as VerticalPayload),
          id: String(point.id),
        });
      }

      if (!response.next_page_offset) {
        break;
      }
      // Qdrant returns offset as string | number, but type system is overly broad
      offset = response.next_page_offset as string | number;
    }

    return results;
  }

  private async fetchVerticalBySlug(slug: string): Promise<StoredVertical | null> {
    const response = await this.client.scroll(this.config.verticalsCollection, {
      limit: 1,
      filter: {
        must: [{ key: 'slug', match: { value: slug } }],
      },
      with_payload: true,
      with_vector: false,
    });

    if (response.points.length === 0) {
      return null;
    }

    const point = response.points[0];
    return {
      ...(point.payload as unknown as VerticalPayload),
      id: String(point.id),
    };
  }

  private async revalidateInBackground(cacheKey: string): Promise<void> {
    if (this.revalidationInProgress.has(cacheKey)) {
      return;
    }

    this.revalidationInProgress.add(cacheKey);

    try {
      const verticals = await this.fetchAllVerticals();
      this.verticalsCache = {
        data: verticals,
        timestamp: Date.now(),
        isStale: false,
      };
    } finally {
      this.revalidationInProgress.delete(cacheKey);
    }
  }

  private async revalidateVerticalInBackground(slug: string): Promise<void> {
    const cacheKey = `vertical_${slug}`;
    if (this.revalidationInProgress.has(cacheKey)) {
      return;
    }

    this.revalidationInProgress.add(cacheKey);

    try {
      const vertical = await this.fetchVerticalBySlug(slug);
      if (vertical) {
        this.verticalBySlugCache.set(slug, {
          data: vertical,
          timestamp: Date.now(),
          isStale: false,
        });
      }
    } finally {
      this.revalidationInProgress.delete(cacheKey);
    }
  }

  private async revalidateIndexInBackground(): Promise<void> {
    const cacheKey = 'detection_index';
    if (this.revalidationInProgress.has(cacheKey)) {
      return;
    }

    this.revalidationInProgress.add(cacheKey);

    try {
      const verticals = await this.fetchAllVerticals();
      const index = this.buildIndexFromVerticals(
        verticals.filter((v) => v.is_active)
      );
      this.detectionIndexCache = {
        data: index,
        timestamp: Date.now(),
        isStale: false,
      };
    } finally {
      this.revalidationInProgress.delete(cacheKey);
    }
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create and initialize a vertical registry instance.
 */
export async function createVerticalRegistry(
  config?: Partial<VerticalRegistryConfig>
): Promise<VerticalRegistry> {
  const registry = new VerticalRegistry(config);
  await registry.initialize();
  return registry;
}

// ===========================================
// Detection Utilities
// ===========================================

/**
 * Check if a value matches any keyword in the index.
 * Returns the matched vertical slug or null.
 */
export function matchKeyword(
  value: string,
  keywordMap: Map<string, string>,
  exclusions?: Map<string, Set<string>>
): { vertical: string; matchedKeyword: string } | null {
  const normalized = value.toLowerCase().trim();

  // Early return for empty or whitespace-only strings
  if (!normalized) {
    return null;
  }

  // Try exact match first
  const exactMatch = keywordMap.get(normalized);
  if (exactMatch) {
    // Check exclusions
    if (exclusions?.get(exactMatch)?.has(normalized)) {
      return null;
    }
    return { vertical: exactMatch, matchedKeyword: normalized };
  }

  // Try partial match (value contains keyword or keyword contains value)
  for (const [keyword, vertical] of keywordMap) {
    if (normalized.includes(keyword) || keyword.includes(normalized)) {
      // Check exclusions
      const verticalExclusions = exclusions?.get(vertical);
      if (verticalExclusions) {
        let excluded = false;
        for (const exclusion of verticalExclusions) {
          if (normalized.includes(exclusion)) {
            excluded = true;
            break;
          }
        }
        if (excluded) continue;
      }
      return { vertical, matchedKeyword: keyword };
    }
  }

  return null;
}

/**
 * Match campaign ID against patterns.
 * Supports wildcards: "defense_*" matches "defense_campaign_001"
 */
export function matchCampaignPattern(
  campaignId: string,
  patternMap: Map<string, string>
): { vertical: string; matchedPattern: string } | null {
  const normalized = campaignId.toLowerCase();

  for (const [pattern, vertical] of patternMap) {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`, 'i');

    if (regex.test(normalized)) {
      return { vertical, matchedPattern: pattern };
    }
  }

  return null;
}
