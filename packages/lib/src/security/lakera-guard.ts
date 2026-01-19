/**
 * Lakera Guard Client
 *
 * Core client for interacting with Lakera Guard API for prompt injection
 * detection and PII masking.
 */

import type {
  LakeraGuardResponse,
  CategoryResult,
  PIIResult,
  ThreatCategory,
} from './types';

/**
 * Lakera Guard API endpoint
 */
const LAKERA_API_URL = 'https://api.lakera.ai/v2/guard';

/**
 * Lakera Guard client configuration
 */
export interface LakeraGuardClientConfig {
  /**
   * Lakera Guard API key
   */
  apiKey: string;

  /**
   * Optional project ID for tracking
   */
  projectId?: string;

  /**
   * Request timeout in milliseconds
   * @default 5000
   */
  timeoutMs?: number;

  /**
   * Custom API endpoint (for testing)
   */
  apiUrl?: string;
}

/**
 * Lakera Guard client for threat detection
 */
export class LakeraGuardClient {
  private readonly apiKey: string;
  private readonly projectId?: string;
  private readonly timeoutMs: number;
  private readonly apiUrl: string;

  constructor(config: LakeraGuardClientConfig) {
    this.apiKey = config.apiKey;
    this.projectId = config.projectId;
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.apiUrl = config.apiUrl ?? LAKERA_API_URL;
  }

  /**
   * Screen content for threats using Lakera Guard
   *
   * @param content - Content to screen
   * @returns Guard response with threat detection results
   */
  async screen(content: string): Promise<LakeraGuardResponse> {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
          ...(this.projectId && { 'X-Project-ID': this.projectId }),
        },
        body: JSON.stringify({
          input: content,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Lakera API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;

      return this.parseResponse(data, latencyMs, requestId);
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Lakera API timeout after ${this.timeoutMs}ms`);
      }

      throw error;
    }
  }

  /**
   * Parse Lakera Guard API response into typed result
   */
  private parseResponse(
    data: unknown,
    latencyMs: number,
    requestId: string
  ): LakeraGuardResponse {
    // Type guard for API response
    const apiResponse = data as {
      results?: Array<{
        categories?: Record<string, number>;
        category_scores?: Record<string, number>;
        flagged?: boolean;
      }>;
      flagged?: boolean;
      pii?: {
        detected?: boolean;
        items?: Array<{
          type: string;
          start: number;
          end: number;
          value?: string;
        }>;
      };
    };

    const categories: CategoryResult[] = [];
    let flagged = false;

    // Parse results array (newer API format)
    if (apiResponse.results && Array.isArray(apiResponse.results)) {
      for (const result of apiResponse.results) {
        if (result.flagged) {
          flagged = true;
        }

        // Parse category scores
        const scores = result.category_scores || result.categories || {};
        for (const [category, score] of Object.entries(scores)) {
          const normalizedCategory = this.normalizeCategory(category);
          const confidence = typeof score === 'number' ? score : 0;
          const detected = confidence > 0.5;

          if (detected) {
            flagged = true;
          }

          categories.push({
            category: normalizedCategory,
            detected,
            confidence,
          });
        }
      }
    }

    // Check top-level flagged status
    if (apiResponse.flagged) {
      flagged = true;
    }

    // Parse PII results
    let pii: PIIResult | undefined;
    if (apiResponse.pii) {
      const piiData = apiResponse.pii;
      const items = piiData.items || [];

      pii = {
        detected: piiData.detected ?? items.length > 0,
        count: items.length,
        types: [...new Set(items.map(item => this.normalizePIIType(item.type)))],
        positions: items.map(item => ({
          type: this.normalizePIIType(item.type),
          start: item.start,
          end: item.end,
          value: item.value,
        })),
      };

      if (pii.detected) {
        flagged = true;
        categories.push({
          category: 'pii',
          detected: true,
          confidence: 1.0,
          details: `${pii.count} PII items detected: ${pii.types.join(', ')}`,
        });
      }
    }

    return {
      flagged,
      categories,
      pii,
      rawResponse: data,
      latencyMs,
      requestId,
    };
  }

  /**
   * Normalize category name from API to our enum
   */
  private normalizeCategory(category: string): ThreatCategory {
    const normalized = category.toLowerCase().replace(/[^a-z]/g, '_');

    if (normalized.includes('injection') || normalized.includes('prompt')) {
      return 'prompt_injection';
    }
    if (normalized.includes('jailbreak')) {
      return 'jailbreak';
    }
    if (normalized.includes('pii') || normalized.includes('personal')) {
      return 'pii';
    }
    if (normalized.includes('content') || normalized.includes('moderation')) {
      return 'content_moderation';
    }

    return 'unknown';
  }

  /**
   * Normalize PII type from API to our enum
   */
  private normalizePIIType(type: string): import('./types').PIIType {
    const normalized = type.toLowerCase();

    if (normalized.includes('email')) return 'email';
    if (normalized.includes('phone')) return 'phone';
    if (normalized.includes('ssn') || normalized.includes('social')) return 'ssn';
    if (normalized.includes('credit') || normalized.includes('card')) return 'credit_card';
    if (normalized.includes('name')) return 'name';
    if (normalized.includes('address')) return 'address';
    if (normalized.includes('birth') || normalized.includes('dob')) return 'date_of_birth';
    if (normalized.includes('ip')) return 'ip_address';

    return 'other';
  }
}

// Singleton instance
let guardClient: LakeraGuardClient | null = null;

/**
 * Initialize the Lakera Guard client
 *
 * @param config - Client configuration (uses env vars if not provided)
 */
export function initLakeraGuard(config?: Partial<LakeraGuardClientConfig>): void {
  const apiKey = config?.apiKey ?? process.env.LAKERA_GUARD_API_KEY;

  if (!apiKey) {
    console.warn('Lakera Guard API key not configured - security screening disabled');
    return;
  }

  guardClient = new LakeraGuardClient({
    apiKey,
    projectId: config?.projectId ?? process.env.LAKERA_PROJECT_ID,
    timeoutMs: config?.timeoutMs,
    apiUrl: config?.apiUrl,
  });
}

/**
 * Get the Lakera Guard client instance
 */
export function getLakeraGuard(): LakeraGuardClient | null {
  return guardClient;
}

/**
 * Check if Lakera Guard is enabled
 */
export function isLakeraGuardEnabled(): boolean {
  return guardClient !== null;
}

/**
 * Screen content using the singleton client
 *
 * @param content - Content to screen
 * @returns Guard response or null if not enabled
 */
export async function screenContent(content: string): Promise<LakeraGuardResponse | null> {
  if (!guardClient) {
    return null;
  }

  return guardClient.screen(content);
}
