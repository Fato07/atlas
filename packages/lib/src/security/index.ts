/**
 * Security Module for Atlas GTM
 *
 * Provides Lakera Guard integration for prompt injection detection
 * and PII masking before LLM calls.
 *
 * @example
 * ```typescript
 * import {
 *   initLakeraGuard,
 *   screenBeforeLLM,
 *   screenWebhookInput,
 * } from '@atlas-gtm/lib/security';
 *
 * // Initialize on startup
 * initLakeraGuard();
 *
 * // Screen content before LLM call
 * const result = await screenBeforeLLM(promptContent, 'lead_scorer');
 * if (!result.passed) {
 *   console.error('Security check failed:', result.reason);
 *   return;
 * }
 *
 * // Use sanitized content if PII was masked
 * const safeContent = result.sanitizedContent ?? promptContent;
 * ```
 */

// Types
export type {
  ThreatCategory,
  ThreatAction,
  ThreatSeverity,
  CategoryResult,
  PIIResult,
  PIIType,
  PIIPosition,
  LakeraGuardResponse,
  SecurityScreeningResult,
  SecurityScreeningConfig,
  SecurityAuditEntry,
} from './types';

export { DEFAULT_SECURITY_CONFIG } from './types';

// Lakera Guard Client
export {
  LakeraGuardClient,
  type LakeraGuardClientConfig,
  initLakeraGuard,
  getLakeraGuard,
  isLakeraGuardEnabled,
  screenContent,
} from './lakera-guard';

// Security Middleware
export {
  SecurityMiddleware,
  getSecurityMiddleware,
  screenBeforeLLM,
  screenWebhookInput,
} from './security-middleware';

// Security Logger
export {
  type SecurityLogLevel,
  type SecurityLogEvent,
  type SecurityLoggerConfig,
  type SecurityMetrics,
  configureSecurityLogger,
  logSecurityEvent,
  logSecurityAlert,
  logSecurityMetric,
  trackSecurityMetrics,
  getSecurityMetrics,
  resetSecurityMetrics,
} from './security-logger';
