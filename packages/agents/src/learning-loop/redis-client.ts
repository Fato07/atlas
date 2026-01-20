/**
 * Learning Loop Redis Client
 *
 * Upstash Redis wrapper for the Learning Loop agent.
 * Manages validation queue, template performance tracking, and caching.
 *
 * @module learning-loop/redis-client
 */

import type { ValidationItem, TemplatePerformance, TemplateOutcome } from './contracts';
import { createTemplatePerformance, recordTemplateUsage, recordTemplateOutcome as applyOutcome } from './contracts';

// ===========================================
// Types
// ===========================================

export interface RedisClientConfig {
  /** Upstash Redis REST URL */
  url: string;
  /** Upstash Redis REST token */
  token: string;
  /** Key prefix for learning loop data */
  keyPrefix: string;
  /** TTL for validation items (48 hours default) */
  validationTtlHours: number;
  /** TTL for template stats (30 days default) */
  templateStatsTtlDays: number;
}

export const DEFAULT_REDIS_CONFIG: RedisClientConfig = {
  url: process.env.UPSTASH_REDIS_REST_URL ?? '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
  keyPrefix: 'learning-loop',
  validationTtlHours: 72, // 72 hours for expiration
  templateStatsTtlDays: 30,
};

// ===========================================
// Key Builders
// ===========================================

function buildKey(prefix: string, ...parts: string[]): string {
  return [prefix, ...parts].join(':');
}

// ===========================================
// Redis Client Class
// ===========================================

export class LearningLoopRedisClient {
  private readonly config: RedisClientConfig;
  private readonly baseUrl: string;
  private readonly headers: HeadersInit;

  constructor(config?: Partial<RedisClientConfig>) {
    this.config = { ...DEFAULT_REDIS_CONFIG, ...config };
    this.baseUrl = this.config.url;
    this.headers = {
      Authorization: `Bearer ${this.config.token}`,
      'Content-Type': 'application/json',
    };
  }

  // ===========================================
  // Low-level Redis Operations
  // ===========================================

  private async execute<T>(command: string[]): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(`Redis error: ${response.statusText}`);
    }

    const data = (await response.json()) as { result: T };
    return data.result;
  }

  private async pipeline<T>(commands: string[][]): Promise<T[]> {
    const response = await fetch(`${this.baseUrl}/pipeline`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(commands),
    });

    if (!response.ok) {
      throw new Error(`Redis pipeline error: ${response.statusText}`);
    }

    const data = (await response.json()) as Array<{ result: T }>;
    return data.map((item) => item.result);
  }

  // ===========================================
  // Key Helpers
  // ===========================================

  private validationKey(validationId: string): string {
    return buildKey(this.config.keyPrefix, 'validation', validationId);
  }

  private pendingValidationsKey(brainId: string): string {
    return buildKey(this.config.keyPrefix, 'pending', brainId);
  }

  private templateKey(brainId: string, templateId: string): string {
    return buildKey(this.config.keyPrefix, 'template', brainId, templateId);
  }

  private synthesisScheduleKey(brainId: string): string {
    return buildKey(this.config.keyPrefix, 'synthesis-schedule', brainId);
  }

  // ===========================================
  // Validation Queue Operations (FR-011 - FR-017)
  // ===========================================

  /**
   * Store a validation item.
   */
  async setValidationItem(item: ValidationItem): Promise<void> {
    const key = this.validationKey(item.id);
    const ttl = this.config.validationTtlHours * 60 * 60;

    await this.execute(['SET', key, JSON.stringify(item), 'EX', ttl.toString()]);

    // Add to pending set for brain
    const pendingKey = this.pendingValidationsKey(item.brain_id);
    await this.execute(['SADD', pendingKey, item.id]);
  }

  /**
   * Get a validation item by ID.
   */
  async getValidationItem(validationId: string): Promise<ValidationItem | null> {
    const key = this.validationKey(validationId);
    const result = await this.execute<string | null>(['GET', key]);

    if (!result) return null;
    return JSON.parse(result) as ValidationItem;
  }

  /**
   * Update a validation item.
   */
  async updateValidationItem(item: ValidationItem): Promise<void> {
    const key = this.validationKey(item.id);
    const ttl = await this.execute<number>(['TTL', key]);

    if (ttl > 0) {
      await this.execute(['SET', key, JSON.stringify(item), 'EX', ttl.toString()]);
    } else {
      // Re-set with default TTL if expired
      const defaultTtl = this.config.validationTtlHours * 60 * 60;
      await this.execute(['SET', key, JSON.stringify(item), 'EX', defaultTtl.toString()]);
    }
  }

  /**
   * Delete a validation item.
   */
  async deleteValidationItem(validationId: string, brainId: string): Promise<void> {
    const key = this.validationKey(validationId);
    const pendingKey = this.pendingValidationsKey(brainId);

    await this.pipeline([
      ['DEL', key],
      ['SREM', pendingKey, validationId],
    ]);
  }

  /**
   * Get all pending validation IDs for a brain.
   */
  async getPendingValidationIds(brainId: string): Promise<string[]> {
    const pendingKey = this.pendingValidationsKey(brainId);
    return this.execute<string[]>(['SMEMBERS', pendingKey]);
  }

  /**
   * Get all pending validations for a brain.
   */
  async getPendingValidations(brainId: string): Promise<ValidationItem[]> {
    const ids = await this.getPendingValidationIds(brainId);

    if (ids.length === 0) return [];

    const keys = ids.map((id) => this.validationKey(id));
    const results = await this.execute<(string | null)[]>(['MGET', ...keys]);

    return results
      .filter((r): r is string => r !== null)
      .map((r) => JSON.parse(r) as ValidationItem);
  }

  /**
   * Get count of pending validations for a brain.
   */
  async getPendingValidationCount(brainId: string): Promise<number> {
    const pendingKey = this.pendingValidationsKey(brainId);
    return this.execute<number>(['SCARD', pendingKey]);
  }

  // ===========================================
  // Template Performance Operations (FR-025 - FR-031)
  // ===========================================

  /**
   * Get template performance stats.
   */
  async getTemplatePerformance(
    brainId: string,
    templateId: string
  ): Promise<TemplatePerformance | null> {
    const key = this.templateKey(brainId, templateId);
    const result = await this.execute<string | null>(['GET', key]);

    if (!result) return null;
    return JSON.parse(result) as TemplatePerformance;
  }

  /**
   * Set template performance stats.
   */
  async setTemplatePerformance(
    brainId: string,
    templateId: string,
    performance: TemplatePerformance
  ): Promise<void> {
    const key = this.templateKey(brainId, templateId);
    const ttl = this.config.templateStatsTtlDays * 24 * 60 * 60;

    await this.execute(['SET', key, JSON.stringify(performance), 'EX', ttl.toString()]);
  }

  /**
   * Record template usage.
   */
  async recordUsage(brainId: string, templateId: string): Promise<void> {
    let performance = await this.getTemplatePerformance(brainId, templateId);

    if (!performance) {
      performance = createTemplatePerformance(templateId, brainId);
    }

    performance = recordTemplateUsage(performance);

    await this.setTemplatePerformance(brainId, templateId, performance);
  }

  /**
   * Record template outcome.
   */
  async recordOutcome(
    brainId: string,
    templateId: string,
    outcome: TemplateOutcome
  ): Promise<void> {
    const performance = await this.getTemplatePerformance(brainId, templateId);

    if (!performance) {
      // Can't record outcome for unknown template
      console.warn(`Template ${templateId} not found, cannot record outcome`);
      return;
    }

    const updated = applyOutcome(performance, outcome);

    await this.setTemplatePerformance(brainId, templateId, updated);
  }

  /**
   * Get all template performances for a brain.
   */
  async getAllTemplatePerformances(brainId: string): Promise<TemplatePerformance[]> {
    // This requires scanning - not ideal but works for moderate data sizes
    const pattern = this.templateKey(brainId, '*');
    const keys = await this.execute<string[]>(['KEYS', pattern]);

    if (keys.length === 0) return [];

    const results = await this.execute<(string | null)[]>(['MGET', ...keys]);

    return results
      .filter((r): r is string => r !== null)
      .map((r) => JSON.parse(r) as TemplatePerformance);
  }

  /**
   * Get templates with declining performance (FR-030).
   */
  async getDecliningTemplates(
    brainId: string,
    threshold = 0.2
  ): Promise<TemplatePerformance[]> {
    const performances = await this.getAllTemplatePerformances(brainId);

    // Filter to templates with significant usage and low success rate
    return performances.filter((p) => {
      const totalOutcomes =
        p.outcomes.meeting_booked + p.outcomes.positive_reply +
        p.outcomes.no_response + p.outcomes.negative_reply;
      return totalOutcomes >= 10 && p.success_rate < threshold;
    });
  }

  // ===========================================
  // Synthesis Schedule Operations
  // ===========================================

  /**
   * Get last synthesis run time.
   */
  async getLastSynthesisRun(brainId: string): Promise<string | null> {
    const key = this.synthesisScheduleKey(brainId);
    return this.execute<string | null>(['GET', key]);
  }

  /**
   * Set last synthesis run time.
   */
  async setLastSynthesisRun(brainId: string, timestamp: string): Promise<void> {
    const key = this.synthesisScheduleKey(brainId);
    await this.execute(['SET', key, timestamp]);
  }

  /**
   * Check if synthesis is due.
   */
  async isSynthesisDue(brainId: string, intervalDays = 7): Promise<boolean> {
    const lastRun = await this.getLastSynthesisRun(brainId);

    if (!lastRun) return true;

    const lastRunDate = new Date(lastRun);
    const now = new Date();
    const daysSinceLastRun =
      (now.getTime() - lastRunDate.getTime()) / (1000 * 60 * 60 * 24);

    return daysSinceLastRun >= intervalDays;
  }

  // ===========================================
  // Utility Methods
  // ===========================================

  /**
   * Health check - verify connection works.
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.execute<string>(['PING']);
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Get stats for monitoring.
   */
  async getStats(brainId: string): Promise<{
    pendingValidations: number;
    trackedTemplates: number;
    lastSynthesis: string | null;
  }> {
    const [pendingCount, templates, lastSynthesis] = await Promise.all([
      this.getPendingValidationCount(brainId),
      this.getAllTemplatePerformances(brainId),
      this.getLastSynthesisRun(brainId),
    ]);

    return {
      pendingValidations: pendingCount,
      trackedTemplates: templates.length,
      lastSynthesis,
    };
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Learning Loop Redis client instance.
 */
export function createRedisClient(
  config?: Partial<RedisClientConfig>
): LearningLoopRedisClient {
  return new LearningLoopRedisClient(config);
}
