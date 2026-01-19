/**
 * Reply Handler Agent - Internal Types
 *
 * Internal type definitions for the reply handler agent.
 * These types are not exported publicly and are used within the module.
 *
 * @module reply-handler/types
 */

import type { Classification, KBMatch, TierRouting, ExtractedInsight } from './contracts/handler-result';
import type { LeadContext, ReplyInput, ThreadMessage } from './contracts/reply-input';

// ===========================================
// Reply Processing Status
// ===========================================

export type ReplyStatus =
  | 'pending'           // Awaiting processing
  | 'processing'        // Currently being handled
  | 'completed'         // Successfully processed
  | 'failed'            // Processing failed
  | 'dead_lettered';    // Moved to dead letter queue

// ===========================================
// Draft Types
// ===========================================

export type DraftStatus =
  | 'pending'           // Awaiting action
  | 'approved'          // Approved and sent
  | 'approved_edited'   // Approved with modifications
  | 'rejected'          // Rejected by user
  | 'escalated'         // Escalated to Tier 3
  | 'expired';          // Timed out (30 min)

/**
 * A pending response awaiting approval (Tier 2)
 */
export interface Draft {
  // Identity
  id: string;
  reply_id: string;

  // Content
  response_text: string;
  original_template_id?: string;

  // Slack Integration
  slack_channel: string;
  slack_message_ts: string;
  slack_thread_ts?: string;

  // Approval State
  status: DraftStatus;
  expires_at: string;
  approved_by?: string;
  approved_at?: string;
  edited_text?: string;

  // Metadata
  created_at: string;
  lead_context: LeadContext;
  classification: Classification;
}

// ===========================================
// Session State Types
// ===========================================

/**
 * Active thread being processed
 */
export interface ActiveThread {
  thread_id: string;
  lead_id: string;
  status: 'processing' | 'pending_approval' | 'escalated';
  draft_id?: string;
  started_at: string;
}

/**
 * Processed reply summary
 */
export interface ProcessedReply {
  reply_id: string;
  tier: 1 | 2 | 3;
  action: 'auto_responded' | 'draft_created' | 'escalated' | 'failed';
  processed_at: string;
  processing_time_ms: number;
}

/**
 * Session error record
 */
export interface SessionError {
  reply_id: string;
  error_code: string;
  error_message: string;
  occurred_at: string;
  recovered: boolean;
}

/**
 * Reply handler session state
 */
export interface ReplyHandlerState {
  // Session Identity
  session_id: string;
  brain_id: string;
  started_at: string;
  checkpoint_at: string;

  // Active Work
  active_threads: ActiveThread[];

  // Session Progress
  processed_this_session: ProcessedReply[];

  // Extracted Learnings
  insights_extracted: ExtractedInsight[];

  // Error Tracking
  errors_this_session: SessionError[];
}

// ===========================================
// Dead Letter Queue Types
// ===========================================

/**
 * Failed reply stored for manual recovery
 */
export interface DeadLetterEntry {
  // Identity
  id: string;
  reply_id: string;

  // Original Data
  original_payload: unknown;

  // Error Information
  error: {
    code: string;
    message: string;
    stack?: string;
  };

  // Retry History
  attempts: number;
  first_attempt_at: string;
  last_attempt_at: string;

  // Resolution
  status: 'pending_review' | 'resolved' | 'abandoned';
  resolved_by?: string;
  resolved_at?: string;
  resolution_notes?: string;

  // Metadata
  created_at: string;
}

// ===========================================
// Tier Routing Configuration
// ===========================================

/**
 * Tier routing thresholds
 */
export interface TierThresholds {
  /** Minimum confidence for auto-response (Tier 1) */
  tier1_min_confidence: number;  // Default: 0.85

  /** Minimum confidence for draft approval (Tier 2) */
  tier2_min_confidence: number;  // Default: 0.50

  /** Sentiment below this triggers escalation */
  negative_sentiment_threshold: number;  // Default: -0.5

  /** Deal value above this triggers escalation */
  high_value_deal_threshold: number;  // Default: 50000
}

/**
 * Default tier routing thresholds per spec.md
 */
export const DEFAULT_TIER_THRESHOLDS: TierThresholds = {
  tier1_min_confidence: 0.85,
  tier2_min_confidence: 0.50,
  negative_sentiment_threshold: -0.5,
  high_value_deal_threshold: 50000,
};

// ===========================================
// Template Variables
// ===========================================

/**
 * Supported template variables per spec.md
 */
export interface TemplateVariables {
  /** Lead's first name */
  first_name?: string;
  /** Lead's last name */
  last_name?: string;
  /** Lead's company name */
  company?: string;
  /** Lead's job title */
  title?: string;
  /** Lead's email address */
  email?: string;
  /** Lead's company industry */
  industry?: string;
  /** Outreach sender's name */
  sender_name?: string;
  /** Calendar scheduling link */
  meeting_link?: string;
}

/**
 * Build template variables from lead context and config
 */
export function buildTemplateVariables(
  leadContext: LeadContext,
  config: { sender_name?: string; meeting_link?: string }
): TemplateVariables {
  return {
    first_name: leadContext.first_name,
    last_name: leadContext.last_name,
    company: leadContext.company,
    title: leadContext.title,
    email: leadContext.email,
    industry: leadContext.industry,
    sender_name: config.sender_name,
    meeting_link: config.meeting_link,
  };
}

// ===========================================
// Agent Configuration
// ===========================================

/**
 * Reply handler agent configuration
 */
export interface ReplyHandlerConfig {
  // Context limits
  context_budget_tokens: number;  // Default: 60000

  // Tier thresholds
  thresholds: TierThresholds;

  // Slack configuration
  slack: {
    approval_channel: string;
    escalation_channel: string;
    draft_timeout_minutes: number;  // Default: 30
  };

  // Campaign configuration
  campaign: {
    sender_name: string;
    meeting_link: string;
  };

  // Retry configuration
  retry: {
    max_attempts: number;  // Default: 3
    backoff_ms: number[];  // Default: [1000, 5000, 30000]
  };

  // Feature flags
  features: {
    extract_insights: boolean;
    auto_create_attio_records: boolean;
  };
}

/**
 * Default agent configuration
 */
export const DEFAULT_CONFIG: ReplyHandlerConfig = {
  context_budget_tokens: 60000,
  thresholds: DEFAULT_TIER_THRESHOLDS,
  slack: {
    approval_channel: 'reply-approvals',
    escalation_channel: 'reply-escalations',
    draft_timeout_minutes: 30,
  },
  campaign: {
    sender_name: '',
    meeting_link: '',
  },
  retry: {
    max_attempts: 3,
    backoff_ms: [1000, 5000, 30000],
  },
  features: {
    extract_insights: true,
    auto_create_attio_records: true,
  },
};

// ===========================================
// Logging Event Types
// ===========================================

/**
 * Log event types per FR-029
 */
export type LogEventType =
  | 'reply_received'
  | 'reply_classified'
  | 'reply_routed'
  | 'response_sent'
  | 'approval_requested'
  | 'approval_resolved'
  | 'crm_updated'
  | 'insight_extracted'
  | 'processing_error';

/**
 * Base log event fields
 */
export interface BaseLogEvent {
  event: LogEventType;
  timestamp: string;
  reply_id: string;
  lead_id: string;
  brain_id: string;
  tier?: 1 | 2 | 3;
}

/**
 * Reply received event
 */
export interface ReplyReceivedEvent extends BaseLogEvent {
  event: 'reply_received';
  source: 'instantly' | 'linkedin' | 'manual';
  thread_id: string;
}

/**
 * Reply classified event
 */
export interface ReplyClassifiedEvent extends BaseLogEvent {
  event: 'reply_classified';
  intent: string;
  intent_confidence: number;
  sentiment: number;
  complexity: string;
  tokens_used: number;
}

/**
 * Reply routed event
 */
export interface ReplyRoutedEvent extends BaseLogEvent {
  event: 'reply_routed';
  tier: 1 | 2 | 3;
  reason: string;
  kb_match_confidence?: number;
  override_applied: boolean;
}

/**
 * Response sent event
 */
export interface ResponseSentEvent extends BaseLogEvent {
  event: 'response_sent';
  tier: 1 | 2 | 3;
  template_id?: string;
  personalized: boolean;
}

/**
 * Approval requested event
 */
export interface ApprovalRequestedEvent extends BaseLogEvent {
  event: 'approval_requested';
  tier: 2;
  draft_id: string;
  slack_channel: string;
  slack_message_ts: string;
  expires_at: string;
}

/**
 * Approval resolved event
 */
export interface ApprovalResolvedEvent extends BaseLogEvent {
  event: 'approval_resolved';
  tier: 2;
  draft_id: string;
  action: 'approved' | 'approved_edited' | 'rejected' | 'escalated' | 'expired';
  resolved_by?: string;
  wait_time_ms: number;
}

/**
 * CRM updated event
 */
export interface CRMUpdatedEvent extends BaseLogEvent {
  event: 'crm_updated';
  airtable_updated: boolean;
  airtable_status?: string;
  attio_created: boolean;
  attio_record_id?: string;
  pipeline_stage?: string;
}

/**
 * Insight extracted event
 */
export interface InsightExtractedEvent extends BaseLogEvent {
  event: 'insight_extracted';
  category: string;
  importance: string;
  actionable: boolean;
}

/**
 * Processing error event
 */
export interface ProcessingErrorEvent extends BaseLogEvent {
  event: 'processing_error';
  error_code: string;
  error_message: string;
  recoverable: boolean;
  retry_count: number;
}

/**
 * Union of all log events
 */
export type LogEvent =
  | ReplyReceivedEvent
  | ReplyClassifiedEvent
  | ReplyRoutedEvent
  | ResponseSentEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | CRMUpdatedEvent
  | InsightExtractedEvent
  | ProcessingErrorEvent;
