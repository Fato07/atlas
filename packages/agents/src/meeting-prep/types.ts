/**
 * Meeting Prep Agent - Internal Types
 *
 * Internal type definitions for the meeting prep agent.
 * These types are not exported publicly and are used within the module.
 *
 * @module meeting-prep/types
 */

import type { BrainId } from '@atlas-gtm/lib';
import type { BriefStatus, BriefContent } from './contracts/brief';
import type { MeetingAnalysis } from './contracts/meeting-analysis';

// ===========================================
// Agent Configuration
// ===========================================

/**
 * Meeting prep agent configuration
 */
export interface MeetingPrepConfig {
  // Context limits (FR-012)
  context_budget_tokens: number; // Default: 100000
  sub_agent_budget_tokens: number; // Default: 25000

  // Timing configuration
  timing: {
    brief_trigger_minutes: number; // Default: 30 (minutes before meeting)
    research_cache_ttl_hours: number; // Default: 24
  };

  // Slack configuration (FR-011)
  slack: {
    brief_channel: string;
    escalation_channel: string;
  };

  // Retry configuration (FR-016)
  retry: {
    max_attempts: number; // Default: 3
    backoff_ms: number[]; // Default: [1000, 5000, 30000]
  };

  // Feature flags
  features: {
    cache_company_research: boolean;
    extract_insights: boolean;
    auto_create_crm_tasks: boolean;
  };
}

/**
 * Default agent configuration
 */
export const DEFAULT_CONFIG: MeetingPrepConfig = {
  context_budget_tokens: 100000,
  sub_agent_budget_tokens: 25000,
  timing: {
    brief_trigger_minutes: 30,
    research_cache_ttl_hours: 24,
  },
  slack: {
    brief_channel: 'meeting-briefs',
    escalation_channel: 'meeting-escalations',
  },
  retry: {
    max_attempts: 3,
    backoff_ms: [1000, 5000, 30000],
  },
  features: {
    cache_company_research: true,
    extract_insights: true,
    auto_create_crm_tasks: true,
  },
};

// ===========================================
// Session State Types
// ===========================================

/**
 * Upcoming meeting entry
 */
export interface UpcomingMeeting {
  meeting_id: string;
  start_time: string;
  primary_attendee_email: string;
  brief_status: BriefStatus;
  brief_id: string | null;
}

/**
 * Brief queue entry
 */
export interface BriefQueueEntry {
  meeting_id: string;
  queued_at: string;
  priority: number; // Lower = higher priority
}

/**
 * Analysis queue entry
 */
export interface AnalysisQueueEntry {
  meeting_id: string;
  transcript_received_at: string;
  queued_at: string;
}

/**
 * Recent brief summary
 */
export interface RecentBrief {
  brief_id: string;
  meeting_id: string;
  delivered_at: string;
  processing_time_ms: number;
}

/**
 * Recent analysis summary
 */
export interface RecentAnalysis {
  analysis_id: string;
  meeting_id: string;
  analyzed_at: string;
  bant_score: number;
  recommendation: string;
}

/**
 * Session error record
 */
export interface SessionError {
  timestamp: string;
  operation: 'brief_generation' | 'analysis' | 'crm_update' | 'slack_delivery';
  meeting_id: string;
  error_code: string;
  message: string;
  retry_count: number;
}

/**
 * Session metrics
 */
/** Success rate tracking for a sub-agent source (T040) */
export interface SubAgentSuccessRate {
  attempts: number;
  successes: number;
  failures: number;
  timeouts: number;
  /** Calculated success rate (0-1) */
  rate: number;
}

export interface SessionMetrics {
  briefs_generated: number;
  briefs_delivered: number;
  briefs_failed: number;
  analyses_completed: number;
  avg_brief_time_ms: number;
  avg_analysis_time_ms: number;

  // T040: Context gathering performance metrics
  /** Average context gathering time in milliseconds */
  avg_context_gather_ms: number;
  /** Total context gather operations */
  context_gather_count: number;

  /** Cache hit rate (0-1) for research cache */
  cache_hit_rate: number;
  /** Total cache lookups */
  cache_lookups: number;
  /** Total cache hits */
  cache_hits: number;

  /** Success rates per sub-agent source */
  sub_agent_success_rates: {
    instantly: SubAgentSuccessRate;
    airtable: SubAgentSuccessRate;
    attio: SubAgentSuccessRate;
    kb: SubAgentSuccessRate;
  };
}

/**
 * Meeting prep session state
 * Persisted to state/meeting-prep-state.json
 */
export interface MeetingPrepState {
  // Session Identity
  session_id: string;
  brain_id: BrainId;
  started_at: string;
  checkpoint_at: string;

  // Upcoming Meetings
  upcoming_meetings: UpcomingMeeting[];

  // Brief Queue
  brief_queue: BriefQueueEntry[];

  // Analysis Queue
  analysis_queue: AnalysisQueueEntry[];

  // Recent Briefs (last 20)
  recent_briefs: RecentBrief[];

  // Recent Analyses (last 20)
  recent_analyses: RecentAnalysis[];

  // Error Log
  errors: SessionError[];

  // Metrics (for observability)
  metrics: SessionMetrics;
}

// ===========================================
// Context Gathering Types
// ===========================================

/**
 * Gathered context for brief generation
 */
export interface GatheredContext {
  // Lead Information
  lead: {
    email: string;
    name: string | null;
    company: string | null;
    title: string | null;
    industry: string | null;
    icp_score: number | null;
    vertical: string | null;
  };

  // Conversation History
  conversation_history: Array<{
    date: string;
    channel: 'email' | 'linkedin' | 'call' | 'meeting' | 'slack';
    summary: string;
    sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
  }>;

  // Company Research
  company_intel: {
    industry: string;
    size: string;
    funding_stage: string | null;
    recent_news: string[];
    tech_stack: string[];
    key_people: Array<{
      name: string;
      title: string;
      relevance: string;
    }>;
  } | null;

  // KB Context
  kb_context: {
    objection_handlers: Array<{
      id: string;
      objection: string;
      response: string;
      confidence: number;
    }>;
    similar_deals: Array<{
      company: string;
      industry: string;
      why_won: string;
      relevance_score: number;
    }>;
    icp_rules: Array<{
      dimension: string;
      rule: string;
    }>;
  };

  // Metadata
  gathered_at: string;
  gathering_duration_ms: number;

  // Data availability - which sources were missing/failed (T039)
  missing_sources: Array<{
    source: 'instantly' | 'airtable' | 'attio' | 'kb';
    reason: 'timeout' | 'error' | 'not_found' | 'unavailable';
    message?: string;
  }>;
}

// ===========================================
// Research Cache Types
// ===========================================

/**
 * Cached company research
 */
export interface ResearchCache {
  // Identity
  cache_key: string; // company:${company_name}
  company_name: string;

  // Cached Data
  research_data: {
    company_overview: string;
    industry: string;
    size_estimate: string;
    funding_info: string | null;
    recent_news: string[];
    tech_stack: string[];
    key_people: Array<{
      name: string;
      title: string;
    }>;
    social_presence: {
      linkedin_url: string | null;
      twitter_url: string | null;
    };
  };

  // Cache Control
  fetched_at: string;
  ttl_hours: number;
  expires_at: string;

  // Source Tracking
  sources_used: string[];
}

// ===========================================
// Insight Types
// ===========================================

/**
 * Insight category
 */
export type InsightCategory =
  | 'objection_pattern' // New objection type discovered
  | 'pain_point' // Common pain point
  | 'buying_signal' // Positive buying indicator
  | 'competitive_positioning' // How competitors are positioned
  | 'industry_trend' // Vertical-specific trend
  | 'persona_insight'; // Persona-specific behavior

/**
 * Extracted insight for KB
 */
export interface ExtractedInsight {
  // Identity
  insight_id: string;
  brain_id: BrainId;

  // Source
  source_type: 'meeting_analysis' | 'objection_pattern' | 'competitive_intel';
  source_meeting_id: string;
  source_company: string;

  // Content
  category: InsightCategory;
  title: string;
  description: string;
  evidence: string[];

  // Quality
  confidence: number; // 0.0 to 1.0
  validated: boolean;
  validation_notes: string | null;

  // Vector Storage
  embedding: number[] | null;
  qdrant_point_id: string | null;

  // Metadata
  created_at: string;
  updated_at: string;
  created_by: 'meeting_prep_agent';
}

// ===========================================
// Processing Result Types
// ===========================================

/**
 * Brief generation result
 */
export interface BriefGenerationResult {
  success: boolean;
  brief_id: string;
  meeting_id: string;
  status: BriefStatus;
  content: BriefContent | null;
  slack_message_ts: string | null;
  processing_time_ms: number;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Analysis result
 */
export interface AnalysisResult {
  success: boolean;
  analysis_id: string;
  meeting_id: string;
  analysis: MeetingAnalysis | null;
  crm_updated: boolean;
  tasks_created: number;
  processing_time_ms: number;
  error?: {
    code: string;
    message: string;
  };
}

// ===========================================
// Logging Event Types (FR-015)
// ===========================================

/**
 * Log event types per FR-015
 */
export type LogEventType =
  | 'brief_requested'
  | 'context_gathered'
  | 'brief_generated'
  | 'brief_delivered'
  | 'brief_failed'
  | 'analysis_requested'
  | 'analysis_failed'
  | 'analysis_completed'
  | 'crm_updated';

/**
 * Base log event fields
 */
export interface BaseLogEvent {
  event: LogEventType;
  timestamp: string;
  meeting_id: string;
  brain_id: string;
  brief_id?: string;
  analysis_id?: string;
}

/**
 * Brief requested event
 */
export interface BriefRequestedEvent extends BaseLogEvent {
  event: 'brief_requested';
  source: 'calendar_webhook' | 'manual_request';
  attendee_email: string;
  meeting_start: string;
}

/**
 * Context gathered event
 */
export interface ContextGatheredEvent extends BaseLogEvent {
  event: 'context_gathered';
  brief_id: string;
  sources_used: string[];
  duration_ms: number;
  cache_hit: boolean;
}

/**
 * Brief generated event
 */
export interface BriefGeneratedEvent extends BaseLogEvent {
  event: 'brief_generated';
  brief_id: string;
  sections_generated: string[];
  tokens_used: number;
  duration_ms: number;
}

/**
 * Brief delivered event
 */
export interface BriefDeliveredEvent extends BaseLogEvent {
  event: 'brief_delivered';
  brief_id: string;
  slack_channel: string;
  slack_message_ts: string;
  total_processing_ms: number;
}

/**
 * Brief failed event
 */
export interface BriefFailedEvent extends BaseLogEvent {
  event: 'brief_failed';
  brief_id?: string;
  error_code: string;
  error_message: string;
  retry_count: number;
  recoverable: boolean;
}

/**
 * Analysis requested event
 */
export interface AnalysisRequestedEvent extends BaseLogEvent {
  event: 'analysis_requested';
  transcript_source: 'fireflies' | 'otter' | 'manual' | 'slack_form';
  transcript_length: number;
}

/**
 * Analysis failed event
 */
export interface AnalysisFailedEvent extends BaseLogEvent {
  event: 'analysis_failed';
  error_code: string;
  error_message: string;
  retry_count: number;
  recoverable: boolean;
}

/**
 * Analysis completed event
 */
export interface AnalysisCompletedEvent extends BaseLogEvent {
  event: 'analysis_completed';
  analysis_id: string;
  bant_score: number;
  recommendation: 'hot' | 'warm' | 'nurture' | 'disqualify';
  objections_count: number;
  action_items_count: number;
  duration_ms: number;
}

/**
 * CRM updated event
 */
export interface CRMUpdatedEvent extends BaseLogEvent {
  event: 'crm_updated';
  analysis_id: string;
  attio_updated: boolean;
  attio_tasks_created: number;
  airtable_updated: boolean;
  pipeline_stage?: string;
}

/**
 * Union of all log events
 */
export type LogEvent =
  | BriefRequestedEvent
  | ContextGatheredEvent
  | BriefGeneratedEvent
  | BriefDeliveredEvent
  | BriefFailedEvent
  | AnalysisRequestedEvent
  | AnalysisFailedEvent
  | AnalysisCompletedEvent
  | CRMUpdatedEvent;
