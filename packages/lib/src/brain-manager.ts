/**
 * Brain Manager Service
 *
 * Runtime API for brain management, brain switching, and brain-scoped KB queries.
 * Provides unified access to brain operations with caching and cache invalidation.
 *
 * @module brain-manager
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import type {
  Brain,
  BrainId,
  BrainStatus,
  BrainConfig,
  BrainStats,
  BrainFilters,
  GetBrainOptions,
  ICPRule,
  ResponseTemplate,
  ObjectionHandler,
  TemplateFilters,
  CollectionName,
} from './types';
import { VerticalRegistry } from './vertical-registry';

// ===========================================
// Configuration
// ===========================================

export interface BrainManagerConfig {
  /** Qdrant server URL */
  qdrantUrl: string;
  /** Qdrant API key */
  qdrantApiKey?: string;
  /** Cache TTL in milliseconds (default: 10 minutes) */
  cacheTtlMs: number;
  /** Stale-while-revalidate window in milliseconds (default: 2 minutes) */
  staleWhileRevalidateMs: number;
}

export const DEFAULT_BRAIN_MANAGER_CONFIG: BrainManagerConfig = {
  qdrantUrl: process.env.QDRANT_URL ?? 'http://localhost:6333',
  qdrantApiKey: process.env.QDRANT_API_KEY,
  cacheTtlMs: 10 * 60 * 1000, // 10 minutes
  staleWhileRevalidateMs: 2 * 60 * 1000, // 2 minutes
};

// ===========================================
// Types
// ===========================================

/** Stored brain with Qdrant point ID */
export interface StoredBrain extends Brain {
  /** Qdrant point ID */
  pointId: string;
}

/** Input for creating a new brain */
export interface CreateBrainInput {
  vertical: string;
  name: string;
  description?: string;
  config?: Partial<BrainConfig>;
}

/** Input for updating an existing brain */
export interface UpdateBrainInput {
  name?: string;
  description?: string;
  status?: BrainStatus;
  config?: Partial<BrainConfig>;
}

/** Options for copying a brain */
export interface CopyBrainOptions {
  /** New name for the copied brain */
  newName: string;
  /** Copy ICP rules */
  copyRules?: boolean;
  /** Copy response templates */
  copyTemplates?: boolean;
  /** Copy objection handlers */
  copyHandlers?: boolean;
  /** Copy market research */
  copyResearch?: boolean;
}

/** Cache entry with metadata */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  isStale: boolean;
}

// ===========================================
// Brain Manager Class
// ===========================================

/**
 * Brain Manager for runtime brain operations and KB queries.
 *
 * Features:
 * - Brain CRUD operations
 * - Brain-scoped KB queries (always filtered by brain_id)
 * - Stale-while-revalidate caching
 * - Brain copying for rapid vertical setup
 *
 * @example
 * ```typescript
 * const manager = new BrainManager();
 *
 * // Get active brain for a vertical
 * const brain = await manager.getBrain({ vertical: 'defense' });
 *
 * // Query KB rules scoped to brain
 * const rules = await manager.getIcpRules(brain);
 * ```
 */
export class BrainManager {
  private readonly config: BrainManagerConfig;
  private readonly client: QdrantClient;
  private readonly verticalRegistry: VerticalRegistry;

  // Cache storage
  private brainCache: Map<string, CacheEntry<StoredBrain>> = new Map();
  private brainListCache: CacheEntry<StoredBrain[]> | null = null;

  // Background revalidation tracking
  private revalidationInProgress: Set<string> = new Set();

  constructor(
    verticalRegistry: VerticalRegistry,
    config?: Partial<BrainManagerConfig>
  ) {
    this.config = { ...DEFAULT_BRAIN_MANAGER_CONFIG, ...config };
    this.verticalRegistry = verticalRegistry;
    this.client = new QdrantClient({
      url: this.config.qdrantUrl,
      apiKey: this.config.qdrantApiKey,
    });
  }

  // ===========================================
  // Brain Operations
  // ===========================================

  /**
   * Get a brain by ID or by vertical.
   *
   * If vertical is specified, returns the active brain for that vertical
   * by looking up the vertical's default_brain_id.
   */
  async getBrain(options: GetBrainOptions): Promise<StoredBrain | null> {
    if (options.brainId) {
      return this.getBrainById(options.brainId);
    }

    if (options.vertical) {
      return this.getBrainForVertical(options.vertical);
    }

    throw new Error('Must specify either brainId or vertical');
  }

  /**
   * Get a brain by its ID.
   */
  async getBrainById(brainId: BrainId): Promise<StoredBrain | null> {
    const cacheKey = `brain_${brainId}`;

    // Check cache
    const cached = this.brainCache.get(cacheKey);
    if (cached) {
      const age = Date.now() - cached.timestamp;

      if (age < this.config.cacheTtlMs) {
        return cached.data;
      }

      if (age < this.config.cacheTtlMs + this.config.staleWhileRevalidateMs) {
        this.revalidateBrainInBackground(brainId);
        return cached.data;
      }
    }

    // Fetch fresh
    const brain = await this.fetchBrainById(brainId);
    if (brain) {
      this.brainCache.set(cacheKey, {
        data: brain,
        timestamp: Date.now(),
        isStale: false,
      });
    }

    return brain;
  }

  /**
   * Get the active brain for a vertical.
   */
  async getBrainForVertical(vertical: string): Promise<StoredBrain | null> {
    // Look up vertical to get default_brain_id
    const verticalData = await this.verticalRegistry.getVertical(vertical);
    if (!verticalData) {
      return null;
    }

    if (!verticalData.default_brain_id) {
      return null;
    }

    return this.getBrainById(verticalData.default_brain_id as BrainId);
  }

  /**
   * Set the active brain for a vertical.
   */
  async setActiveBrain(vertical: string, brainId: BrainId): Promise<void> {
    // Verify brain exists
    const brain = await this.getBrainById(brainId);
    if (!brain) {
      throw new Error(`Brain not found: ${brainId}`);
    }

    // Update vertical's default_brain_id
    await this.verticalRegistry.linkBrain(vertical, brainId);

    // Invalidate caches
    this.invalidateCaches();
  }

  /**
   * List all brains with optional filters.
   */
  async listBrains(filters?: BrainFilters): Promise<StoredBrain[]> {
    // Check cache if no filters
    if (!filters && this.brainListCache) {
      const age = Date.now() - this.brainListCache.timestamp;

      if (age < this.config.cacheTtlMs) {
        return this.brainListCache.data;
      }

      if (age < this.config.cacheTtlMs + this.config.staleWhileRevalidateMs) {
        this.revalidateBrainListInBackground();
        return this.brainListCache.data;
      }
    }

    // Fetch fresh
    const brains = await this.fetchAllBrains();

    // Cache if no filters
    if (!filters) {
      this.brainListCache = {
        data: brains,
        timestamp: Date.now(),
        isStale: false,
      };
    }

    // Apply filters
    return this.applyFilters(brains, filters);
  }

  /**
   * Create a new brain.
   */
  async createBrain(input: CreateBrainInput): Promise<StoredBrain> {
    const now = new Date();
    const pointId = crypto.randomUUID();
    const brainId = `brain_${input.vertical}_${Date.now()}` as BrainId;

    const defaultConfig: BrainConfig = {
      default_tier_thresholds: {
        tier1: 80,
        tier2: 60,
        tier3: 40,
      },
      auto_response_enabled: false,
      learning_enabled: true,
      quality_gate_threshold: 0.7,
    };

    const payload = {
      id: brainId,
      vertical: input.vertical,
      name: input.name,
      description: input.description,
      status: 'active' as BrainStatus,
      config: { ...defaultConfig, ...input.config },
      stats: {
        icp_rules_count: 0,
        templates_count: 0,
        handlers_count: 0,
        research_docs_count: 0,
        insights_count: 0,
      },
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    // Use zero vector (in production, could embed brain description)
    const vector = new Array(1024).fill(0);

    await this.client.upsert('brains', {
      wait: true,
      points: [
        {
          id: pointId,
          vector,
          payload,
        },
      ],
    });

    // Invalidate caches
    this.invalidateCaches();

    const brain: StoredBrain = {
      pointId,
      id: brainId,
      vertical: input.vertical,
      name: input.name,
      description: input.description,
      status: 'active',
      config: payload.config,
      stats: payload.stats,
      createdAt: now,
      updatedAt: now,
    };

    return brain;
  }

  /**
   * Update an existing brain.
   */
  async updateBrain(
    brainId: BrainId,
    input: UpdateBrainInput
  ): Promise<StoredBrain> {
    const existing = await this.getBrainById(brainId);
    if (!existing) {
      throw new Error(`Brain not found: ${brainId}`);
    }

    const now = new Date();
    const updatePayload: Record<string, unknown> = {
      updated_at: now.toISOString(),
    };

    if (input.name !== undefined) {
      updatePayload.name = input.name;
    }
    if (input.description !== undefined) {
      updatePayload.description = input.description;
    }
    if (input.status !== undefined) {
      updatePayload.status = input.status;
    }
    if (input.config !== undefined) {
      updatePayload.config = { ...existing.config, ...input.config };
    }

    await this.client.setPayload('brains', {
      wait: true,
      points: [existing.pointId],
      payload: updatePayload,
    });

    // Invalidate caches
    this.invalidateCaches();

    // Build merged config if needed
    const mergedConfig = input.config
      ? ({ ...existing.config, ...input.config } as BrainConfig)
      : existing.config;

    return {
      pointId: existing.pointId,
      id: existing.id,
      vertical: existing.vertical,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      status: input.status ?? existing.status,
      config: mergedConfig,
      stats: existing.stats,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  /**
   * Copy a brain to a new brain.
   *
   * This is useful for creating a new vertical brain from an existing one.
   */
  async copyBrain(
    sourceBrainId: BrainId,
    options: CopyBrainOptions
  ): Promise<StoredBrain> {
    const source = await this.getBrainById(sourceBrainId);
    if (!source) {
      throw new Error(`Source brain not found: ${sourceBrainId}`);
    }

    // Create new brain with same vertical and config
    const newBrain = await this.createBrain({
      vertical: source.vertical,
      name: options.newName,
      description: source.description,
      config: source.config,
    });

    // Copy KB content if requested
    const collections: { name: CollectionName; enabled: boolean }[] = [
      { name: 'icp_rules', enabled: options.copyRules ?? true },
      { name: 'response_templates', enabled: options.copyTemplates ?? true },
      { name: 'objection_handlers', enabled: options.copyHandlers ?? true },
      { name: 'market_research', enabled: options.copyResearch ?? true },
    ];

    for (const { name, enabled } of collections) {
      if (!enabled) continue;

      await this.copyCollectionContent(name, sourceBrainId, newBrain.id);
    }

    // Update stats
    const stats = await this.computeBrainStats(newBrain.id);
    await this.client.setPayload('brains', {
      wait: true,
      points: [newBrain.pointId],
      payload: { stats },
    });

    return {
      ...newBrain,
      stats,
    };
  }

  // ===========================================
  // KB Query Methods (Brain-Scoped)
  // ===========================================

  /**
   * Get ICP rules for a brain.
   *
   * ALWAYS filters by brain_id to ensure data isolation.
   */
  async getIcpRules(
    brain: StoredBrain,
    options?: { query?: string; category?: string; limit?: number }
  ): Promise<ICPRule[]> {
    const filter: Record<string, unknown> = {
      must: [{ key: 'brain_id', match: { value: brain.id } }],
    };

    if (options?.category) {
      (filter.must as unknown[]).push({
        key: 'category',
        match: { value: options.category },
      });
    }

    const response = await this.client.scroll('icp_rules', {
      limit: options?.limit ?? 100,
      filter,
      with_payload: true,
      with_vector: false,
    });

    return response.points.map((point) => ({
      ...(point.payload as unknown as ICPRule),
      id: String(point.id),
    }));
  }

  /**
   * Get response templates for a brain.
   *
   * ALWAYS filters by brain_id to ensure data isolation.
   */
  async getTemplates(
    brain: StoredBrain,
    filters?: TemplateFilters
  ): Promise<ResponseTemplate[]> {
    const mustConditions: unknown[] = [
      { key: 'brain_id', match: { value: brain.id } },
    ];

    if (filters?.replyType) {
      mustConditions.push({
        key: 'reply_type',
        match: { value: filters.replyType },
      });
    }

    if (filters?.tier !== undefined) {
      mustConditions.push({
        key: 'tier',
        match: { value: filters.tier },
      });
    }

    const response = await this.client.scroll('response_templates', {
      limit: 100,
      filter: { must: mustConditions },
      with_payload: true,
      with_vector: false,
    });

    return response.points.map((point) => ({
      ...(point.payload as unknown as ResponseTemplate),
      id: String(point.id),
    }));
  }

  /**
   * Get objection handlers for a brain.
   *
   * ALWAYS filters by brain_id to ensure data isolation.
   */
  async getHandlers(
    brain: StoredBrain,
    type?: string
  ): Promise<ObjectionHandler[]> {
    const mustConditions: unknown[] = [
      { key: 'brain_id', match: { value: brain.id } },
    ];

    if (type) {
      mustConditions.push({
        key: 'objection_type',
        match: { value: type },
      });
    }

    const response = await this.client.scroll('objection_handlers', {
      limit: 100,
      filter: { must: mustConditions },
      with_payload: true,
      with_vector: false,
    });

    return response.points.map((point) => ({
      ...(point.payload as unknown as ObjectionHandler),
      id: String(point.id),
    }));
  }

  // ===========================================
  // Cache Management
  // ===========================================

  /**
   * Invalidate all caches.
   */
  invalidateCaches(): void {
    this.brainCache.clear();
    this.brainListCache = null;
  }

  /**
   * Force refresh of all cached data.
   */
  async refreshCache(): Promise<void> {
    this.invalidateCaches();
    await this.listBrains();
  }

  // ===========================================
  // Private Helpers
  // ===========================================

  private async fetchBrainById(brainId: BrainId): Promise<StoredBrain | null> {
    const response = await this.client.scroll('brains', {
      limit: 1,
      filter: {
        must: [{ key: 'id', match: { value: brainId } }],
      },
      with_payload: true,
      with_vector: false,
    });

    if (response.points.length === 0) {
      return null;
    }

    const point = response.points[0];
    const payload = point.payload as Record<string, unknown>;

    return {
      pointId: String(point.id),
      id: payload.id as BrainId,
      vertical: payload.vertical as string,
      name: payload.name as string,
      description: payload.description as string | undefined,
      status: payload.status as BrainStatus,
      config: payload.config as BrainConfig | undefined,
      stats: payload.stats as BrainStats | undefined,
      createdAt: new Date(payload.created_at as string),
      updatedAt: new Date(payload.updated_at as string),
    };
  }

  private async fetchAllBrains(): Promise<StoredBrain[]> {
    const results: StoredBrain[] = [];
    let offset: string | number | undefined = undefined;

    while (true) {
      const response = await this.client.scroll('brains', {
        limit: 100,
        offset,
        with_payload: true,
        with_vector: false,
      });

      for (const point of response.points) {
        const payload = point.payload as Record<string, unknown>;
        results.push({
          pointId: String(point.id),
          id: payload.id as BrainId,
          vertical: payload.vertical as string,
          name: payload.name as string,
          description: payload.description as string | undefined,
          status: payload.status as BrainStatus,
          config: payload.config as BrainConfig | undefined,
          stats: payload.stats as BrainStats | undefined,
          createdAt: new Date(payload.created_at as string),
          updatedAt: new Date(payload.updated_at as string),
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

  private applyFilters(
    brains: StoredBrain[],
    filters?: BrainFilters
  ): StoredBrain[] {
    if (!filters) {
      return brains;
    }

    let result = brains;

    if (filters.status) {
      result = result.filter((b) => b.status === filters.status);
    }

    if (filters.vertical) {
      result = result.filter((b) => b.vertical === filters.vertical);
    }

    return result;
  }

  private async revalidateBrainInBackground(brainId: BrainId): Promise<void> {
    const cacheKey = `brain_${brainId}`;
    if (this.revalidationInProgress.has(cacheKey)) {
      return;
    }

    this.revalidationInProgress.add(cacheKey);

    try {
      const brain = await this.fetchBrainById(brainId);
      if (brain) {
        this.brainCache.set(cacheKey, {
          data: brain,
          timestamp: Date.now(),
          isStale: false,
        });
      }
    } finally {
      this.revalidationInProgress.delete(cacheKey);
    }
  }

  private async revalidateBrainListInBackground(): Promise<void> {
    const cacheKey = 'brain_list';
    if (this.revalidationInProgress.has(cacheKey)) {
      return;
    }

    this.revalidationInProgress.add(cacheKey);

    try {
      const brains = await this.fetchAllBrains();
      this.brainListCache = {
        data: brains,
        timestamp: Date.now(),
        isStale: false,
      };
    } finally {
      this.revalidationInProgress.delete(cacheKey);
    }
  }

  private async copyCollectionContent(
    collection: CollectionName,
    sourceBrainId: BrainId,
    targetBrainId: BrainId
  ): Promise<void> {
    // Fetch all points from source brain
    const response = await this.client.scroll(collection, {
      limit: 1000,
      filter: {
        must: [{ key: 'brain_id', match: { value: sourceBrainId } }],
      },
      with_payload: true,
      with_vector: true,
    });

    if (response.points.length === 0) {
      return;
    }

    // Copy points with new brain_id
    const newPoints = response.points.map((point) => ({
      id: crypto.randomUUID(),
      vector: point.vector as number[],
      payload: {
        ...point.payload,
        brain_id: targetBrainId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }));

    await this.client.upsert(collection, {
      wait: true,
      points: newPoints,
    });
  }

  private async computeBrainStats(brainId: BrainId): Promise<BrainStats> {
    const collections: { name: CollectionName; statKey: keyof BrainStats }[] = [
      { name: 'icp_rules', statKey: 'icp_rules_count' },
      { name: 'response_templates', statKey: 'templates_count' },
      { name: 'objection_handlers', statKey: 'handlers_count' },
      { name: 'market_research', statKey: 'research_docs_count' },
      { name: 'insights', statKey: 'insights_count' },
    ];

    const stats: BrainStats = {
      icp_rules_count: 0,
      templates_count: 0,
      handlers_count: 0,
      research_docs_count: 0,
      insights_count: 0,
    };

    for (const { name, statKey } of collections) {
      try {
        const response = await this.client.count(name, {
          filter: {
            must: [{ key: 'brain_id', match: { value: brainId } }],
          },
          exact: true,
        });
        stats[statKey] = response.count;
      } catch {
        // Collection may not exist yet
        stats[statKey] = 0;
      }
    }

    return stats;
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a brain manager instance.
 *
 * @example
 * ```typescript
 * const registry = await createVerticalRegistry();
 * const manager = createBrainManager(registry);
 *
 * const brain = await manager.getBrain({ vertical: 'defense' });
 * ```
 */
export function createBrainManager(
  verticalRegistry: VerticalRegistry,
  config?: Partial<BrainManagerConfig>
): BrainManager {
  return new BrainManager(verticalRegistry, config);
}
