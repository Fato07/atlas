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
  description?: string;
  config?: BrainConfig;
  stats?: BrainStats;
  createdAt: Date;
  updatedAt: Date;
}

/** Brain configuration settings */
export interface BrainConfig {
  /** Score thresholds for response tiers */
  default_tier_thresholds: {
    tier1: number;
    tier2: number;
    tier3: number;
  };
  /** Enable automatic responses for tier 1 */
  auto_response_enabled: boolean;
  /** Enable insight learning from conversations */
  learning_enabled: boolean;
  /** Minimum confidence for auto-responses */
  quality_gate_threshold: number;
}

/** Brain statistics */
export interface BrainStats {
  icp_rules_count: number;
  templates_count: number;
  handlers_count: number;
  research_docs_count: number;
  insights_count: number;
}

/** Options for getting a brain */
export interface GetBrainOptions {
  /** Specific brain ID to fetch */
  brainId?: BrainId;
  /** Fetch active brain by vertical name */
  vertical?: string;
}

/** Filters for listing brains */
export interface BrainFilters {
  /** Filter by status */
  status?: BrainStatus;
  /** Filter by vertical */
  vertical?: string;
}

/** Response template from KB */
export interface ResponseTemplate {
  id: string;
  reply_type: string;
  tier: number;
  template_text: string;
  variables: string[];
  personalization_instructions?: string;
}

/** Objection handler from KB */
export interface ObjectionHandler {
  id: string;
  objection_type: string;
  handler_strategy: string;
  handler_response: string;
  variables: string[];
  follow_up_actions: string[];
}

/** Filters for templates */
export interface TemplateFilters {
  /** Filter by reply type */
  replyType?: string;
  /** Filter by tier */
  tier?: number;
  /** Auto-send templates only */
  autoSendOnly?: boolean;
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

// ===========================================
// Vertical Types (Clay-Inspired Detection)
// ===========================================

/** Detection weight configuration for rule-based matching */
export interface VerticalDetectionWeights {
  /** Weight for industry keyword matches (0-1) */
  industry: number;
  /** Weight for title keyword matches (0-1) */
  title: number;
  /** Weight for campaign pattern matches (0-1) */
  campaign: number;
}

/**
 * Enhanced Vertical payload with Clay-inspired detection configuration
 *
 * Stores vertical definitions with rich detection configuration for
 * rule-based and AI-assisted classification.
 */
export interface VerticalPayload {
  /** Unique slug identifier (e.g., "defense", "fintech") */
  slug: string;
  /** Display name */
  name: string;
  /** Description for AI classification context */
  description: string;

  // Hierarchy support
  /** Parent vertical ID for hierarchy (e.g., aerospace → defense) */
  parent_id?: string;
  /** Hierarchy level (0=root, 1=child, etc.) */
  level: number;

  // Rule-based detection config (fast, deterministic)
  /** Industry keywords for matching (e.g., ["aerospace", "defense contractor"]) */
  industry_keywords: string[];
  /** Title keywords for matching (e.g., ["program manager", "contracting"]) */
  title_keywords: string[];
  /** Campaign ID patterns for matching (e.g., ["defense_*", "aero_*"]) */
  campaign_patterns: string[];
  /** Detection weights for rule-based matching */
  detection_weights: VerticalDetectionWeights;

  /** Aliases/synonyms (e.g., "fintech" = "financial technology") */
  aliases: string[];
  /** Exclusion keywords to prevent false positives */
  exclusion_keywords: string[];
  /** Confidence threshold to trigger AI fallback (default: 0.5) */
  ai_fallback_threshold: number;

  // Clay-style AI classification config
  /** Example companies for AI classification context */
  example_companies: string[];
  /** Custom AI prompt for this vertical (optional) */
  classification_prompt?: string;

  // Brain linkage
  /** Active brain ID for this vertical */
  default_brain_id?: string;

  // Metadata
  /** Whether this vertical is active for detection */
  is_active: boolean;
  created_at: string;
  updated_at: string;

  // Audit trail
  /** Version number, incremented on each update */
  version: number;
  /** User/system that made last change */
  last_modified_by?: string;
}

/** Vertical detection method used */
export type VerticalDetectionMethod =
  | 'explicit'      // Explicit vertical field provided
  | 'industry'      // Industry keyword match
  | 'title'         // Title keyword match
  | 'campaign'      // Campaign pattern match
  | 'ai'            // AI classification fallback
  | 'default';      // Default fallback

/** Result from vertical detection */
export interface VerticalDetectionResult {
  /** Detected vertical slug */
  vertical: string;
  /** Detection confidence (0-1) */
  confidence: number;
  /** Detection method used */
  method: VerticalDetectionMethod;
  /** All signals considered during detection */
  signals: VerticalDetectionSignal[];
  /** Reasoning for the detection (from AI if applicable) */
  reasoning?: string;
}

/** Signal used for vertical detection */
export interface VerticalDetectionSignal {
  /** Attribute that matched (e.g., "industry", "title") */
  attribute: string;
  /** Value from lead data */
  value: string;
  /** Matched vertical */
  matched_vertical: string;
  /** Signal weight/confidence */
  weight: number;
  /** Matched keyword or pattern */
  matched_keyword?: string;
}

/** Input for vertical detection */
export interface VerticalDetectionInput {
  /** Explicit vertical field (highest priority) */
  vertical?: string;
  /** Industry field from lead */
  industry?: string;
  /** Job title from lead */
  title?: string;
  /** Campaign ID for pattern matching */
  campaign_id?: string;
  /** Company name for AI context */
  company_name?: string;
}

/** Options for vertical detection */
export interface VerticalDetectionOptions {
  /** Enable AI fallback for ambiguous cases */
  enableAI?: boolean;
  /** Custom AI fallback threshold override */
  aiThreshold?: number;
  /** Force specific detection method */
  forceMethod?: VerticalDetectionMethod;
}

/** Detection index for O(1) keyword lookups */
export interface VerticalDetectionIndex {
  /** Map of industry keyword → vertical slug */
  industryToVertical: Map<string, string>;
  /** Map of title keyword → vertical slug */
  titleToVertical: Map<string, string>;
  /** Map of campaign pattern → vertical slug */
  campaignToVertical: Map<string, string>;
  /** Map of alias → vertical slug */
  aliasToVertical: Map<string, string>;
  /** Set of exclusion keywords per vertical */
  exclusions: Map<string, Set<string>>;
  /** Built timestamp */
  builtAt: Date;
}

/** AI classification result */
export interface AIClassificationResult {
  /** Classified vertical slug */
  vertical: string;
  /** Classification confidence (0-1) */
  confidence: number;
  /** AI reasoning for classification */
  reasoning: string;
  /** Model used for classification */
  model: string;
  /** Whether result was cached */
  cached: boolean;
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
