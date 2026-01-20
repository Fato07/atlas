/**
 * Test Fixtures for Learning Loop Agent
 *
 * Provides reusable test data, factories, and constants for unit tests.
 *
 * @module __tests__/learning-loop/fixtures
 */

import type {
  ExtractedInsight,
  InsightCategory,
  InsightImportance,
  InsightSource,
  ValidationItem,
  InsightSummary,
} from '../../../learning-loop/contracts';
import type {
  ExtractionRequest,
  ExtractionResult,
  QualityGateEvaluation,
  LearningLoopConfig,
  LearningLoopState,
} from '../../../learning-loop/types';

// ===========================================
// Constants
// ===========================================

export const TEST_BRAIN_ID = 'brain_test_fintech';
export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-12345678901234567890';
export const TEST_SLACK_CHANNEL = 'C123TEST456';

// ===========================================
// Insight Source Factory
// ===========================================

export function createTestSource(
  overrides: Partial<InsightSource> = {}
): InsightSource {
  return {
    type: 'email_reply',
    source_id: `source_${Date.now()}`,
    lead_id: `lead_${Date.now()}`,
    company_id: 'company_test_001',
    company_name: 'Acme Corporation',
    conversation_context: 'Previous conversation about their workflow challenges.',
    extracted_quote: null,
    ...overrides,
  };
}

// ===========================================
// Extracted Insight Factory
// ===========================================

export function createTestInsight(
  overrides: Partial<ExtractedInsight> = {}
): ExtractedInsight {
  const now = new Date().toISOString();

  return {
    id: `insight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    brain_id: TEST_BRAIN_ID,
    category: 'pain_point',
    content: 'Customer struggles with manual data entry taking 2+ hours daily',
    extracted_quote: 'We spend over 2 hours every day just entering data manually',
    importance: 'medium',
    actionable: true,
    action_suggestion: 'Emphasize automation capabilities in follow-up',
    source: createTestSource(),
    initial_confidence: 0.85,
    final_confidence: null,
    quality_gates: null,
    extracted_at: now,
    ...overrides,
  };
}

// ===========================================
// Category-Specific Insight Factories
// ===========================================

export function createObjectionInsight(
  overrides: Partial<ExtractedInsight> = {}
): ExtractedInsight {
  return createTestInsight({
    category: 'objection',
    content: 'Budget constraints mentioned - need to wait until Q2',
    extracted_quote: "We don't have budget for new tools this quarter",
    importance: 'high',
    initial_confidence: 0.78,
    ...overrides,
  });
}

export function createCompetitiveIntelInsight(
  overrides: Partial<ExtractedInsight> = {}
): ExtractedInsight {
  return createTestInsight({
    category: 'competitive_intel',
    content: 'Currently using Competitor X for similar functionality',
    extracted_quote: "We've been using Competitor X for about a year now",
    importance: 'high',
    initial_confidence: 0.92,
    ...overrides,
  });
}

export function createPainPointInsight(
  overrides: Partial<ExtractedInsight> = {}
): ExtractedInsight {
  return createTestInsight({
    category: 'pain_point',
    content: 'Integration challenges with existing tech stack',
    extracted_quote: 'Getting our systems to talk to each other is a nightmare',
    importance: 'medium',
    initial_confidence: 0.88,
    ...overrides,
  });
}

export function createICPSignalInsight(
  overrides: Partial<ExtractedInsight> = {}
): ExtractedInsight {
  return createTestInsight({
    category: 'icp_signal',
    content: 'Company has 50-100 employees and Series B funding',
    extracted_quote: 'We just closed our Series B and are scaling the team',
    importance: 'medium',
    initial_confidence: 0.9,
    ...overrides,
  });
}

// ===========================================
// Confidence Level Factories
// ===========================================

export function createHighConfidenceInsight(
  overrides: Partial<ExtractedInsight> = {}
): ExtractedInsight {
  return createTestInsight({
    initial_confidence: 0.92,
    ...overrides,
  });
}

export function createLowConfidenceInsight(
  overrides: Partial<ExtractedInsight> = {}
): ExtractedInsight {
  return createTestInsight({
    initial_confidence: 0.55,
    ...overrides,
  });
}

export function createBorderlineConfidenceInsight(
  overrides: Partial<ExtractedInsight> = {}
): ExtractedInsight {
  return createTestInsight({
    initial_confidence: 0.70,
    ...overrides,
  });
}

// ===========================================
// Extraction Request Factory
// ===========================================

export function createTestExtractionRequest(
  overrides: Partial<ExtractionRequest> = {}
): ExtractionRequest {
  return {
    source_type: 'email_reply',
    source_id: `source_${Date.now()}`,
    content: `Hi there,

Thanks for reaching out! We've been looking for a solution like this.

We currently spend over 2 hours every day just entering data manually. It's a huge pain point for our team. We tried Competitor X but their integration was too complex.

Can you tell me more about your pricing? We have about 50 employees and just closed our Series B funding.

Best,
John Smith
VP of Engineering`,
    thread_context: 'Initial cold outreach about our automation platform.',
    lead: {
      id: `lead_${Date.now()}`,
      company_id: 'company_acme',
      company_name: 'Acme Corporation',
      industry: 'Technology',
    },
    brain_id: TEST_BRAIN_ID,
    ...overrides,
  };
}

export function createTranscriptExtractionRequest(
  overrides: Partial<ExtractionRequest> = {}
): ExtractionRequest {
  return createTestExtractionRequest({
    source_type: 'call_transcript',
    content: `[00:01] Sales Rep: Hi John, thanks for taking the time today.
[00:05] John: No problem. We're really interested in what you have to offer.
[00:12] Sales Rep: Great! What's the biggest challenge you're facing right now?
[00:18] John: Honestly, it's the manual data entry. We spend hours on it.
[00:25] Sales Rep: I hear that a lot. Our platform automates most of that.
[00:32] John: That sounds promising. We don't have budget until Q2 though.`,
    ...overrides,
  });
}

// ===========================================
// Extraction Result Factory
// ===========================================

export function createTestExtractionResult(
  overrides: Partial<ExtractionResult> = {}
): ExtractionResult {
  return {
    success: true,
    insights: [
      {
        category: 'pain_point',
        content: 'Manual data entry taking 2+ hours daily',
        extracted_quote: 'We spend over 2 hours every day just entering data manually',
        importance: 'high',
        actionable: true,
        action_suggestion: 'Emphasize automation in follow-up',
        initial_confidence: 0.9,
      },
      {
        category: 'competitive_intel',
        content: 'Tried Competitor X, found integration too complex',
        extracted_quote: 'We tried Competitor X but their integration was too complex',
        importance: 'medium',
        actionable: true,
        action_suggestion: 'Highlight ease of integration',
        initial_confidence: 0.85,
      },
    ],
    extraction_time_ms: 1200,
    ...overrides,
  };
}

export function createEmptyExtractionResult(): ExtractionResult {
  return {
    success: true,
    insights: [],
    extraction_time_ms: 500,
  };
}

export function createFailedExtractionResult(
  error: string = 'Claude API error'
): ExtractionResult {
  return {
    success: false,
    insights: [],
    extraction_time_ms: 100,
    error,
  };
}

// ===========================================
// Quality Gate Evaluation Factory
// ===========================================

export function createTestQualityGateEvaluation(
  overrides: Partial<QualityGateEvaluation> = {}
): QualityGateEvaluation {
  return {
    passed: true,
    requires_validation: false,
    auto_approved: true,
    gates: {
      confidence: {
        passed: true,
        score: 0.85,
        threshold: 0.7,
      },
      duplicate: {
        passed: true,
        is_duplicate: false,
        similar_id: null,
        similarity: null,
      },
      importance: {
        level: 'medium',
        requires_validation: false,
        reason: 'Medium importance with high confidence - auto-approve eligible',
      },
    },
    ...overrides,
  };
}

export function createFailedConfidenceGateEvaluation(): QualityGateEvaluation {
  return createTestQualityGateEvaluation({
    passed: false,
    auto_approved: false,
    gates: {
      confidence: {
        passed: false,
        score: 0.55,
        threshold: 0.7,
      },
      duplicate: {
        passed: true,
        is_duplicate: false,
        similar_id: null,
        similarity: null,
      },
      importance: {
        level: 'medium',
        requires_validation: true,
        reason: 'Medium importance insight requires validation',
      },
    },
  });
}

export function createDuplicateGateEvaluation(
  similarId: string = 'insight_duplicate_001'
): QualityGateEvaluation {
  return createTestQualityGateEvaluation({
    passed: false,
    auto_approved: false,
    gates: {
      confidence: {
        passed: true,
        score: 0.85,
        threshold: 0.7,
      },
      duplicate: {
        passed: false,
        is_duplicate: true,
        similar_id: similarId,
        similarity: 0.92,
      },
      importance: {
        level: 'medium',
        requires_validation: true,
        reason: 'Medium importance insight requires validation',
      },
    },
  });
}

export function createNeedsValidationEvaluation(): QualityGateEvaluation {
  return createTestQualityGateEvaluation({
    passed: true,
    requires_validation: true,
    auto_approved: false,
    gates: {
      confidence: {
        passed: true,
        score: 0.75,
        threshold: 0.7,
      },
      duplicate: {
        passed: true,
        is_duplicate: false,
        similar_id: null,
        similarity: null,
      },
      importance: {
        level: 'high',
        requires_validation: true,
        reason: 'High importance insight requires human validation',
      },
    },
  });
}

// ===========================================
// Validation Item Factory
// ===========================================

export function createTestInsightSummary(
  overrides: Partial<InsightSummary> = {}
): InsightSummary {
  return {
    id: `insight_${Date.now()}`,
    category: 'pain_point',
    content: 'Customer struggles with manual data entry',
    importance: 'medium',
    confidence: 0.85,
    source_type: 'email_reply',
    company_name: 'Acme Corporation',
    extracted_quote: 'We spend hours on data entry',
    ...overrides,
  };
}

export function createTestValidationItem(
  overrides: Partial<ValidationItem> = {}
): ValidationItem {
  const now = new Date().toISOString();
  const fortyEightHoursLater = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  return {
    id: `val_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    insight_id: `insight_${Date.now()}`,
    brain_id: TEST_BRAIN_ID,
    status: 'pending',
    insight_summary: createTestInsightSummary(),
    slack: {
      channel_id: TEST_SLACK_CHANNEL,
      message_ts: '1234567890.123456',
      sent_at: now,
    },
    reminders: {
      count: 0,
      last_sent_at: null,
      next_due_at: fortyEightHoursLater,
    },
    decision: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function createApprovedValidationItem(
  overrides: Partial<ValidationItem> = {}
): ValidationItem {
  const now = new Date().toISOString();
  return createTestValidationItem({
    status: 'approved',
    decision: {
      action: 'approved',
      validated_by: 'U123USER',
      validator_name: 'John Doe',
      decided_at: now,
      note: 'Looks good, approved',
    },
    updated_at: now,
    ...overrides,
  });
}

export function createRejectedValidationItem(
  overrides: Partial<ValidationItem> = {}
): ValidationItem {
  const now = new Date().toISOString();
  return createTestValidationItem({
    status: 'rejected',
    decision: {
      action: 'rejected',
      validated_by: 'U456USER',
      validator_name: 'Jane Smith',
      decided_at: now,
      note: 'Not specific enough',
    },
    updated_at: now,
    ...overrides,
  });
}

export function createExpiredValidationItem(
  overrides: Partial<ValidationItem> = {}
): ValidationItem {
  return createTestValidationItem({
    status: 'expired',
    reminders: {
      count: 2,
      last_sent_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      next_due_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    },
    ...overrides,
  });
}

// ===========================================
// State Factory
// ===========================================

export function createTestState(
  overrides: Partial<LearningLoopState> = {}
): LearningLoopState {
  const now = new Date().toISOString();

  return {
    version: 1,
    active_brain_id: TEST_BRAIN_ID,
    pending_extractions: [],
    pending_validations: [],
    recent_insights: [],
    session_start: now,
    last_activity: now,
    errors: [],
    metrics: {
      insights_extracted: 0,
      insights_validated: 0,
      insights_auto_approved: 0,
      insights_rejected: 0,
      kb_writes: 0,
      extraction_errors: 0,
      avg_extraction_ms: 0,
      session_start: now,
    },
    last_checkpoint: now,
    ...overrides,
  };
}

// ===========================================
// Config Factory
// ===========================================

export function createTestConfig(
  overrides: Partial<LearningLoopConfig> = {}
): LearningLoopConfig {
  return {
    context_budget_tokens: 60000,
    quality_gates: {
      confidence_threshold: 0.7,
      duplicate_similarity_threshold: 0.85,
      auto_approve_confidence: 0.8,
    },
    validation: {
      reminder_hours: 48,
      max_reminders: 2,
    },
    slack: {
      validation_channel: 'learning-loop-validations',
      synthesis_channel: 'learning-loop-reports',
    },
    synthesis: {
      schedule_cron: '0 9 * * 1',
      lookback_days: 7,
    },
    features: {
      auto_approve_medium_importance: true,
      track_template_performance: true,
      send_weekly_synthesis: true,
      archive_old_insights: true,
    },
    ...overrides,
  };
}

// ===========================================
// Webhook Payload Factories
// ===========================================

export function createInsightExtractionRequestPayload() {
  return {
    source_type: 'email_reply' as const,
    source_id: `source_${Date.now()}`,
    content: 'We spend over 2 hours every day just entering data manually. It\'s frustrating.',
    lead: {
      id: `lead_${Date.now()}`,
      company_id: 'company_acme',
      company_name: 'Acme Corp',
      industry: 'Technology',
    },
    brain_id: TEST_BRAIN_ID,
  };
}

export function createValidationCallbackPayload(
  validationId: string,
  action: 'insight_approve' | 'insight_reject' = 'insight_approve'
) {
  return {
    type: 'block_actions' as const,
    user: {
      id: 'U123USER',
      username: 'john.doe',
      name: 'John Doe',
    },
    actions: [
      {
        action_id: action,
        value: JSON.stringify({
          validation_id: validationId,
          insight_id: 'insight_test_001',
          brain_id: TEST_BRAIN_ID,
        }),
        block_id: 'validation_actions',
      },
    ],
    response_url: 'https://hooks.slack.com/actions/T00/B00/XXX',
    message: {
      ts: '1234567890.123456',
    },
    channel: {
      id: TEST_SLACK_CHANNEL,
    },
  };
}

export function createSynthesisRequestPayload() {
  return {
    brain_id: TEST_BRAIN_ID,
    slack_channel: 'learning-loop-reports',
  };
}

export function createTemplateOutcomePayload(
  templateId: string = 'template_001',
  outcome: 'reply_positive' | 'reply_negative' | 'no_reply' = 'reply_positive'
) {
  return {
    template_id: templateId,
    brain_id: TEST_BRAIN_ID,
    lead_id: `lead_${Date.now()}`,
    reply_id: `reply_${Date.now()}`,
    outcome,
  };
}

// ===========================================
// Mock Request Factory
// ===========================================

export function createMockRequest(
  path: string,
  method: string = 'POST',
  options: {
    headers?: Record<string, string>;
    body?: unknown;
  } = {}
): { method: string; path: string; headers: Headers; body: unknown } {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...options.headers,
  });

  return {
    method,
    path,
    headers,
    body: options.body ?? null,
  };
}

export function createAuthenticatedRequest(
  path: string,
  method: string = 'POST',
  body: unknown = {}
) {
  return createMockRequest(path, method, {
    headers: {
      'x-webhook-secret': TEST_WEBHOOK_SECRET,
    },
    body,
  });
}

// ===========================================
// Lead Factory
// ===========================================

export interface TestLead {
  id: string;
  company_id: string;
  company_name: string;
  industry?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

export function createTestLead(
  overrides: Partial<TestLead> = {}
): TestLead {
  return {
    id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    company_id: 'company_acme',
    company_name: 'Acme Corporation',
    industry: 'Technology',
    email: 'john@acme.com',
    first_name: 'John',
    last_name: 'Smith',
    ...overrides,
  };
}

// ===========================================
// Webhook Request Factories (Aliased exports)
// ===========================================

export function createTestInsightExtractionRequest(
  overrides: Partial<{
    source_type: 'email_reply' | 'call_transcript';
    source_id: string;
    content: string;
    lead: Partial<TestLead>;
    brain_id: string;
    thread_context?: string;
  }> = {}
) {
  const base = {
    source_type: overrides.source_type ?? ('email_reply' as const),
    source_id: overrides.source_id ?? `source_${Date.now()}`,
    content: overrides.content ?? 'We spend over 2 hours every day just entering data manually. It\'s frustrating.',
    lead: createTestLead(overrides.lead ?? {}),
    brain_id: overrides.brain_id ?? TEST_BRAIN_ID,
  };

  // Only include thread_context if provided (don't include undefined)
  if (overrides.thread_context !== undefined) {
    return { ...base, thread_context: overrides.thread_context };
  }

  return base;
}

export function createTestValidationCallbackRequest(
  overrides: Partial<{
    insight_id: string;
    validation_id: string;
    decision: 'approved' | 'rejected';
    reviewer_id: string;
    rejection_reason?: string;
    note?: string;
  }> = {}
) {
  const action_id = overrides.decision === 'rejected' ? 'insight_reject' : 'insight_approve';
  const validationId = overrides.validation_id ?? `val_${Date.now()}`;
  const insightId = overrides.insight_id ?? `insight_${Date.now()}`;

  // Return Slack block_actions format as expected by the webhook
  return {
    type: 'block_actions' as const,
    user: {
      id: overrides.reviewer_id ?? 'U123456',
      username: 'john.doe',
      name: 'John Doe',
    },
    actions: [
      {
        action_id,
        value: JSON.stringify({
          validation_id: validationId,
          insight_id: insightId,
          brain_id: TEST_BRAIN_ID,
          note: overrides.note,
          rejection_reason: overrides.rejection_reason,
        }),
        block_id: 'validation_actions',
      },
    ],
    response_url: 'https://hooks.slack.com/actions/T00/B00/XXX',
    message: {
      ts: '1234567890.123456',
    },
    channel: {
      id: TEST_SLACK_CHANNEL,
    },
  };
}

export function createTestSynthesisRequest(
  overrides: Partial<{
    brain_id: string;
    week_start?: string;
    week_end?: string;
    slack_channel?: string;
  }> = {}
) {
  return {
    brain_id: overrides.brain_id ?? TEST_BRAIN_ID,
    slack_channel: overrides.slack_channel ?? 'learning-loop-reports',
    week_start: overrides.week_start,
    week_end: overrides.week_end,
    ...overrides,
  };
}

export function createTestTemplateOutcomeRequest(
  overrides: Partial<{
    template_id: string;
    brain_id: string;
    lead_id: string;
    reply_id: string;
    outcome: 'meeting_booked' | 'positive_reply' | 'no_response' | 'negative_reply';
  }> = {}
) {
  return {
    template_id: overrides.template_id ?? `template_${Date.now()}`,
    brain_id: overrides.brain_id ?? TEST_BRAIN_ID,
    lead_id: overrides.lead_id ?? `lead_${Date.now()}`,
    reply_id: overrides.reply_id ?? `reply_${Date.now()}`,
    outcome: overrides.outcome ?? 'positive_reply',
    ...overrides,
  };
}
