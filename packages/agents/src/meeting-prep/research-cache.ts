/**
 * Research Cache
 *
 * Implements caching for company research data using Upstash Redis.
 * Provides 24-hour TTL for research data to reduce redundant API calls.
 *
 * Cache key format: `research:${company_name}`
 *
 * @module meeting-prep/research-cache
 */

import { Redis } from '@upstash/redis';
import type { ResearchCache } from './types';
import type { MeetingPrepLogger } from './logger';

// ===========================================
// Configuration
// ===========================================

export interface ResearchCacheConfig {
  /** Redis URL (defaults to UPSTASH_REDIS_REST_URL env var) */
  url?: string;

  /** Redis token (defaults to UPSTASH_REDIS_REST_TOKEN env var) */
  token?: string;

  /** Cache TTL in hours (default: 24) */
  ttlHours: number;

  /** Cache key prefix (default: 'research') */
  keyPrefix: string;

  /** Enable caching (default: true, false for testing) */
  enabled: boolean;
}

export const DEFAULT_RESEARCH_CACHE_CONFIG: ResearchCacheConfig = {
  ttlHours: 24,
  keyPrefix: 'research',
  enabled: true,
};

export interface ResearchCacheDependencies {
  /** Optional logger for cache metrics */
  logger?: MeetingPrepLogger;
}

// ===========================================
// Cache Client
// ===========================================

export class ResearchCacheClient {
  private readonly redis: Redis | null;
  private readonly config: ResearchCacheConfig;
  private readonly logger?: MeetingPrepLogger;

  constructor(
    deps: ResearchCacheDependencies = {},
    config?: Partial<ResearchCacheConfig>
  ) {
    this.config = { ...DEFAULT_RESEARCH_CACHE_CONFIG, ...config };
    this.logger = deps.logger;

    // Initialize Redis client if enabled and credentials available
    if (this.config.enabled) {
      const url = this.config.url || process.env.UPSTASH_REDIS_REST_URL;
      const token = this.config.token || process.env.UPSTASH_REDIS_REST_TOKEN;

      if (url && token) {
        this.redis = new Redis({ url, token });
        this.logger?.debug('Research cache initialized with Upstash Redis');
      } else {
        this.redis = null;
        this.logger?.warn(
          'Research cache disabled: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set'
        );
      }
    } else {
      this.redis = null;
      this.logger?.debug('Research cache disabled by configuration');
    }
  }

  // ===========================================
  // Public Methods
  // ===========================================

  /**
   * Get cached research for a company.
   *
   * @param companyName - The company name to look up
   * @returns Cached research data or null if not found/expired
   */
  async getCachedResearch(companyName: string): Promise<ResearchCache | null> {
    if (!this.redis) {
      return null;
    }

    const cacheKey = this.buildCacheKey(companyName);

    try {
      const cached = await this.redis.get<ResearchCache>(cacheKey);

      if (!cached) {
        this.logger?.debug('Research cache miss', { company: companyName });
        return null;
      }

      // Validate cache expiration (double-check in case TTL wasn't set properly)
      if (this.isExpired(cached)) {
        this.logger?.debug('Research cache expired', { company: companyName });
        await this.redis.del(cacheKey);
        return null;
      }

      this.logger?.debug('Research cache hit', {
        company: companyName,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
      });

      return cached;
    } catch (error) {
      this.logger?.error('Research cache get error', error, {
        company: companyName,
      });
      return null;
    }
  }

  /**
   * Cache research data for a company.
   *
   * @param cache - The research cache object to store
   */
  async cacheResearch(cache: ResearchCache): Promise<void> {
    if (!this.redis) {
      return;
    }

    const cacheKey = this.buildCacheKey(cache.company_name);
    const ttlSeconds = this.config.ttlHours * 60 * 60;

    try {
      await this.redis.set(cacheKey, cache, { ex: ttlSeconds });

      this.logger?.debug('Research cached', {
        company: cache.company_name,
        cache_key: cacheKey,
        ttl_hours: this.config.ttlHours,
        sources: cache.sources_used,
      });
    } catch (error) {
      this.logger?.error('Research cache set error', error, {
        company: cache.company_name,
      });
      // Don't throw - caching failures shouldn't break the flow
    }
  }

  /**
   * Delete cached research for a company.
   *
   * @param companyName - The company name to delete cache for
   */
  async invalidateCache(companyName: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    const cacheKey = this.buildCacheKey(companyName);

    try {
      await this.redis.del(cacheKey);
      this.logger?.debug('Research cache invalidated', { company: companyName });
    } catch (error) {
      this.logger?.error('Research cache delete error', error, {
        company: companyName,
      });
    }
  }

  /**
   * Check if the cache client is operational.
   */
  isEnabled(): boolean {
    return this.redis !== null;
  }

  // ===========================================
  // Private Methods
  // ===========================================

  /**
   * Build the cache key for a company.
   */
  private buildCacheKey(companyName: string): string {
    // Normalize company name: lowercase, remove special chars, replace spaces with hyphens
    const normalized = companyName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();

    return `${this.config.keyPrefix}:${normalized}`;
  }

  /**
   * Check if cached data has expired.
   */
  private isExpired(cache: ResearchCache): boolean {
    const expiresAt = new Date(cache.expires_at);
    return expiresAt <= new Date();
  }
}

// ===========================================
// Factory Functions
// ===========================================

/**
 * Create a research cache client.
 */
export function createResearchCache(
  deps: ResearchCacheDependencies = {},
  config?: Partial<ResearchCacheConfig>
): ResearchCacheClient {
  return new ResearchCacheClient(deps, config);
}

/**
 * Create cache getter/setter functions for use with ContextGatherer.
 *
 * This returns the function signatures expected by ContextGathererDependencies.
 */
export function createCacheFunctions(
  client: ResearchCacheClient
): {
  getResearchCache: (key: string) => Promise<ResearchCache | null>;
  setResearchCache: (cache: ResearchCache) => Promise<void>;
} {
  return {
    getResearchCache: (key: string) => client.getCachedResearch(key),
    setResearchCache: (cache: ResearchCache) => client.cacheResearch(cache),
  };
}

// ===========================================
// In-Memory Cache (for testing)
// ===========================================

/**
 * In-memory cache implementation for testing.
 */
export class InMemoryResearchCache {
  private readonly cache = new Map<string, { data: ResearchCache; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlHours: number = 24) {
    this.ttlMs = ttlHours * 60 * 60 * 1000;
  }

  async getCachedResearch(companyName: string): Promise<ResearchCache | null> {
    const key = this.normalizeKey(companyName);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  async cacheResearch(cache: ResearchCache): Promise<void> {
    const key = this.normalizeKey(cache.company_name);
    this.cache.set(key, {
      data: cache,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  async invalidateCache(companyName: string): Promise<void> {
    const key = this.normalizeKey(companyName);
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  private normalizeKey(companyName: string): string {
    return companyName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }
}

/**
 * Create cache functions using in-memory storage (for testing).
 */
export function createInMemoryCacheFunctions(
  ttlHours: number = 24
): {
  cache: InMemoryResearchCache;
  getResearchCache: (key: string) => Promise<ResearchCache | null>;
  setResearchCache: (cache: ResearchCache) => Promise<void>;
} {
  const cache = new InMemoryResearchCache(ttlHours);
  return {
    cache,
    getResearchCache: (key: string) => cache.getCachedResearch(key),
    setResearchCache: (data: ResearchCache) => cache.cacheResearch(data),
  };
}
