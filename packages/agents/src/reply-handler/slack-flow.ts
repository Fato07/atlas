/**
 * Reply Handler Agent - Slack Flow Manager
 *
 * Orchestrates Slack interactions for Tier 2 approvals and Tier 3 escalations.
 * Uses Slack MCP for message operations, @slack/web-api for modal opens (trigger_id constraint).
 *
 * Implements FR-015 (Tier 2 approval flow), FR-016 (Slack notifications),
 * FR-017 (approval workflow), FR-018 (edit modal).
 *
 * @module reply-handler/slack-flow
 */

import { WebClient, type ChatPostMessageResponse, type ViewsOpenResponse } from '@slack/web-api';
import type { Draft, DraftStatus } from './types';
import type { LeadContext } from './contracts/reply-input';
import type { Classification, TierRouting } from './contracts/handler-result';

// ===========================================
// Slack Flow Configuration
// ===========================================

export interface SlackFlowConfig {
  /** Slack Web API client (for modals with trigger_id) */
  webClient: WebClient;

  /** MCP client function for Slack tools (for messages) */
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;

  /** Channel IDs */
  channels: {
    /** Channel for Tier 2 approvals */
    approvals: string;
    /** Channel for Tier 3 escalations */
    escalations: string;
  };

  /** Approval settings */
  approval?: {
    /** Timeout before auto-expire (ms) */
    timeout?: number;
    /** Enable expiration reminders */
    reminderEnabled?: boolean;
    /** Minutes before expiry to send reminder */
    reminderMinutes?: number;
  };
}

const DEFAULT_APPROVAL_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours
const DEFAULT_REMINDER_MINUTES = 30;

// ===========================================
// Slack Flow Manager
// ===========================================

export class SlackFlowManager {
  private webClient: WebClient;
  private callMcpTool: SlackFlowConfig['callMcpTool'];
  private channels: SlackFlowConfig['channels'];
  private approval: Required<NonNullable<SlackFlowConfig['approval']>>;

  constructor(config: SlackFlowConfig) {
    this.webClient = config.webClient;
    this.callMcpTool = config.callMcpTool;
    this.channels = config.channels;
    this.approval = {
      timeout: config.approval?.timeout ?? DEFAULT_APPROVAL_TIMEOUT,
      reminderEnabled: config.approval?.reminderEnabled ?? true,
      reminderMinutes: config.approval?.reminderMinutes ?? DEFAULT_REMINDER_MINUTES,
    };
  }

  // ===========================================
  // Tier 2: Approval Request (FR-015)
  // ===========================================

  /**
   * Post approval request to Slack (Tier 2)
   */
  async postApprovalRequest(params: {
    draft: Draft;
    leadContext: LeadContext;
    classification: Classification;
    routing: TierRouting;
    replyText: string;
  }): Promise<{
    channel: string;
    ts: string;
    expiresAt: string;
  }> {
    const { draft, leadContext, classification, routing, replyText } = params;

    const expiresAt = new Date(Date.now() + this.approval.timeout).toISOString();

    // Use Slack MCP for posting (no trigger_id constraint)
    const response = await this.callMcpTool<{
      ok: boolean;
      channel: string;
      ts: string;
    }>('slack_post_approval_request', {
      channel: this.channels.approvals,
      lead_name: `${leadContext.first_name ?? ''} ${leadContext.last_name ?? ''}`.trim() || 'Unknown',
      lead_company: leadContext.company ?? 'Unknown Company',
      lead_email: leadContext.email,
      reply_text: replyText,
      draft_response: draft.response_text,
      intent: classification.intent,
      confidence: classification.intent_confidence,
      tier: routing.tier,
      draft_id: draft.id,
      expires_at: expiresAt,
    });

    return {
      channel: response.channel,
      ts: response.ts,
      expiresAt,
    };
  }

  // ===========================================
  // Tier 3: Escalation Notification (FR-016)
  // ===========================================

  /**
   * Post escalation notification to Slack (Tier 3)
   */
  async postEscalation(params: {
    escalationId: string;
    leadContext: LeadContext;
    classification: Classification;
    routing: TierRouting;
    replyText: string;
  }): Promise<{
    channel: string;
    ts: string;
  }> {
    const { escalationId, leadContext, classification, routing, replyText } = params;

    // Use Slack MCP for posting (no trigger_id constraint)
    const response = await this.callMcpTool<{
      ok: boolean;
      channel: string;
      ts: string;
    }>('slack_post_escalation', {
      channel: this.channels.escalations,
      lead_name: `${leadContext.first_name ?? ''} ${leadContext.last_name ?? ''}`.trim() || 'Unknown',
      lead_company: leadContext.company ?? 'Unknown Company',
      lead_email: leadContext.email,
      reply_text: replyText,
      reason: routing.reason,
      intent: classification.intent,
      sentiment: classification.sentiment,
      urgency: classification.urgency,
      escalation_id: escalationId,
    });

    return {
      channel: response.channel,
      ts: response.ts,
    };
  }

  // ===========================================
  // Approval Resolution (FR-017)
  // ===========================================

  /**
   * Update approval message with resolution status
   */
  async resolveApproval(params: {
    channel: string;
    ts: string;
    draftId: string;
    status: DraftStatus;
    resolvedBy?: string;
  }): Promise<void> {
    const { channel, ts, draftId, status, resolvedBy } = params;

    // Use Slack MCP for updating (no trigger_id constraint)
    await this.callMcpTool('slack_resolve_approval', {
      channel,
      ts,
      draft_id: draftId,
      status,
      resolved_by: resolvedBy,
    });
  }

  // ===========================================
  // Edit Modal (FR-018)
  // ===========================================

  /**
   * Open edit modal for draft response.
   *
   * IMPORTANT: This uses direct @slack/web-api because trigger_id expires in 3 seconds.
   * MCP latency would cause modal opens to fail.
   */
  async openEditModal(params: {
    triggerId: string;
    draft: Draft;
    leadName: string;
    leadCompany: string;
  }): Promise<ViewsOpenResponse> {
    const { triggerId, draft, leadName, leadCompany } = params;

    // Direct WebClient call - trigger_id expires in 3 seconds
    const response = await this.webClient.views.open({
      trigger_id: triggerId,
      view: this.buildEditModalView(draft, leadName, leadCompany),
    });

    return response;
  }

  /**
   * Build Block Kit view for edit modal
   */
  private buildEditModalView(
    draft: Draft,
    leadName: string,
    leadCompany: string
  ): Parameters<WebClient['views']['open']>[0]['view'] {
    return {
      type: 'modal',
      callback_id: `edit_draft_${draft.id}`,
      title: {
        type: 'plain_text',
        text: 'Edit Response',
        emoji: true,
      },
      submit: {
        type: 'plain_text',
        text: 'Send Edited',
        emoji: true,
      },
      close: {
        type: 'plain_text',
        text: 'Cancel',
        emoji: true,
      },
      private_metadata: JSON.stringify({
        draft_id: draft.id,
        reply_id: draft.reply_id,
        lead_id: draft.lead_context.id,
      }),
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Editing response to ${leadName} at ${leadCompany}*`,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'input',
          block_id: 'response_content',
          label: {
            type: 'plain_text',
            text: 'Response',
            emoji: true,
          },
          element: {
            type: 'plain_text_input',
            action_id: 'response_input',
            multiline: true,
            initial_value: draft.response_text,
            min_length: 10,
            max_length: 4000,
          },
          hint: {
            type: 'plain_text',
            text: 'Edit the response that will be sent to the lead.',
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Draft ID: ${draft.id} | Created: ${new Date(draft.created_at).toLocaleString()}`,
            },
          ],
        },
      ],
    };
  }

  // ===========================================
  // Notification Helpers
  // ===========================================

  /**
   * Send a simple notification message
   */
  async sendNotification(params: {
    channel: string;
    text: string;
    threadTs?: string;
  }): Promise<{ ts: string }> {
    const response = await this.callMcpTool<{
      ok: boolean;
      ts: string;
    }>('slack_post_message', {
      channel: params.channel,
      text: params.text,
      thread_ts: params.threadTs,
    });

    return { ts: response.ts };
  }

  /**
   * Add reaction to a message
   */
  async addReaction(params: {
    channel: string;
    ts: string;
    emoji: string;
  }): Promise<void> {
    await this.callMcpTool('slack_add_reaction', {
      channel: params.channel,
      ts: params.ts,
      emoji: params.emoji,
    });
  }

  /**
   * Send expiration reminder for pending draft
   */
  async sendExpirationReminder(params: {
    channel: string;
    threadTs: string;
    draftId: string;
    expiresAt: string;
  }): Promise<void> {
    if (!this.approval.reminderEnabled) {
      return;
    }

    const expiresAtDate = new Date(params.expiresAt);
    const minutesRemaining = Math.round((expiresAtDate.getTime() - Date.now()) / 60000);

    await this.sendNotification({
      channel: params.channel,
      text: `⏰ *Reminder:* Draft \`${params.draftId}\` will expire in ${minutesRemaining} minutes. Please review and take action.`,
      threadTs: params.threadTs,
    });
  }

  // ===========================================
  // Interactive Callback Handlers
  // ===========================================

  /**
   * Handle interactive action from Slack
   */
  async handleInteractiveAction(payload: SlackInteractivePayload): Promise<{
    action: 'approve' | 'edit' | 'reject' | 'escalate' | 'claim' | 'submit_edit';
    draftId?: string;
    escalationId?: string;
    editedContent?: string;
    userId: string;
    triggerId: string;
  }> {
    const userId = payload.user.id;
    const triggerId = payload.trigger_id;

    // Handle block actions (button clicks)
    if (payload.type === 'block_actions') {
      if (!payload.actions || payload.actions.length === 0) {
        throw new Error('No actions in block_actions payload');
      }
      const action = payload.actions[0];
      const actionId = action.action_id;
      const value = action.value;

      switch (actionId) {
        case 'approve_draft':
          return { action: 'approve', draftId: value, userId, triggerId };
        case 'edit_draft':
          return { action: 'edit', draftId: value, userId, triggerId };
        case 'reject_draft':
          return { action: 'reject', draftId: value, userId, triggerId };
        case 'escalate_draft':
          return { action: 'escalate', draftId: value, userId, triggerId };
        case 'claim_escalation':
          return { action: 'claim', escalationId: value, userId, triggerId };
        default:
          throw new Error(`Unknown action_id: ${actionId}`);
      }
    }

    // Handle view submission (modal submit)
    if (payload.type === 'view_submission') {
      if (!payload.view) {
        throw new Error('No view in view_submission payload');
      }
      const metadata = JSON.parse(payload.view.private_metadata || '{}');
      const draftId = metadata.draft_id;
      const editedContent =
        payload.view.state?.values?.response_content?.response_input?.value ?? '';

      return {
        action: 'submit_edit',
        draftId,
        editedContent,
        userId,
        triggerId,
      };
    }

    throw new Error(`Unsupported payload type: ${payload.type}`);
  }

  // ===========================================
  // User Info
  // ===========================================

  /**
   * Get user information from Slack
   */
  async getUserInfo(userId: string): Promise<{
    id: string;
    name: string;
    realName: string;
    email?: string;
  }> {
    const response = await this.callMcpTool<{
      id: string;
      name: string;
      real_name: string;
      email?: string;
    }>('slack_get_user_info', {
      user_id: userId,
    });

    return {
      id: response.id,
      name: response.name,
      realName: response.real_name,
      email: response.email,
    };
  }
}

// ===========================================
// Slack Interactive Payload Types
// ===========================================

export interface SlackInteractivePayload {
  type: 'block_actions' | 'view_submission';
  trigger_id: string;
  user: {
    id: string;
    username: string;
    name: string;
  };
  channel?: {
    id: string;
    name: string;
  };
  message?: {
    ts: string;
    blocks: unknown[];
  };
  actions?: Array<{
    action_id: string;
    block_id: string;
    value: string;
    type: string;
  }>;
  view?: {
    id: string;
    callback_id: string;
    private_metadata: string;
    state?: {
      values: Record<
        string,
        Record<
          string,
          {
            type: string;
            value: string;
          }
        >
      >;
    };
  };
  response_url?: string;
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Slack flow manager
 */
export function createSlackFlowManager(config: SlackFlowConfig): SlackFlowManager {
  return new SlackFlowManager(config);
}

// ===========================================
// Slack Signature Verification
// ===========================================

/**
 * Verify Slack request signature.
 *
 * Uses Bun.CryptoHasher for HMAC computation.
 */
export function verifySlackSignature(params: {
  signature: string;
  timestamp: string;
  body: string;
  signingSecret: string;
}): boolean {
  const { signature, timestamp, body, signingSecret } = params;

  // Check timestamp is within 5 minutes
  const requestTimestamp = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - requestTimestamp) > 60 * 5) {
    return false;
  }

  // Compute expected signature
  const sigBaseString = `v0:${timestamp}:${body}`;
  const hasher = new Bun.CryptoHasher('sha256', signingSecret);
  hasher.update(sigBaseString);
  const expectedSignature = `v0=${hasher.digest('hex')}`;

  // Timing-safe comparison
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  return result === 0;
}

// ===========================================
// Response URL Handler
// ===========================================

/**
 * Send response via response_url (for ephemeral or updated messages)
 */
export async function sendResponseUrl(
  responseUrl: string,
  payload: {
    text?: string;
    blocks?: unknown[];
    replace_original?: boolean;
    delete_original?: boolean;
    response_type?: 'in_channel' | 'ephemeral';
  }
): Promise<void> {
  const response = await fetch(responseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Response URL request failed: ${response.status}`);
  }
}
