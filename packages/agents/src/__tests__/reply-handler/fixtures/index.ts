/**
 * Test Fixtures for Reply Handler E2E Tests
 *
 * Provides sample payloads and mock responses for testing.
 *
 * @module __tests__/reply-handler/fixtures
 */

// ===========================================
// Webhook Payloads
// ===========================================

/**
 * Tier 1: High confidence positive interest
 * Expected: Auto-respond via Instantly
 */
export const TIER1_POSITIVE_INTEREST = {
  reply_id: 'reply_tier1_positive',
  source: 'instantly' as const,
  received_at: new Date().toISOString(),
  reply_text: 'Yes! This sounds exactly like what we need. When can we schedule a demo?',
  thread_id: 'thread_tier1',
  thread_messages: [
    {
      id: 'msg_out_1',
      direction: 'outbound' as const,
      content: 'Hi John, I noticed your company is scaling fast. Our platform helps with...',
      sent_at: new Date(Date.now() - 86400000).toISOString(),
      sender: 'sales@company.com',
      subject: 'Quick question about scaling your team',
    },
  ],
  message_count: 2,
  lead_id: 'lead_tier1',
  lead_email: 'john.smith@acme.com',
  lead_name: 'John Smith',
  lead_company: 'Acme Corporation',
  lead_title: 'VP of Engineering',
  campaign_id: 'campaign_001',
  sequence_step: 1,
  last_sent_template: 'initial_outreach',
  brain_id: 'brain_fintech',
};

/**
 * Tier 2: Moderate confidence objection
 * Expected: Create draft → Slack approval
 */
export const TIER2_OBJECTION = {
  reply_id: 'reply_tier2_objection',
  source: 'instantly' as const,
  received_at: new Date().toISOString(),
  reply_text: "We don't have budget for new tools this quarter. Can you reach out in Q2?",
  thread_id: 'thread_tier2',
  thread_messages: [
    {
      id: 'msg_out_1',
      direction: 'outbound' as const,
      content: 'Hi Sarah, I wanted to share how we help teams like yours...',
      sent_at: new Date(Date.now() - 86400000).toISOString(),
      sender: 'sales@company.com',
      subject: 'Streamlining your workflow',
    },
  ],
  message_count: 2,
  lead_id: 'lead_tier2',
  lead_email: 'sarah.jones@techcorp.io',
  lead_name: 'Sarah Jones',
  lead_company: 'TechCorp',
  lead_title: 'Director of Operations',
  campaign_id: 'campaign_002',
  sequence_step: 1,
  last_sent_template: 'initial_outreach',
  brain_id: 'brain_fintech',
};

/**
 * Tier 2: Question reply
 * Expected: Create draft → Slack approval
 */
export const TIER2_QUESTION = {
  reply_id: 'reply_tier2_question',
  source: 'instantly' as const,
  received_at: new Date().toISOString(),
  reply_text: 'Interesting. How does your solution integrate with Salesforce? Do you have SOC2 compliance?',
  thread_id: 'thread_tier2_q',
  thread_messages: [
    {
      id: 'msg_out_1',
      direction: 'outbound' as const,
      content: 'Hi Mike, our platform helps with automated lead scoring...',
      sent_at: new Date(Date.now() - 86400000).toISOString(),
      sender: 'sales@company.com',
      subject: 'Quick question',
    },
  ],
  message_count: 2,
  lead_id: 'lead_tier2_q',
  lead_email: 'mike.wilson@enterprise.com',
  lead_name: 'Mike Wilson',
  lead_company: 'Enterprise Inc',
  lead_title: 'CTO',
  campaign_id: 'campaign_003',
  sequence_step: 1,
  last_sent_template: 'initial_outreach',
  brain_id: 'brain_fintech',
};

/**
 * Tier 3: Complex referral/escalation
 * Expected: Post to escalation channel
 */
export const TIER3_REFERRAL = {
  reply_id: 'reply_tier3_referral',
  source: 'instantly' as const,
  received_at: new Date().toISOString(),
  reply_text: "I'm not the right person for this. You should talk to our procurement team and also our CTO. We have existing contracts with Competitor X though. Let me know if you want intros.",
  thread_id: 'thread_tier3',
  thread_messages: [
    {
      id: 'msg_out_1',
      direction: 'outbound' as const,
      content: 'Hi Alex, reaching out about your team workflow...',
      sent_at: new Date(Date.now() - 86400000).toISOString(),
      sender: 'sales@company.com',
      subject: 'Partnership opportunity',
    },
  ],
  message_count: 2,
  lead_id: 'lead_tier3',
  lead_email: 'alex.chen@bigco.net',
  lead_name: 'Alex Chen',
  lead_company: 'BigCo',
  lead_title: 'Product Manager',
  campaign_id: 'campaign_004',
  sequence_step: 1,
  last_sent_template: 'initial_outreach',
  brain_id: 'brain_fintech',
};

/**
 * Auto-reply: Out of office
 * Expected: Auto-handle (no response needed)
 */
export const AUTO_REPLY_OOO = {
  reply_id: 'reply_auto_ooo',
  source: 'instantly' as const,
  received_at: new Date().toISOString(),
  reply_text: 'I am currently out of the office with limited access to email. I will return on Monday, January 27th. For urgent matters, please contact support@example.com.',
  thread_id: 'thread_auto',
  thread_messages: [],
  message_count: 1,
  lead_id: 'lead_auto',
  lead_email: 'vacation@example.com',
  lead_name: 'On Vacation',
  lead_company: 'Example Corp',
  brain_id: 'brain_fintech',
};

/**
 * Unsubscribe request
 * Expected: Auto-handle (mark as unsubscribed)
 */
export const UNSUBSCRIBE_REQUEST = {
  reply_id: 'reply_unsub',
  source: 'instantly' as const,
  received_at: new Date().toISOString(),
  reply_text: 'Please remove me from your mailing list. Unsubscribe.',
  thread_id: 'thread_unsub',
  thread_messages: [],
  message_count: 1,
  lead_id: 'lead_unsub',
  lead_email: 'no-contact@example.com',
  lead_name: 'No Contact',
  lead_company: 'Example Corp',
  brain_id: 'brain_fintech',
};

/**
 * Not interested
 * Expected: Auto-handle or Tier 3 if high-value lead
 */
export const NOT_INTERESTED = {
  reply_id: 'reply_not_int',
  source: 'instantly' as const,
  received_at: new Date().toISOString(),
  reply_text: "No thanks, we're not interested at this time.",
  thread_id: 'thread_not_int',
  thread_messages: [],
  message_count: 1,
  lead_id: 'lead_not_int',
  lead_email: 'pass@example.com',
  lead_name: 'Pass Person',
  lead_company: 'Example Corp',
  brain_id: 'brain_fintech',
};

// ===========================================
// Mock API Responses
// ===========================================

/**
 * Mock Qdrant search results for KB matching
 */
export const MOCK_KB_TEMPLATES = {
  positive_interest: {
    score: 0.92,
    payload: {
      id: 'template_positive_001',
      brain_id: 'brain_fintech',
      reply_type: 'positive_response',
      content: 'Hi {{first_name}},\n\nThanks for your interest! I would love to show you how we can help {{company}}.\n\nHere is my calendar link: {{meeting_link}}\n\nBest,\n{{sender_name}}',
      personalization_instructions: 'Reference their specific role and company. Be enthusiastic but professional.',
    },
  },
  objection_budget: {
    score: 0.78,
    payload: {
      id: 'handler_budget_001',
      brain_id: 'brain_fintech',
      objection_type: 'budget',
      strategy: 'acknowledge_defer',
      content: 'Hi {{first_name}},\n\nI completely understand budget cycles. Would it be helpful if I sent over some ROI data that other {{industry}} companies have seen? No pressure to commit now.\n\nBest,\n{{sender_name}}',
      personalization_instructions: 'Acknowledge their timing concern. Offer value without pressure.',
    },
  },
  question: {
    score: 0.65,
    payload: {
      id: 'template_question_001',
      brain_id: 'brain_fintech',
      reply_type: 'answer_question',
      content: 'Hi {{first_name}},\n\nGreat questions! {{answer_placeholder}}\n\nWould you like to see this in action? Happy to walk you through.\n\nBest,\n{{sender_name}}',
      personalization_instructions: 'Answer their specific questions. Reference integrations they care about.',
    },
  },
};

/**
 * Mock Claude classification responses
 */
export const MOCK_CLASSIFICATIONS = {
  positive_interest: {
    intent: 'positive_interest',
    confidence: 0.94,
    sentiment: 0.85,
    reasoning: 'Lead expressed clear interest and requested a demo. Sentiment is very positive.',
  },
  objection: {
    intent: 'objection',
    confidence: 0.82,
    sentiment: -0.2,
    reasoning: 'Lead raised budget concern but left door open for future engagement.',
  },
  question: {
    intent: 'question',
    confidence: 0.88,
    sentiment: 0.3,
    reasoning: 'Lead asked specific technical questions indicating evaluation stage.',
  },
  referral: {
    intent: 'referral',
    confidence: 0.75,
    sentiment: 0.1,
    reasoning: 'Lead offered to refer to other contacts. Complex situation with competitor mention.',
  },
  out_of_office: {
    intent: 'out_of_office',
    confidence: 0.99,
    sentiment: 0.0,
    reasoning: 'Automated out of office response detected.',
  },
  unsubscribe: {
    intent: 'unsubscribe',
    confidence: 0.98,
    sentiment: -0.5,
    reasoning: 'Explicit unsubscribe request detected.',
  },
  not_interested: {
    intent: 'not_interested',
    confidence: 0.91,
    sentiment: -0.6,
    reasoning: 'Clear decline without engagement.',
  },
};

// ===========================================
// Slack Payloads
// ===========================================

/**
 * Slack block_actions payload for approve button
 */
export function createSlackApprovePayload(draftId: string) {
  return {
    type: 'block_actions',
    user: { id: 'U123ABC', username: 'sales_rep' },
    actions: [
      {
        type: 'button',
        action_id: `approve_draft::${draftId}`,
        block_id: 'approval_actions',
        value: draftId,
      },
    ],
    trigger_id: '123456.789012',
    container: {
      type: 'message',
      channel_id: 'C456APPROVAL',
    },
  };
}

/**
 * Slack block_actions payload for edit button
 */
export function createSlackEditPayload(draftId: string) {
  return {
    type: 'block_actions',
    user: { id: 'U123ABC', username: 'sales_rep' },
    actions: [
      {
        type: 'button',
        action_id: `edit_draft::${draftId}`,
        block_id: 'approval_actions',
        value: draftId,
      },
    ],
    trigger_id: '123456.789012',
    container: {
      type: 'message',
      channel_id: 'C456APPROVAL',
    },
  };
}

/**
 * Slack block_actions payload for reject button
 */
export function createSlackRejectPayload(draftId: string) {
  return {
    type: 'block_actions',
    user: { id: 'U123ABC', username: 'sales_rep' },
    actions: [
      {
        type: 'button',
        action_id: `reject_draft::${draftId}`,
        block_id: 'approval_actions',
        value: draftId,
      },
    ],
    trigger_id: '123456.789012',
    container: {
      type: 'message',
      channel_id: 'C456APPROVAL',
    },
  };
}

/**
 * Slack view_submission payload for edit modal
 */
export function createSlackEditSubmitPayload(draftId: string, editedContent: string) {
  return {
    type: 'view_submission',
    user: { id: 'U123ABC', username: 'sales_rep' },
    view: {
      id: 'V123VIEW',
      callback_id: 'edit_draft_modal',
      private_metadata: JSON.stringify({ draftId }),
      state: {
        values: {
          edit_block: {
            edit_input: {
              type: 'plain_text_input',
              value: editedContent,
            },
          },
        },
      },
    },
  };
}
