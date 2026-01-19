/**
 * Lakera Guard Security Types
 *
 * TypeScript types for Lakera Guard API and security middleware.
 */

/**
 * Categories of threats detected by Lakera Guard
 */
export type ThreatCategory =
  | 'prompt_injection'
  | 'jailbreak'
  | 'pii'
  | 'content_moderation'
  | 'unknown';

/**
 * Actions to take when a threat is detected
 */
export type ThreatAction = 'block' | 'mask' | 'warn' | 'allow';

/**
 * Severity levels for detected threats
 */
export type ThreatSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Result from a single category check
 */
export interface CategoryResult {
  category: ThreatCategory;
  detected: boolean;
  confidence: number;
  details?: string;
}

/**
 * PII detection result
 */
export interface PIIResult {
  detected: boolean;
  count: number;
  types: PIIType[];
  positions: PIIPosition[];
}

/**
 * Types of PII that can be detected
 */
export type PIIType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'name'
  | 'address'
  | 'date_of_birth'
  | 'ip_address'
  | 'other';

/**
 * Position of detected PII in text
 */
export interface PIIPosition {
  type: PIIType;
  start: number;
  end: number;
  value?: string; // Original value (only in debug mode)
}

/**
 * Complete response from Lakera Guard API
 */
export interface LakeraGuardResponse {
  /**
   * Whether any threat was detected
   */
  flagged: boolean;

  /**
   * Individual category results
   */
  categories: CategoryResult[];

  /**
   * PII detection results
   */
  pii?: PIIResult;

  /**
   * Raw API response payload
   */
  rawResponse?: unknown;

  /**
   * Response latency in milliseconds
   */
  latencyMs: number;

  /**
   * Request ID for tracking
   */
  requestId?: string;
}

/**
 * Security screening result with action
 */
export interface SecurityScreeningResult {
  /**
   * Whether the content passed screening
   */
  passed: boolean;

  /**
   * Action taken based on screening
   */
  action: ThreatAction;

  /**
   * Threat category if detected
   */
  threatCategory?: ThreatCategory;

  /**
   * Threat severity if detected
   */
  severity?: ThreatSeverity;

  /**
   * Modified content (if masking was applied)
   */
  sanitizedContent?: string;

  /**
   * Original response from Lakera Guard
   */
  guardResponse: LakeraGuardResponse;

  /**
   * Human-readable reason for the action
   */
  reason?: string;
}

/**
 * Configuration for security screening behavior
 */
export interface SecurityScreeningConfig {
  /**
   * Action to take on prompt injection detection
   * @default 'block'
   */
  onPromptInjection: ThreatAction;

  /**
   * Action to take on jailbreak detection
   * @default 'block'
   */
  onJailbreak: ThreatAction;

  /**
   * Action to take on PII detection
   * @default 'mask'
   */
  onPII: ThreatAction;

  /**
   * Action to take on content moderation issues
   * @default 'warn'
   */
  onContentViolation: ThreatAction;

  /**
   * Whether to fail open (allow) when Lakera API is unavailable
   * @default true
   */
  failOpen: boolean;

  /**
   * Whether to enable PII detection
   * @default true
   */
  detectPII: boolean;

  /**
   * Whether to enable prompt injection detection
   * @default true
   */
  detectPromptInjection: boolean;

  /**
   * Cache TTL in seconds for identical content
   * @default 60
   */
  cacheTTLSeconds: number;

  /**
   * Request timeout in milliseconds
   * @default 5000
   */
  timeoutMs: number;
}

/**
 * Security audit log entry
 */
export interface SecurityAuditEntry {
  /**
   * Timestamp of the event
   */
  timestamp: string;

  /**
   * Unique request identifier
   */
  requestId: string;

  /**
   * Source of the content (webhook, agent, etc.)
   */
  source: string;

  /**
   * Action taken
   */
  action: ThreatAction;

  /**
   * Threat category if detected
   */
  threatCategory?: ThreatCategory;

  /**
   * Severity level
   */
  severity?: ThreatSeverity;

  /**
   * Number of PII items detected
   */
  piiCount?: number;

  /**
   * Types of PII detected
   */
  piiTypes?: PIIType[];

  /**
   * Screening latency in milliseconds
   */
  latencyMs: number;

  /**
   * Whether the content passed screening
   */
  passed: boolean;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Default security screening configuration
 */
export const DEFAULT_SECURITY_CONFIG: SecurityScreeningConfig = {
  onPromptInjection: 'block',
  onJailbreak: 'block',
  onPII: 'mask',
  onContentViolation: 'warn',
  failOpen: true,
  detectPII: true,
  detectPromptInjection: true,
  cacheTTLSeconds: 60,
  timeoutMs: 5000,
};
