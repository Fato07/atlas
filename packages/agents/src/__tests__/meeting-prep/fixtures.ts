/**
 * Meeting Prep Agent Test Fixtures
 *
 * Provides test data for meeting prep agent tests including:
 * - ParsedMeeting fixtures
 * - TranscriptInput fixtures
 * - Brief content fixtures
 * - Context gathering fixtures
 *
 * @module meeting-prep/tests/fixtures
 */

import type {
  ParsedMeeting,
  CalendarWebhookPayload,
  ManualBriefRequest,
  TranscriptInput,
  BANT,
  BriefContent,
  Brief,
} from '../../meeting-prep/contracts';
import type { GatheredContext } from '../../meeting-prep/types';

// ===========================================
// Test Brain ID
// ===========================================

export const TEST_BRAIN_ID = 'brain_test_fintech';

// ===========================================
// Meeting Fixtures
// ===========================================

/**
 * Create a parsed meeting fixture with optional overrides
 */
export function createParsedMeeting(overrides: Partial<ParsedMeeting> = {}): ParsedMeeting {
  const now = new Date();
  const startTime = new Date(now.getTime() + 30 * 60 * 1000); // 30 min from now
  const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 min meeting

  return {
    meeting_id: `mtg_${Date.now()}`,
    brain_id: TEST_BRAIN_ID,
    title: 'Discovery Call with Acme Corp',
    description: 'Initial discovery call to discuss AI automation needs',
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    timezone: 'America/New_York',
    primary_attendee: {
      email: 'jane.doe@acme.com',
      name: 'Jane Doe',
      is_external: true,
    },
    other_attendees: [
      { email: 'sales@atlas.com', name: 'John Smith', is_external: false },
    ],
    meeting_link: 'https://meet.google.com/abc-defg-hij',
    meeting_type: 'google_meet',
    status: 'confirmed',
    recurring_event_id: null,
    created_at: now.toISOString(),
    source: 'calendar_webhook',
    ...overrides,
  };
}

/**
 * Create a calendar webhook payload fixture
 */
export function createCalendarWebhook(overrides: Partial<CalendarWebhookPayload> = {}): CalendarWebhookPayload {
  const now = new Date();
  const startTime = new Date(now.getTime() + 30 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

  return {
    event_type: 'meeting_reminder',
    brain_id: TEST_BRAIN_ID,
    event: {
      event_id: `evt_${Date.now()}`,
      summary: 'Discovery Call with Acme Corp',
      description: 'Initial discovery call to discuss AI automation needs',
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'America/New_York',
      },
      attendees: [
        { email: 'jane.doe@acme.com', name: 'Jane Doe', response_status: 'accepted', is_organizer: false },
        { email: 'sales@atlas.com', name: 'John Smith', is_organizer: true },
      ],
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      status: 'confirmed',
      recurringEventId: null,
    },
    trigger_time: now.toISOString(),
    ...overrides,
  };
}

/**
 * Create a manual brief request fixture
 */
export function createManualBriefRequest(overrides: Partial<ManualBriefRequest> = {}): ManualBriefRequest {
  return {
    brain_id: TEST_BRAIN_ID,
    meeting_id: `mtg_${Date.now()}`,
    attendee_email: 'contact@example.com',
    ...overrides,
  };
}

// ===========================================
// Transcript Fixtures
// ===========================================

/**
 * Create a transcript input fixture
 */
export function createTranscriptInput(overrides: Partial<TranscriptInput> = {}): TranscriptInput {
  return {
    meeting_id: `mtg_${Date.now()}`,
    brain_id: TEST_BRAIN_ID,
    source: 'fireflies',
    attendee_email: 'jane.doe@acme.com',
    meeting_date: new Date().toISOString(),
    transcript_text: `
[00:00] John (Atlas): Hi Jane, thanks for joining. How's everything going at Acme?

[00:15] Jane (Acme): Great, thanks! We're really excited to explore how AI can help with our sales operations.

[01:00] John (Atlas): Perfect. Can you tell me about your current sales process and where you're seeing bottlenecks?

[02:30] Jane (Acme): Sure. We have a team of 15 SDRs handling about 500 leads a month. The biggest challenge is qualifying leads quickly - our reps spend too much time on leads that aren't a good fit.

[04:00] John (Atlas): That's a common challenge. What does your current lead qualification process look like?

[05:30] Jane (Acme): It's mostly manual. Reps look at the company website, LinkedIn, maybe do a bit of research. But it takes 20-30 minutes per lead.

[07:00] John (Atlas): And what's your budget for solving this?

[08:00] Jane (Acme): We've allocated about $50k for Q1. Our VP of Sales has the final approval, but I'm leading the evaluation.

[09:30] John (Atlas): Great. What's your timeline for making a decision?

[10:00] Jane (Acme): We're hoping to have something in place by end of February. We have a board meeting in March and want to show improved metrics.

[11:30] John (Atlas): That's helpful. What would success look like for you?

[12:30] Jane (Acme): Honestly, if we could cut qualification time in half and improve conversion rates by 20%, that would be huge.

[14:00] John (Atlas): Those are very achievable goals. Let me walk you through how Atlas works...
    `.trim(),
    duration_minutes: 45,
    ...overrides,
  };
}

// ===========================================
// Context Fixtures
// ===========================================

/**
 * Create a gathered context fixture
 */
export function createGatheredContext(overrides: Partial<GatheredContext> = {}): GatheredContext {
  return {
    lead: {
      email: 'jane.doe@acme.com',
      name: 'Jane Doe',
      company: 'Acme Corp',
      title: 'Director of Sales Operations',
      industry: 'Technology',
      icp_score: 85,
      vertical: 'saas',
    },
    conversation_history: [
      {
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        channel: 'linkedin',
        summary: 'Initial outreach via LinkedIn - Jane expressed interest in AI-powered sales tools',
        sentiment: 'positive',
      },
      {
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        channel: 'email',
        summary: 'Follow-up email - Shared case study, Jane booked discovery call',
        sentiment: 'positive',
      },
    ],
    company_intel: {
      industry: 'Technology',
      size: '250 employees',
      funding_stage: 'Series B',
      recent_news: [
        'Raised Series B funding of $25M in November 2024',
        'Launched new product line in Q4',
      ],
      tech_stack: ['Salesforce', 'HubSpot', 'Slack', 'Zoom'],
      key_people: [
        {
          name: 'Jane Doe',
          title: 'Director of Sales Operations',
          relevance: 'Primary contact - leading evaluation',
        },
        {
          name: 'John Smith',
          title: 'VP of Sales',
          relevance: 'Final budget authority',
        },
      ],
    },
    kb_context: {
      objection_handlers: [
        {
          id: 'oh_001',
          objection: 'Price is too high',
          response: 'Our customers typically see 3x ROI within 6 months. Let me share some case studies...',
          confidence: 0.9,
        },
        {
          id: 'oh_002',
          objection: 'Integration concerns',
          response: 'Native Salesforce integration, 2-way sync, setup in under a week',
          confidence: 0.85,
        },
      ],
      similar_deals: [
        {
          company: 'TechCorp',
          industry: 'Technology',
          why_won: 'Fast implementation and clear ROI within 3 months',
          relevance_score: 0.85,
        },
      ],
      icp_rules: [
        {
          dimension: 'company_size',
          rule: 'Company size 100-500 employees',
        },
        {
          dimension: 'industry',
          rule: 'Technology or SaaS industry',
        },
      ],
    },
    gathered_at: new Date().toISOString(),
    gathering_duration_ms: 1500,
    missing_sources: [],
    ...overrides,
  };
}

// ===========================================
// Brief Fixtures
// ===========================================

/**
 * Create a brief content fixture
 */
export function createBriefContent(overrides: Partial<BriefContent> = {}): BriefContent {
  return {
    quick_context:
      'Jane Doe is Director of Sales Operations at Acme Corp, a 250-person tech company. They have 15 SDRs handling 500 leads/month with manual qualification taking 20-30 min per lead. First discovery call after LinkedIn outreach.',
    conversation_timeline: [
      {
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        channel: 'linkedin',
        summary: 'Initial outreach via LinkedIn - Jane expressed interest in AI-powered sales tools',
        sentiment: 'positive',
      },
      {
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        channel: 'email',
        summary: 'Follow-up email - Shared case study, Jane booked discovery call',
        sentiment: 'positive',
      },
    ],
    company_intel: {
      industry: 'Technology',
      size: '250 employees',
      funding_stage: 'Series B',
      recent_news: [
        'Raised Series B funding of $25M in November 2024',
        'Launched new product line in Q4',
      ],
      tech_stack: ['Salesforce', 'HubSpot', 'Slack', 'Zoom'],
      key_people: [
        {
          name: 'Jane Doe',
          title: 'Director of Sales Operations',
          relevance: 'Primary contact - leading evaluation',
        },
        {
          name: 'John Smith',
          title: 'VP of Sales',
          relevance: 'Final budget authority',
        },
      ],
    },
    talking_points: [
      'Discuss current lead qualification process and pain points',
      'Explore how Atlas can automate scoring and reduce 20-30 min qualification time',
      'Share similar customer results emphasizing quick time-to-value',
      'Address team adoption with 15 SDRs - training and onboarding process',
    ],
    suggested_questions: [
      'What does success look like for this initiative?',
      'Who else is involved in the decision-making process?',
      'What timeline are you working with for implementation?',
    ],
    objection_handlers: [
      {
        objection: 'Integration with existing Salesforce',
        response: 'Native Salesforce integration, 2-way sync, setup in under a week',
        source: 'kb_handler',
        confidence: 0.9,
      },
      {
        objection: 'Learning curve for SDR team',
        response: 'Intuitive interface, comprehensive training, dedicated CSM',
        source: 'similar_deal',
        confidence: 0.85,
      },
    ],
    similar_won_deals: [
      {
        company: 'TechCorp',
        industry: 'Technology',
        why_won: 'Fast implementation and clear ROI within 3 months',
        relevance_score: 0.85,
        key_lesson: 'Emphasize quick time-to-value and integration simplicity',
      },
    ],
    ...overrides,
  };
}

/**
 * Create a full brief fixture with lifecycle data
 */
export function createBrief(overrides: Partial<Brief> = {}): Brief {
  const now = new Date().toISOString();
  return {
    brief_id: crypto.randomUUID(),
    meeting_id: `mtg_${Date.now()}`,
    brain_id: TEST_BRAIN_ID,
    status: 'delivered',
    status_history: [
      { status: 'pending', timestamp: now },
      { status: 'generating', timestamp: now },
      { status: 'delivered', timestamp: now },
    ],
    content: createBriefContent(),
    slack_message_ts: '1234567890.123456',
    slack_channel_id: 'C12345678',
    delivered_at: now,
    context_gathering_ms: 1500,
    generation_ms: 2000,
    total_processing_ms: 3500,
    error: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ===========================================
// BANT Score Fixtures
// ===========================================

/**
 * Create a BANT qualification fixture
 */
export function createBANT(overrides: Partial<BANT> = {}): BANT {
  return {
    budget: {
      status: 'confirmed',
      confidence: 0.9,
      evidence: '$50k allocated for Q1, VP approval secured',
      next_step: null,
      amount: '$50,000',
    },
    authority: {
      status: 'partial',
      confidence: 0.8,
      evidence: 'Jane leads evaluation but VP of Sales has final say',
      next_step: 'Confirm VP involvement and schedule intro call',
      decision_maker: false,
      stakeholders: ['VP of Sales', 'IT Lead'],
    },
    need: {
      status: 'confirmed',
      confidence: 0.95,
      evidence: 'Clear pain point: 20-30 min per lead qualification, goal to cut time in half',
      next_step: null,
      pain_points: [
        'Manual lead qualification taking too long',
        'Inconsistent scoring across SDR team',
        'Difficulty scaling with growing lead volume',
      ],
      urgency: 'high',
    },
    timeline: {
      status: 'confirmed',
      confidence: 0.85,
      evidence: 'Decision by end of February, board meeting in March',
      next_step: null,
      target_date: '2025-02-28',
      driving_event: 'Board meeting in March - need to show improved metrics',
    },
    overall: {
      score: 81,
      recommendation: 'hot',
      summary:
        'Strong opportunity with clear budget, need, and timeline. Focus on building relationship with VP.',
    },
    ...overrides,
  };
}

// ===========================================
// Webhook Response Fixtures
// ===========================================

/**
 * Create a successful brief webhook response
 */
export function createBriefWebhookResponse() {
  return {
    success: true,
    brief_id: `brief_${Date.now()}`,
    status: 'delivered' as const,
    message: 'Brief generated and delivered successfully',
    processing_time_ms: 2500,
  };
}

/**
 * Create an error webhook response
 */
export function createErrorWebhookResponse(error: { code: string; message: string }) {
  return {
    success: false,
    message: error.message,
    error: {
      code: error.code,
      message: error.message,
    },
  };
}
