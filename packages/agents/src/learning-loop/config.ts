/**
 * Learning Loop Configuration
 *
 * Environment-based configuration loading for the Learning Loop agent.
 *
 * @module learning-loop/config
 */

import { DEFAULT_CONFIG, type LearningLoopConfig } from './types';

// ===========================================
// Environment Variable Names
// ===========================================

export const ENV_VARS = {
  // Context budget
  LEARNING_LOOP_CONTEXT_BUDGET: 'LEARNING_LOOP_CONTEXT_BUDGET',

  // Quality gates
  LEARNING_LOOP_CONFIDENCE_THRESHOLD: 'LEARNING_LOOP_CONFIDENCE_THRESHOLD',
  LEARNING_LOOP_DUPLICATE_THRESHOLD: 'LEARNING_LOOP_DUPLICATE_THRESHOLD',
  LEARNING_LOOP_AUTO_APPROVE_CONFIDENCE: 'LEARNING_LOOP_AUTO_APPROVE_CONFIDENCE',

  // Validation
  LEARNING_LOOP_REMINDER_HOURS: 'LEARNING_LOOP_REMINDER_HOURS',
  LEARNING_LOOP_MAX_REMINDERS: 'LEARNING_LOOP_MAX_REMINDERS',

  // Slack
  LEARNING_LOOP_VALIDATION_CHANNEL: 'LEARNING_LOOP_VALIDATION_CHANNEL',
  LEARNING_LOOP_SYNTHESIS_CHANNEL: 'LEARNING_LOOP_SYNTHESIS_CHANNEL',

  // Synthesis
  LEARNING_LOOP_SYNTHESIS_CRON: 'LEARNING_LOOP_SYNTHESIS_CRON',
  LEARNING_LOOP_SYNTHESIS_LOOKBACK_DAYS: 'LEARNING_LOOP_SYNTHESIS_LOOKBACK_DAYS',

  // Feature flags
  LEARNING_LOOP_AUTO_APPROVE_MEDIUM: 'LEARNING_LOOP_AUTO_APPROVE_MEDIUM',
  LEARNING_LOOP_TRACK_TEMPLATES: 'LEARNING_LOOP_TRACK_TEMPLATES',
  LEARNING_LOOP_SEND_SYNTHESIS: 'LEARNING_LOOP_SEND_SYNTHESIS',
  LEARNING_LOOP_ARCHIVE_INSIGHTS: 'LEARNING_LOOP_ARCHIVE_INSIGHTS',

  // External services
  QDRANT_URL: 'QDRANT_URL',
  QDRANT_API_KEY: 'QDRANT_API_KEY',
  UPSTASH_REDIS_REST_URL: 'UPSTASH_REDIS_REST_URL',
  UPSTASH_REDIS_REST_TOKEN: 'UPSTASH_REDIS_REST_TOKEN',
  SLACK_BOT_TOKEN: 'SLACK_BOT_TOKEN',
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  VOYAGE_API_KEY: 'VOYAGE_API_KEY',
  WEBHOOK_SECRET: 'WEBHOOK_SECRET',
} as const;

// ===========================================
// Environment Config Type
// ===========================================

export interface EnvConfig {
  // Qdrant
  qdrant_url: string;
  qdrant_api_key: string | undefined;

  // Upstash Redis
  redis_url: string;
  redis_token: string;

  // Slack
  slack_bot_token: string;

  // AI Services
  anthropic_api_key: string;
  voyage_api_key: string;

  // Webhook
  webhook_secret: string;
}

// ===========================================
// Config Loading Functions
// ===========================================

/**
 * Parse boolean from environment variable
 */
function parseEnvBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse number from environment variable
 */
function parseEnvNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse integer from environment variable
 */
function parseEnvInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Load Learning Loop configuration from environment
 */
export function loadConfig(overrides?: Partial<LearningLoopConfig>): LearningLoopConfig {
  const env = process.env;

  const config: LearningLoopConfig = {
    context_budget_tokens: parseEnvInt(
      env[ENV_VARS.LEARNING_LOOP_CONTEXT_BUDGET],
      DEFAULT_CONFIG.context_budget_tokens
    ),

    quality_gates: {
      confidence_threshold: parseEnvNumber(
        env[ENV_VARS.LEARNING_LOOP_CONFIDENCE_THRESHOLD],
        DEFAULT_CONFIG.quality_gates.confidence_threshold
      ),
      duplicate_similarity_threshold: parseEnvNumber(
        env[ENV_VARS.LEARNING_LOOP_DUPLICATE_THRESHOLD],
        DEFAULT_CONFIG.quality_gates.duplicate_similarity_threshold
      ),
      auto_approve_confidence: parseEnvNumber(
        env[ENV_VARS.LEARNING_LOOP_AUTO_APPROVE_CONFIDENCE],
        DEFAULT_CONFIG.quality_gates.auto_approve_confidence
      ),
    },

    validation: {
      reminder_hours: parseEnvInt(
        env[ENV_VARS.LEARNING_LOOP_REMINDER_HOURS],
        DEFAULT_CONFIG.validation.reminder_hours
      ),
      max_reminders: parseEnvInt(
        env[ENV_VARS.LEARNING_LOOP_MAX_REMINDERS],
        DEFAULT_CONFIG.validation.max_reminders
      ),
    },

    slack: {
      validation_channel:
        env[ENV_VARS.LEARNING_LOOP_VALIDATION_CHANNEL] ??
        DEFAULT_CONFIG.slack.validation_channel,
      synthesis_channel:
        env[ENV_VARS.LEARNING_LOOP_SYNTHESIS_CHANNEL] ??
        DEFAULT_CONFIG.slack.synthesis_channel,
    },

    synthesis: {
      schedule_cron:
        env[ENV_VARS.LEARNING_LOOP_SYNTHESIS_CRON] ?? DEFAULT_CONFIG.synthesis.schedule_cron,
      lookback_days: parseEnvInt(
        env[ENV_VARS.LEARNING_LOOP_SYNTHESIS_LOOKBACK_DAYS],
        DEFAULT_CONFIG.synthesis.lookback_days
      ),
    },

    features: {
      auto_approve_medium_importance: parseEnvBool(
        env[ENV_VARS.LEARNING_LOOP_AUTO_APPROVE_MEDIUM],
        DEFAULT_CONFIG.features.auto_approve_medium_importance
      ),
      track_template_performance: parseEnvBool(
        env[ENV_VARS.LEARNING_LOOP_TRACK_TEMPLATES],
        DEFAULT_CONFIG.features.track_template_performance
      ),
      send_weekly_synthesis: parseEnvBool(
        env[ENV_VARS.LEARNING_LOOP_SEND_SYNTHESIS],
        DEFAULT_CONFIG.features.send_weekly_synthesis
      ),
      archive_old_insights: parseEnvBool(
        env[ENV_VARS.LEARNING_LOOP_ARCHIVE_INSIGHTS],
        DEFAULT_CONFIG.features.archive_old_insights
      ),
    },
  };

  // Apply overrides
  if (overrides) {
    return mergeConfig(config, overrides);
  }

  return config;
}

/**
 * Load environment configuration for external services
 */
export function loadEnvConfig(): EnvConfig {
  const env = process.env;

  const qdrantUrl = env[ENV_VARS.QDRANT_URL];
  const redisUrl = env[ENV_VARS.UPSTASH_REDIS_REST_URL];
  const redisToken = env[ENV_VARS.UPSTASH_REDIS_REST_TOKEN];
  const slackToken = env[ENV_VARS.SLACK_BOT_TOKEN];
  const anthropicKey = env[ENV_VARS.ANTHROPIC_API_KEY];
  const voyageKey = env[ENV_VARS.VOYAGE_API_KEY];
  const webhookSecret = env[ENV_VARS.WEBHOOK_SECRET];

  // Validate required env vars
  const missing: string[] = [];
  if (!qdrantUrl) missing.push(ENV_VARS.QDRANT_URL);
  if (!redisUrl) missing.push(ENV_VARS.UPSTASH_REDIS_REST_URL);
  if (!redisToken) missing.push(ENV_VARS.UPSTASH_REDIS_REST_TOKEN);
  if (!slackToken) missing.push(ENV_VARS.SLACK_BOT_TOKEN);
  if (!anthropicKey) missing.push(ENV_VARS.ANTHROPIC_API_KEY);
  if (!voyageKey) missing.push(ENV_VARS.VOYAGE_API_KEY);
  if (!webhookSecret) missing.push(ENV_VARS.WEBHOOK_SECRET);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    qdrant_url: qdrantUrl!,
    qdrant_api_key: env[ENV_VARS.QDRANT_API_KEY],
    redis_url: redisUrl!,
    redis_token: redisToken!,
    slack_bot_token: slackToken!,
    anthropic_api_key: anthropicKey!,
    voyage_api_key: voyageKey!,
    webhook_secret: webhookSecret!,
  };
}

/**
 * Deep merge configuration objects
 */
function mergeConfig(
  base: LearningLoopConfig,
  overrides: Partial<LearningLoopConfig>
): LearningLoopConfig {
  return {
    context_budget_tokens: overrides.context_budget_tokens ?? base.context_budget_tokens,
    quality_gates: {
      ...base.quality_gates,
      ...overrides.quality_gates,
    },
    validation: {
      ...base.validation,
      ...overrides.validation,
    },
    slack: {
      ...base.slack,
      ...overrides.slack,
    },
    synthesis: {
      ...base.synthesis,
      ...overrides.synthesis,
    },
    features: {
      ...base.features,
      ...overrides.features,
    },
  };
}

/**
 * Validate configuration values
 */
export function validateConfig(config: LearningLoopConfig): string[] {
  const errors: string[] = [];

  // Validate context budget
  if (config.context_budget_tokens < 10000 || config.context_budget_tokens > 200000) {
    errors.push('context_budget_tokens must be between 10000 and 200000');
  }

  // Validate quality gate thresholds
  if (
    config.quality_gates.confidence_threshold < 0 ||
    config.quality_gates.confidence_threshold > 1
  ) {
    errors.push('confidence_threshold must be between 0 and 1');
  }

  if (
    config.quality_gates.duplicate_similarity_threshold < 0 ||
    config.quality_gates.duplicate_similarity_threshold > 1
  ) {
    errors.push('duplicate_similarity_threshold must be between 0 and 1');
  }

  if (
    config.quality_gates.auto_approve_confidence < 0 ||
    config.quality_gates.auto_approve_confidence > 1
  ) {
    errors.push('auto_approve_confidence must be between 0 and 1');
  }

  // Validate validation settings
  if (config.validation.reminder_hours < 1 || config.validation.reminder_hours > 168) {
    errors.push('reminder_hours must be between 1 and 168 (1 week)');
  }

  if (config.validation.max_reminders < 0 || config.validation.max_reminders > 10) {
    errors.push('max_reminders must be between 0 and 10');
  }

  // Validate synthesis settings
  if (config.synthesis.lookback_days < 1 || config.synthesis.lookback_days > 30) {
    errors.push('lookback_days must be between 1 and 30');
  }

  return errors;
}
