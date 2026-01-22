/**
 * Reply Handler - Category A (Interested) Workflow
 *
 * Handles interested leads with clear positive buying signals.
 * Implements: FR-005, FR-005a, FR-006, FR-007, FR-008
 *
 * Actions:
 * 1. Update Airtable status to "replied" (FR-011 via data sync)
 * 2. Create Attio CRM record with "New Reply" stage (FR-005)
 * 3. Send calendar booking link within 60s (FR-005a)
 * 4. Add to LinkedIn campaign if email reply (FR-007)
 * 5. Notify sales team via Slack (FR-008)
 *
 * @module reply-handler/category-a
 */

import type { WebClient } from '@slack/web-api';
import type { McpToolFunction } from './mcp-bridge';
import type { ReplyHandlerLogger } from './logger';
import {
  type CategoryAInput,
  type CategoryAOutput,
  type Notification,
  type LeadReference,
  type ReplyReference,
  createAttioRecordInput,
  createAirtableUpdateInput,
  createInitialActivity,
} from './contracts';

// ===========================================
// Configuration
// ===========================================

export interface CategoryAConfig {
  /** MCP client function for tool calls */
  callMcpTool: McpToolFunction;

  /** Slack Web API client (optional for direct modals) */
  webClient?: WebClient;

  /** Logger instance */
  logger: ReplyHandlerLogger;

  /** Slack channel for notifications */
  slackChannel: string;

  /** Calendar booking URL template */
  calendarBookingUrl: string;

  /** LinkedIn campaign ID for email respondents */
  linkedInCampaignId?: string;

  /** Whether to auto-send calendar link */
  autoSendCalendarLink?: boolean;

  /** Whether to add email respondents to LinkedIn */
  addToLinkedIn?: boolean;
}

// ===========================================
// Category A Workflow
// ===========================================

/**
 * Execute Category A (Interested) workflow.
 *
 * This workflow handles leads that have expressed clear positive interest.
 * It coordinates multiple actions in parallel where possible, with error
 * handling for partial failures.
 *
 * @example
 * ```typescript
 * const result = await executeCategoryAWorkflow(input, config);
 * if (result.success) {
 *   console.log(`CRM record created: ${result.crm_record_id}`);
 *   console.log(`Calendar link sent: ${result.calendar_link_sent}`);
 * }
 * ```
 */
export async function executeCategoryAWorkflow(
  input: CategoryAInput,
  config: CategoryAConfig
): Promise<CategoryAOutput> {
  const { reply, lead, brain_id, classification } = input;
  const { callMcpTool, logger, slackChannel } = config;

  const errors: string[] = [];
  const notifications: Notification[] = [];

  logger.info('Starting Category A workflow', {
    reply_id: reply.id,
    lead_id: lead.id,
    brain_id,
    confidence: classification.confidence,
  });

  // ===========================================
  // Step 1: Update Airtable status (FR-011)
  // ===========================================
  let airtableUpdated = false;
  try {
    const airtableInput = createAirtableUpdateInput(lead.id, 'A');
    await callMcpTool('airtable_update_lead', {
      lead_id: airtableInput.lead_id,
      status: airtableInput.status,
      classification: airtableInput.classification,
      last_reply_at: airtableInput.last_reply_at,
    });
    airtableUpdated = true;
    logger.info('Airtable lead status updated', {
      reply_id: reply.id,
      lead_id: lead.id,
      status: 'replied',
    });
  } catch (error) {
    const errorMsg = `Airtable update failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMsg);
    logger.error('Airtable update failed', error as Error, {
      reply_id: reply.id,
      lead_id: lead.id,
    });
  }

  // ===========================================
  // Step 2: Create Attio CRM record (FR-005)
  // ===========================================
  let crmRecordId: string | undefined;
  let crmRecordCreated = false;
  try {
    const attioInput = createAttioRecordInput({
      leadId: lead.id,
      email: lead.email,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      channel: reply.channel,
      campaignId: reply.campaign_id ?? 'unknown',
      replyId: reply.id,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
    });

    const attioResult = await callMcpTool<{ id: { record_id: string } }>('attio_create_person', {
      email: attioInput.email,
      name: attioInput.name,
      company: attioInput.company,
      title: attioInput.title,
      source_channel: attioInput.source_channel,
      source_campaign_id: attioInput.source_campaign_id,
      source_reply_id: attioInput.source_reply_id,
      classification_confidence: attioInput.classification_confidence,
      classification_reasoning: attioInput.classification_reasoning,
      pipeline_stage: 'new_reply',
    });

    crmRecordId = attioResult.id.record_id;
    crmRecordCreated = true;

    // Add initial activity
    const activity = createInitialActivity(reply.channel, reply.reply_text);
    await callMcpTool('attio_add_activity', {
      record_id: crmRecordId,
      activity_type: activity.type,
      content: activity.content,
      metadata: activity.metadata,
    });

    logger.info('Attio CRM record created', {
      reply_id: reply.id,
      lead_id: lead.id,
      crm_record_id: crmRecordId,
    });

    // Update Airtable with Attio reference (FR-026)
    if (airtableUpdated) {
      try {
        await callMcpTool('airtable_update_lead', {
          lead_id: lead.id,
          attio_record_id: crmRecordId,
        });
      } catch (error) {
        logger.warn('Failed to update Airtable with Attio reference', {
          reply_id: reply.id,
          lead_id: lead.id,
          crm_record_id: crmRecordId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    const errorMsg = `Attio CRM creation failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMsg);
    logger.error('Attio CRM creation failed', error as Error, {
      reply_id: reply.id,
      lead_id: lead.id,
    });
  }

  // ===========================================
  // Step 3: Send calendar booking link (FR-005a)
  // ===========================================
  let calendarLinkSent = false;
  let calendarLinkSentAt: string | undefined;

  if (config.autoSendCalendarLink !== false) {
    try {
      const calendarMessage = buildCalendarMessage(lead, config.calendarBookingUrl);

      if (reply.channel === 'email') {
        await callMcpTool('instantly_send_reply', {
          campaign_id: reply.campaign_id,
          lead_email: lead.email,
          reply_body: calendarMessage,
        });
      } else {
        // LinkedIn message
        await callMcpTool('heyreach_send_message', {
          lead_linkedin_url: lead.linkedin_url,
          message: calendarMessage,
        });
      }

      calendarLinkSent = true;
      calendarLinkSentAt = new Date().toISOString();

      logger.info('Calendar booking link sent', {
        reply_id: reply.id,
        lead_id: lead.id,
        channel: reply.channel,
      });

      // Log calendar link sent activity to CRM
      if (crmRecordId) {
        await callMcpTool('attio_add_activity', {
          record_id: crmRecordId,
          activity_type: 'calendar_link_sent',
          content: 'Calendar booking link sent to lead',
          metadata: { channel: reply.channel },
        }).catch((err) => {
          logger.warn('Failed to log calendar activity to CRM', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (error) {
      const errorMsg = `Calendar link send failed: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
      logger.error('Calendar link send failed', error as Error, {
        reply_id: reply.id,
        lead_id: lead.id,
        channel: reply.channel,
      });
    }
  }

  // ===========================================
  // Step 4: Add to LinkedIn campaign (FR-007)
  // Only for email replies when LinkedIn URL is available
  // ===========================================
  let linkedInAdded: boolean | undefined;
  let linkedInSkipReason: string | undefined;

  if (reply.channel === 'email' && config.addToLinkedIn !== false) {
    if (!lead.linkedin_url) {
      linkedInAdded = false;
      linkedInSkipReason = 'No LinkedIn URL available';
      logger.info('LinkedIn addition skipped - no URL', {
        reply_id: reply.id,
        lead_id: lead.id,
      });
    } else if (!config.linkedInCampaignId) {
      linkedInAdded = false;
      linkedInSkipReason = 'No LinkedIn campaign configured';
      logger.info('LinkedIn addition skipped - no campaign', {
        reply_id: reply.id,
        lead_id: lead.id,
      });
    } else {
      try {
        await callMcpTool('heyreach_add_leads_to_campaign', {
          campaign_id: config.linkedInCampaignId,
          leads: [
            {
              linkedin_url: lead.linkedin_url,
              email: lead.email,
              first_name: extractFirstName(lead.name),
              last_name: extractLastName(lead.name),
              company: lead.company,
            },
          ],
        });

        linkedInAdded = true;
        logger.info('Lead added to LinkedIn campaign', {
          reply_id: reply.id,
          lead_id: lead.id,
          campaign_id: config.linkedInCampaignId,
        });
      } catch (error) {
        linkedInAdded = false;
        linkedInSkipReason = `HeyReach API error: ${error instanceof Error ? error.message : String(error)}`;
        logger.error('LinkedIn campaign addition failed', error as Error, {
          reply_id: reply.id,
          lead_id: lead.id,
        });
        errors.push(`LinkedIn addition failed: ${linkedInSkipReason}`);
      }
    }
  }

  // ===========================================
  // Step 5: Notify sales team via Slack (FR-008)
  // ===========================================
  try {
    const slackMessage = buildSlackNotification({
      lead,
      reply,
      classification,
      crmRecordId,
      calendarLinkSent,
      linkedInAdded,
    });

    const slackResult = await callMcpTool<{ ok: boolean; ts: string }>('slack_post_message', {
      channel: slackChannel,
      text: slackMessage.text,
      blocks: slackMessage.blocks,
    });

    notifications.push({
      channel: 'slack',
      message_id: slackResult.ts,
      sent_at: new Date().toISOString(),
    });

    logger.info('Slack notification sent', {
      reply_id: reply.id,
      lead_id: lead.id,
      message_ts: slackResult.ts,
    });
  } catch (error) {
    const errorMsg = `Slack notification failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMsg);
    logger.error('Slack notification failed', error as Error, {
      reply_id: reply.id,
      lead_id: lead.id,
    });
  }

  // ===========================================
  // Step 6: Trigger profile enrichment (FR-006)
  // This is async - we don't wait for it
  // ===========================================
  if (crmRecordCreated && crmRecordId) {
    callMcpTool('trigger_enrichment', {
      lead_id: lead.id,
      crm_record_id: crmRecordId,
      priority: 'high',
    }).catch((error) => {
      logger.warn('Enrichment trigger failed (non-blocking)', {
        reply_id: reply.id,
        lead_id: lead.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  // ===========================================
  // Build Result
  // ===========================================
  const success =
    airtableUpdated && crmRecordCreated && calendarLinkSent && notifications.length > 0;

  logger.info('Category A workflow completed', {
    reply_id: reply.id,
    lead_id: lead.id,
    success,
    crm_record_created: crmRecordCreated,
    calendar_link_sent: calendarLinkSent,
    linkedin_added: linkedInAdded,
    notification_count: notifications.length,
    error_count: errors.length,
  });

  return {
    success,
    crm_record_id: crmRecordId,
    crm_record_created: crmRecordCreated,
    calendar_link_sent: calendarLinkSent,
    calendar_link_sent_at: calendarLinkSentAt,
    enrichment_triggered: crmRecordCreated, // Enrichment is triggered if CRM record exists
    linkedin_added: linkedInAdded,
    linkedin_skip_reason: linkedInSkipReason,
    notifications,
    airtable_updated: airtableUpdated,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ===========================================
// Helper Functions
// ===========================================

/**
 * Build calendar booking message for the lead
 */
function buildCalendarMessage(lead: LeadReference, calendarUrl: string): string {
  const firstName = extractFirstName(lead.name) || 'there';
  return `Hi ${firstName},

Thanks for your interest! I'd love to set up a time to chat.

Here's my calendar link - feel free to pick a time that works for you:
${calendarUrl}

Looking forward to connecting!`;
}

/**
 * Build Slack notification for Category A
 */
function buildSlackNotification(params: {
  lead: LeadReference;
  reply: ReplyReference;
  classification: CategoryAInput['classification'];
  crmRecordId?: string;
  calendarLinkSent: boolean;
  linkedInAdded?: boolean;
}): { text: string; blocks: unknown[] } {
  const { lead, reply, classification, crmRecordId, calendarLinkSent, linkedInAdded } = params;
  const leadName = lead.name || 'Unknown';
  const leadCompany = lead.company || 'Unknown Company';

  const text = `🎉 New interested lead: ${leadName} from ${leadCompany}`;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🎉 Category A: Interested Lead',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Lead:*\n${leadName}`,
        },
        {
          type: 'mrkdwn',
          text: `*Company:*\n${leadCompany}`,
        },
        {
          type: 'mrkdwn',
          text: `*Channel:*\n${reply.channel === 'email' ? '📧 Email' : '💼 LinkedIn'}`,
        },
        {
          type: 'mrkdwn',
          text: `*Confidence:*\n${Math.round(classification.confidence * 100)}%`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reply:*\n>${reply.reply_text.slice(0, 200)}${reply.reply_text.length > 200 ? '...' : ''}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Classification Reasoning:*\n${classification.reasoning}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: [
            crmRecordId ? `✅ CRM Record: \`${crmRecordId}\`` : '❌ CRM Record: Failed',
            calendarLinkSent ? '✅ Calendar Link: Sent' : '⏳ Calendar Link: Pending',
            linkedInAdded === true
              ? '✅ LinkedIn: Added'
              : linkedInAdded === false
                ? '⏭️ LinkedIn: Skipped'
                : '',
          ]
            .filter(Boolean)
            .join(' | '),
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View in CRM',
            emoji: true,
          },
          url: crmRecordId
            ? `https://app.attio.com/records/${crmRecordId}`
            : 'https://app.attio.com',
          action_id: 'view_crm',
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Lead',
            emoji: true,
          },
          url: `https://airtable.com/leads/${lead.id}`,
          action_id: 'view_lead',
        },
      ],
    },
  ];

  return { text, blocks };
}

/**
 * Extract first name from full name
 */
function extractFirstName(name?: string): string | undefined {
  if (!name) return undefined;
  return name.split(' ')[0];
}

/**
 * Extract last name from full name
 */
function extractLastName(name?: string): string | undefined {
  if (!name) return undefined;
  const parts = name.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : undefined;
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Category A workflow executor with configuration
 */
export function createCategoryAExecutor(config: CategoryAConfig) {
  return (input: CategoryAInput) => executeCategoryAWorkflow(input, config);
}
