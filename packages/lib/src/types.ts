/**
 * Shared Types for Atlas GTM
 *
 * Core type definitions used across all packages.
 */

// ===========================================
// Embedding Types (from contracts/embedding-api.ts)
// ===========================================

/** Embedding configuration */
export interface EmbeddingConfig {
  model: 'voyage-3.5-lite';
  dimension: 1024;
  maxTokens: 8000;
}

/** Input type determines embedding optimization */
export type EmbeddingInputType = 'document' | 'query';

/** Result from embedding operation */
export interface EmbeddingResult {
  vector: number[];
  model: string;
  inputType: EmbeddingInputType;
  tokensUsed: number;
}

/** Error response from embedding operation */
export interface EmbeddingError {
  code: 'INVALID_INPUT' | 'API_ERROR' | 'RATE_LIMITED' | 'TOKEN_LIMIT_EXCEEDED';
  message: string;
  retryAfterMs?: number;
}

// ===========================================
// Brain Types
// ===========================================

/** Unique identifier for a brain (vertical-specific knowledge base) */
export type BrainId = string & { readonly __brand: 'BrainId' };

/** Brain status */
export type BrainStatus = 'active' | 'inactive' | 'deprecated';

/** Brain metadata */
export interface Brain {
  id: BrainId;
  vertical: string;
  name: string;
  status: BrainStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ===========================================
// Qdrant Collection Types
// ===========================================

/** Collection names in Qdrant */
export type CollectionName =
  | 'brains'
  | 'icp_rules'
  | 'response_templates'
  | 'objection_handlers'
  | 'market_research'
  | 'insights'
  | 'verticals';

/** Base payload for all Qdrant points */
export interface BasePayload {
  brain_id: BrainId;
  created_at: string;
  updated_at: string;
}

/** ICP Rule payload */
export interface IcpRulePayload extends BasePayload {
  vertical: string;
  category: string;
  rule_text: string;
  priority: number;
}

/** Response Template payload */
export interface ResponseTemplatePayload extends BasePayload {
  vertical: string;
  category: string;
  template_text: string;
  tone: string;
}

/** Objection Handler payload */
export interface ObjectionHandlerPayload extends BasePayload {
  vertical: string;
  category: string;
  objection_text: string;
  response_text: string;
}

/** Market Research payload */
export interface MarketResearchPayload extends BasePayload {
  vertical: string;
  category: string;
  content: string;
  source: string;
}

/** Insight validation status */
export type InsightValidationStatus = 'pending' | 'validated' | 'rejected';

/** Insight payload */
export interface InsightPayload extends BasePayload {
  vertical: string;
  category: string;
  content: string;
  importance: number;
  validation: {
    status: InsightValidationStatus;
    validatedAt?: string;
    validatedBy?: string;
  };
}

/** Vertical payload */
export interface VerticalPayload {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

// ===========================================
// Environment Types (from contracts/env-schema.ts)
// ===========================================

/** Required environment variables */
export const REQUIRED_ENV_VARS = [
  'QDRANT_API_KEY',
  'N8N_PASSWORD',
  'POSTGRES_PASSWORD',
  'VOYAGE_API_KEY',
] as const;

/** Optional environment variables with defaults */
export const OPTIONAL_ENV_VARS = [
  'QDRANT_URL',
  'N8N_USER',
  'N8N_WEBHOOK_URL',
  'POSTGRES_USER',
  'UPSTASH_REDIS_URL',
  'UPSTASH_REDIS_TOKEN',
  'ATTIO_API_KEY',
  'INSTANTLY_API_KEY',
  'TIMEZONE',
  'NODE_ENV',
  // Langfuse Observability
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_BASE_URL',
  'LANGFUSE_ENABLED',
] as const;

// ===========================================
// Lead Scorer Types
// ===========================================

/** Unique identifier for a lead */
export type LeadId = string & { readonly __brand: 'LeadId' };

/** Scoring tier assignment */
export type ScoringTier = 'priority' | 'qualified' | 'nurture' | 'disqualified';

/** Messaging angle recommendation */
export type MessagingAngle =
  | 'technical'
  | 'roi'
  | 'compliance'
  | 'speed'
  | 'integration';

/** Lead source tracking */
export type LeadSource =
  | 'clay'
  | 'linkedin'
  | 'referral'
  | 'website'
  | 'conference'
  | 'cold_outbound'
  | 'inbound'
  | 'partner';

/** Funding stage for firmographic scoring */
export type FundingStage =
  | 'pre_seed'
  | 'seed'
  | 'series_a'
  | 'series_b'
  | 'series_c'
  | 'series_d_plus'
  | 'public'
  | 'bootstrapped';

// ===========================================
// ICP Rule Types (for Lead Scorer)
// ===========================================

/** ICP Rule category */
export type RuleCategory =
  | 'firmographic'   // company_size, industry, revenue, funding_stage, location
  | 'technographic'  // tech_stack, tools_used, integrations
  | 'behavioral'     // hiring_signals, recent_news, content_engagement
  | 'intent';        // website_visits, content_downloads, keyword_searches

/** ICP Rule operator */
export type RuleOperator =
  | 'range'          // Numeric between min/max
  | 'equals'         // Exact match
  | 'contains'       // String contains
  | 'greater_than'   // Numeric >
  | 'less_than'      // Numeric <
  | 'in_list';       // Value in array

/** Rule condition types */
export type RuleCondition =
  | { type: 'range'; min: number; max: number }
  | { type: 'equals'; value: string | number | boolean }
  | { type: 'contains'; value: string }
  | { type: 'greater_than'; value: number }
  | { type: 'less_than'; value: number }
  | { type: 'in_list'; values: string[] };

/** ICP Rule from Qdrant */
export interface ICPRule {
  id: string;
  brain_id: BrainId;
  vertical: string;
  sub_vertical?: string;

  category: RuleCategory;
  attribute: string;
  display_name: string;

  condition: RuleCondition;
  operator: RuleOperator;

  score_weight: number;
  max_score: number;
  is_knockout: boolean;

  reasoning: string;
  source: 'market_research' | 'customer_feedback' | 'hypothesis';
  validated: boolean;
}
