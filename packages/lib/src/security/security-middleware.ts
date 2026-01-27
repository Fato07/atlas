/**
 * Security Middleware
 *
 * Middleware wrapper for agents that provides security screening
 * before LLM calls and on incoming webhook data.
 */

import type {
  SecurityScreeningResult,
  SecurityScreeningConfig,
  ThreatAction,
  ThreatSeverity,
  PIIType,
  PIIPosition,
  LakeraGuardResponse,
  ResultSource,
} from './types';
import { DEFAULT_SECURITY_CONFIG, getLakeraDebugConfig } from './types';
import {
  getLakeraGuard,
  isLakeraGuardEnabled,
  screenContent,
} from './lakera-guard';
import { logSecurityEvent } from './security-logger';

/**
 * Simple in-memory cache for security screening results
 */
const screeningCache = new Map<string, { result: SecurityScreeningResult; expires: number }>();

/**
 * Generate cache key from content
 */
function getCacheKey(content: string): string {
  // Simple hash using string length and character codes
  let hash = content.length;
  for (let i = 0; i < Math.min(content.length, 100); i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return `security_${hash}_${content.length}`;
}

/**
 * Check if a cached result is still valid
 */
function getCachedResult(content: string, requestId: string): SecurityScreeningResult | null {
  const debugConfig = getLakeraDebugConfig();

  // Skip cache if disabled via env var
  if (debugConfig.disableCache) {
    console.log(JSON.stringify({
      event: 'security_cache_disabled',
      requestId,
      reason: 'LAKERA_DISABLE_CACHE=true',
      timestamp: new Date().toISOString(),
    }));
    return null;
  }

  const key = getCacheKey(content);
  const cached = screeningCache.get(key);

  if (cached && cached.expires > Date.now()) {
    const expiresInMs = cached.expires - Date.now();
    console.log(JSON.stringify({
      event: 'security_cache_hit',
      requestId,
      cacheKey: key,
      expiresInSeconds: Math.round(expiresInMs / 1000),
      originalResultSource: cached.result.resultSource,
      passed: cached.result.passed,
      timestamp: new Date().toISOString(),
    }));
    // Return cached result with updated source to indicate it came from cache
    return { ...cached.result, resultSource: 'cache' };
  }

  if (cached) {
    screeningCache.delete(key);
    console.log(JSON.stringify({
      event: 'security_cache_expired',
      requestId,
      cacheKey: key,
      timestamp: new Date().toISOString(),
    }));
  } else {
    console.log(JSON.stringify({
      event: 'security_cache_miss',
      requestId,
      cacheKey: key,
      timestamp: new Date().toISOString(),
    }));
  }

  return null;
}

/**
 * Cache a screening result
 */
function cacheResult(
  content: string,
  result: SecurityScreeningResult,
  ttlSeconds: number
): void {
  const key = getCacheKey(content);
  screeningCache.set(key, {
    result,
    expires: Date.now() + ttlSeconds * 1000,
  });

  // Clean up old entries periodically
  if (screeningCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of screeningCache.entries()) {
      if (v.expires < now) {
        screeningCache.delete(k);
      }
    }
  }
}

/**
 * Mask PII in content
 */
function maskPII(content: string, positions: PIIPosition[]): string {
  if (positions.length === 0) {
    return content;
  }

  // Sort positions by start index in descending order to avoid offset issues
  const sortedPositions = [...positions].sort((a, b) => b.start - a.start);

  let masked = content;
  for (const pos of sortedPositions) {
    const replacement = `[${pos.type.toUpperCase()}_REDACTED]`;
    masked = masked.slice(0, pos.start) + replacement + masked.slice(pos.end);
  }

  return masked;
}

/**
 * Determine severity based on threat category and confidence
 */
function determineSeverity(
  category: string,
  confidence: number
): ThreatSeverity {
  if (category === 'prompt_injection' || category === 'jailbreak') {
    return confidence > 0.9 ? 'critical' : confidence > 0.7 ? 'high' : 'medium';
  }
  if (category === 'pii') {
    return confidence > 0.9 ? 'high' : 'medium';
  }
  return confidence > 0.7 ? 'medium' : 'low';
}

/**
 * Security middleware for screening content before LLM calls
 */
export class SecurityMiddleware {
  private readonly config: SecurityScreeningConfig;

  constructor(config?: Partial<SecurityScreeningConfig>) {
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config };
  }

  /**
   * Screen content before sending to LLM
   *
   * @param content - Prompt content to screen
   * @param source - Source identifier for logging
   * @param requestId - Request ID for tracking
   * @returns Screening result with action and optionally sanitized content
   */
  async screenBeforeLLM(
    content: string,
    source: string = 'llm_call',
    requestId?: string
  ): Promise<SecurityScreeningResult> {
    const reqId = requestId ?? crypto.randomUUID();

    // Check cache first (cache function now handles requestId logging)
    const cached = getCachedResult(content, reqId);
    if (cached) {
      return cached;
    }

    // If Lakera Guard is not enabled, allow with warning
    if (!isLakeraGuardEnabled()) {
      const result: SecurityScreeningResult = {
        passed: true,
        action: 'allow',
        guardResponse: {
          flagged: false,
          categories: [],
          latencyMs: 0,
        },
        reason: 'Security screening disabled - Lakera Guard not configured',
        resultSource: 'guard_disabled',
      };

      logSecurityEvent({
        requestId: reqId,
        source,
        action: 'allow',
        passed: true,
        latencyMs: 0,
        metadata: { reason: 'guard_not_configured', resultSource: 'guard_disabled' },
      });

      // Log prominently that guard is disabled
      console.log(JSON.stringify({
        event: 'security_screening_skipped',
        requestId: reqId,
        source,
        reason: 'guard_not_configured',
        resultSource: 'guard_disabled',
        timestamp: new Date().toISOString(),
      }));

      return result;
    }

    try {
      const guardResponse = await screenContent(content);

      if (!guardResponse) {
        // Should not happen if isLakeraGuardEnabled is true, but handle gracefully
        return this.handleFailure(content, 'No response from guard', source, reqId);
      }

      return this.processResponse(guardResponse, content, source, reqId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.handleFailure(content, errorMessage, source, reqId);
    }
  }

  /**
   * Screen incoming webhook data
   *
   * @param data - Webhook payload to screen
   * @param source - Source identifier for logging
   * @param requestId - Request ID for tracking
   * @returns Screening result with optionally sanitized data
   */
  async screenWebhookInput(
    data: Record<string, unknown>,
    source: string = 'webhook',
    requestId?: string
  ): Promise<SecurityScreeningResult & { sanitizedData?: Record<string, unknown> }> {
    const reqId = requestId ?? crypto.randomUUID();

    // Convert data to string for screening
    const content = JSON.stringify(data);

    // Screen the content
    const result = await this.screenBeforeLLM(content, source, reqId);

    // If content was sanitized, parse it back to object
    if (result.sanitizedContent) {
      try {
        const sanitizedData = JSON.parse(result.sanitizedContent) as Record<string, unknown>;
        return { ...result, sanitizedData };
      } catch {
        // If parsing fails, return original result
        return result;
      }
    }

    return result;
  }

  /**
   * Process guard response and determine action
   */
  private processResponse(
    guardResponse: LakeraGuardResponse,
    content: string,
    source: string,
    requestId: string
  ): SecurityScreeningResult {
    let action: ThreatAction = 'allow';
    let threatCategory: string | undefined;
    let severity: ThreatSeverity | undefined;
    let sanitizedContent: string | undefined;
    let reason: string | undefined;

    // Check for prompt injection
    const injectionResult = guardResponse.categories.find(
      c => c.category === 'prompt_injection' && c.detected
    );
    if (injectionResult && this.config.detectPromptInjection) {
      action = this.config.onPromptInjection;
      threatCategory = 'prompt_injection';
      severity = determineSeverity('prompt_injection', injectionResult.confidence);
      reason = `Prompt injection detected (confidence: ${(injectionResult.confidence * 100).toFixed(1)}%)`;
    }

    // Check for jailbreak
    const jailbreakResult = guardResponse.categories.find(
      c => c.category === 'jailbreak' && c.detected
    );
    if (jailbreakResult && !threatCategory) {
      action = this.config.onJailbreak;
      threatCategory = 'jailbreak';
      severity = determineSeverity('jailbreak', jailbreakResult.confidence);
      reason = `Jailbreak attempt detected (confidence: ${(jailbreakResult.confidence * 100).toFixed(1)}%)`;
    }

    // Check for content moderation issues
    const contentResult = guardResponse.categories.find(
      c => c.category === 'content_moderation' && c.detected
    );
    if (contentResult && !threatCategory) {
      action = this.config.onContentViolation;
      threatCategory = 'content_moderation';
      severity = determineSeverity('content_moderation', contentResult.confidence);
      reason = `Content moderation issue detected`;
    }

    // Check for PII
    if (guardResponse.pii?.detected && this.config.detectPII) {
      // PII is handled separately - may mask instead of block
      if (!threatCategory || this.config.onPII !== 'block') {
        if (this.config.onPII === 'mask') {
          sanitizedContent = maskPII(content, guardResponse.pii.positions);
          if (!threatCategory) {
            action = 'mask';
            threatCategory = 'pii';
            severity = 'medium';
            reason = `${guardResponse.pii.count} PII items masked: ${guardResponse.pii.types.join(', ')}`;
          }
        } else if (this.config.onPII === 'block' && !threatCategory) {
          action = 'block';
          threatCategory = 'pii';
          severity = 'high';
          reason = `PII detected and blocked: ${guardResponse.pii.types.join(', ')}`;
        }
      }
    }

    const passed = action !== 'block';

    const result: SecurityScreeningResult = {
      passed,
      action,
      threatCategory: threatCategory as import('./types').ThreatCategory | undefined,
      severity,
      sanitizedContent,
      guardResponse,
      reason,
      resultSource: 'api',
    };

    // Log the security event with result source
    logSecurityEvent({
      requestId,
      source,
      action,
      threatCategory: threatCategory as import('./types').ThreatCategory | undefined,
      severity,
      piiCount: guardResponse.pii?.count,
      piiTypes: guardResponse.pii?.types,
      latencyMs: guardResponse.latencyMs,
      passed,
      metadata: {
        flagged: guardResponse.flagged,
        categories: guardResponse.categories.filter(c => c.detected).map(c => c.category),
        resultSource: 'api',
      },
    });

    // Log successful API screening
    console.log(JSON.stringify({
      event: 'security_screening_complete',
      requestId,
      source,
      resultSource: 'api',
      passed,
      action,
      threatCategory: threatCategory ?? null,
      severity: severity ?? null,
      latencyMs: guardResponse.latencyMs,
      timestamp: new Date().toISOString(),
    }));

    // Cache the result
    cacheResult(content, result, this.config.cacheTTLSeconds);

    return result;
  }

  /**
   * Handle screening failure (API error, timeout, etc.)
   */
  private handleFailure(
    content: string,
    errorMessage: string,
    source: string,
    requestId: string
  ): SecurityScreeningResult {
    const action: ThreatAction = this.config.failOpen ? 'allow' : 'block';
    const passed = this.config.failOpen;
    const failMode = this.config.failOpen ? 'FAIL_OPEN' : 'FAIL_CLOSED';

    const result: SecurityScreeningResult = {
      passed,
      action,
      guardResponse: {
        flagged: false,
        categories: [],
        latencyMs: 0,
      },
      reason: `Security screening error: ${errorMessage}. ${this.config.failOpen ? 'Failing open.' : 'Failing closed.'}`,
      resultSource: 'api_error',
    };

    // Log the failure with high visibility
    logSecurityEvent({
      requestId,
      source,
      action,
      passed,
      latencyMs: 0,
      metadata: {
        error: errorMessage,
        failOpen: this.config.failOpen,
        resultSource: 'api_error',
      },
    });

    // CRITICAL: Make failures highly visible in logs
    console.error(JSON.stringify({
      event: 'security_screening_failure',
      level: 'error',
      requestId,
      source,
      error: errorMessage,
      failMode,
      action,
      passed,
      resultSource: 'api_error',
      message: `Security screening FAILED - ${failMode}: ${errorMessage}`,
      timestamp: new Date().toISOString(),
    }));

    // Additional warning for fail-open mode
    if (this.config.failOpen) {
      console.warn(JSON.stringify({
        event: 'security_fail_open_warning',
        level: 'warn',
        requestId,
        source,
        message: 'Security screening failed but request ALLOWED due to failOpen=true. This may expose system to unscreened content.',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }));
    }

    return result;
  }
}

// Default middleware instance
let defaultMiddleware: SecurityMiddleware | null = null;

/**
 * Get or create the default security middleware
 */
export function getSecurityMiddleware(
  config?: Partial<SecurityScreeningConfig>
): SecurityMiddleware {
  if (!defaultMiddleware || config) {
    defaultMiddleware = new SecurityMiddleware(config);
  }
  return defaultMiddleware;
}

/**
 * Screen content before LLM call using default middleware
 */
export async function screenBeforeLLM(
  content: string,
  source?: string,
  requestId?: string
): Promise<SecurityScreeningResult> {
  return getSecurityMiddleware().screenBeforeLLM(content, source, requestId);
}

/**
 * Screen webhook input using default middleware
 */
export async function screenWebhookInput(
  data: Record<string, unknown>,
  source?: string,
  requestId?: string
): Promise<SecurityScreeningResult & { sanitizedData?: Record<string, unknown> }> {
  return getSecurityMiddleware().screenWebhookInput(data, source, requestId);
}
