/**
 * Security Logger
 *
 * Structured JSON logging for security events and audit trails.
 */

import type {
  SecurityAuditEntry,
  ThreatAction,
  ThreatCategory,
  ThreatSeverity,
  PIIType,
} from './types';

/**
 * Security log levels
 */
export type SecurityLogLevel = 'info' | 'warn' | 'error' | 'critical';

/**
 * Security event to log
 */
export interface SecurityLogEvent {
  requestId: string;
  source: string;
  action: ThreatAction;
  threatCategory?: ThreatCategory;
  severity?: ThreatSeverity;
  piiCount?: number;
  piiTypes?: PIIType[];
  latencyMs: number;
  passed: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Determine log level based on action and severity
 */
function getLogLevel(action: ThreatAction, severity?: ThreatSeverity): SecurityLogLevel {
  if (action === 'block') {
    return severity === 'critical' ? 'critical' : 'error';
  }
  if (action === 'warn' || severity === 'medium') {
    return 'warn';
  }
  return 'info';
}

/**
 * Format security event as structured log entry
 */
function formatLogEntry(event: SecurityLogEvent): SecurityAuditEntry {
  return {
    timestamp: new Date().toISOString(),
    requestId: event.requestId,
    source: event.source,
    action: event.action,
    threatCategory: event.threatCategory,
    severity: event.severity,
    piiCount: event.piiCount,
    piiTypes: event.piiTypes,
    latencyMs: event.latencyMs,
    passed: event.passed,
    metadata: event.metadata,
  };
}

/**
 * Security logger configuration
 */
export interface SecurityLoggerConfig {
  /**
   * Whether to output logs to console
   * @default true
   */
  consoleOutput: boolean;

  /**
   * Minimum log level to output
   * @default 'info'
   */
  minLevel: SecurityLogLevel;

  /**
   * Custom log handler for integration with external systems
   */
  customHandler?: (entry: SecurityAuditEntry, level: SecurityLogLevel) => void;

  /**
   * Whether to include metadata in logs
   * @default true
   */
  includeMetadata: boolean;
}

const LOG_LEVELS: Record<SecurityLogLevel, number> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

// Default configuration
let loggerConfig: SecurityLoggerConfig = {
  consoleOutput: true,
  minLevel: 'info',
  includeMetadata: true,
};

/**
 * Configure the security logger
 */
export function configureSecurityLogger(config: Partial<SecurityLoggerConfig>): void {
  loggerConfig = { ...loggerConfig, ...config };
}

/**
 * Log a security event
 */
export function logSecurityEvent(event: SecurityLogEvent): void {
  const level = getLogLevel(event.action, event.severity);
  const entry = formatLogEntry(event);

  // Check if we should log at this level
  if (LOG_LEVELS[level] < LOG_LEVELS[loggerConfig.minLevel]) {
    return;
  }

  // Remove metadata if configured to exclude
  const logEntry = loggerConfig.includeMetadata
    ? entry
    : { ...entry, metadata: undefined };

  // Output to console if configured
  if (loggerConfig.consoleOutput) {
    const logData = {
      event: 'security_screening',
      level,
      ...logEntry,
    };

    // Use appropriate console method based on level
    switch (level) {
      case 'critical':
      case 'error':
        console.error(JSON.stringify(logData));
        break;
      case 'warn':
        console.warn(JSON.stringify(logData));
        break;
      default:
        console.log(JSON.stringify(logData));
    }
  }

  // Call custom handler if configured
  if (loggerConfig.customHandler) {
    loggerConfig.customHandler(entry, level);
  }
}

/**
 * Log a security alert (high priority)
 */
export function logSecurityAlert(
  message: string,
  requestId: string,
  source: string,
  metadata?: Record<string, unknown>
): void {
  logSecurityEvent({
    requestId,
    source,
    action: 'block',
    severity: 'critical',
    latencyMs: 0,
    passed: false,
    metadata: {
      ...metadata,
      alertMessage: message,
    },
  });
}

/**
 * Log a security metric
 */
export function logSecurityMetric(
  metric: string,
  value: number,
  requestId: string,
  source: string
): void {
  if (!loggerConfig.consoleOutput) {
    return;
  }

  const logData = {
    event: 'security_metric',
    timestamp: new Date().toISOString(),
    requestId,
    source,
    metric,
    value,
  };

  console.log(JSON.stringify(logData));
}

/**
 * Get security event counts (for monitoring)
 */
export interface SecurityMetrics {
  totalScreened: number;
  blocked: number;
  masked: number;
  warned: number;
  allowed: number;
  errors: number;
  avgLatencyMs: number;
  threatsByCategory: Record<string, number>;
}

// In-memory metrics (for simple monitoring)
let metrics: SecurityMetrics = {
  totalScreened: 0,
  blocked: 0,
  masked: 0,
  warned: 0,
  allowed: 0,
  errors: 0,
  avgLatencyMs: 0,
  threatsByCategory: {},
};

let totalLatency = 0;

/**
 * Track security metrics
 */
export function trackSecurityMetrics(event: SecurityLogEvent): void {
  metrics.totalScreened++;

  switch (event.action) {
    case 'block':
      metrics.blocked++;
      break;
    case 'mask':
      metrics.masked++;
      break;
    case 'warn':
      metrics.warned++;
      break;
    case 'allow':
      metrics.allowed++;
      break;
  }

  if (event.threatCategory) {
    metrics.threatsByCategory[event.threatCategory] =
      (metrics.threatsByCategory[event.threatCategory] || 0) + 1;
  }

  if (event.metadata?.error) {
    metrics.errors++;
  }

  totalLatency += event.latencyMs;
  metrics.avgLatencyMs = totalLatency / metrics.totalScreened;
}

/**
 * Get current security metrics
 */
export function getSecurityMetrics(): SecurityMetrics {
  return { ...metrics };
}

/**
 * Reset security metrics
 */
export function resetSecurityMetrics(): void {
  metrics = {
    totalScreened: 0,
    blocked: 0,
    masked: 0,
    warned: 0,
    allowed: 0,
    errors: 0,
    avgLatencyMs: 0,
    threatsByCategory: {},
  };
  totalLatency = 0;
}
