/**
 * Learning Loop Slack Client
 *
 * Slack client wrapper for validation requests and weekly synthesis delivery.
 * Uses Block Kit for rich, interactive messages.
 *
 * @module learning-loop/slack-client
 */

import type {
  InsightCategory,
  InsightImportance,
  ValidationItem,
  WeeklySynthesis,
} from './contracts';

// ===========================================
// Types
// ===========================================

export interface SlackClientConfig {
  /** Slack bot token */
  botToken: string;
  /** Channel for validation requests */
  validationChannel: string;
  /** Channel for weekly synthesis reports */
  synthesisChannel: string;
  /** Callback URL for interactive actions */
  callbackUrl: string;
}

export const DEFAULT_SLACK_CONFIG: SlackClientConfig = {
  botToken: process.env.SLACK_BOT_TOKEN ?? '',
  validationChannel: 'learning-loop-validations',
  synthesisChannel: 'learning-loop-reports',
  callbackUrl: process.env.LEARNING_LOOP_CALLBACK_URL ?? '',
};

export interface SlackMessageResult {
  success: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

// ===========================================
// Block Kit Helpers
// ===========================================

interface TextBlock {
  type: 'section' | 'header' | 'context' | 'divider';
  text?: {
    type: 'plain_text' | 'mrkdwn';
    text: string;
    emoji?: boolean;
  };
  accessory?: unknown;
  elements?: Array<{ type: string; text: string }>;
}

interface ActionsBlock {
  type: 'actions';
  block_id: string;
  elements: Array<{
    type: 'button';
    text: { type: 'plain_text'; text: string; emoji?: boolean };
    style?: 'primary' | 'danger';
    action_id: string;
    value: string;
  }>;
}

type Block = TextBlock | ActionsBlock;

function header(text: string): TextBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text, emoji: true },
  };
}

function section(text: string): TextBlock {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text },
  };
}

function context(text: string): TextBlock {
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text }],
  };
}

function divider(): TextBlock {
  return { type: 'divider' };
}

function approveRejectActions(validationId: string): ActionsBlock {
  return {
    type: 'actions',
    block_id: `validation_${validationId}`,
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '✅ Approve', emoji: true },
        style: 'primary',
        action_id: 'approve_insight',
        value: validationId,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '❌ Reject', emoji: true },
        style: 'danger',
        action_id: 'reject_insight',
        value: validationId,
      },
    ],
  };
}

// ===========================================
// Category Display Helpers
// ===========================================

const CATEGORY_EMOJI: Record<InsightCategory, string> = {
  buying_process: '🛒',
  pain_point: '😣',
  objection: '🚫',
  competitive_intel: '🔍',
  messaging_effectiveness: '📝',
  icp_signal: '🎯',
};

const CATEGORY_LABELS: Record<InsightCategory, string> = {
  buying_process: 'Buying Process',
  pain_point: 'Pain Point',
  objection: 'Objection',
  competitive_intel: 'Competitive Intel',
  messaging_effectiveness: 'Messaging Effectiveness',
  icp_signal: 'ICP Signal',
};

const IMPORTANCE_EMOJI: Record<InsightImportance, string> = {
  high: '🔴',
  medium: '🟡',
  low: '🟢',
};

// ===========================================
// Slack Client Class
// ===========================================

export class LearningLoopSlackClient {
  private readonly config: SlackClientConfig;
  private readonly baseUrl = 'https://slack.com/api';

  constructor(config?: Partial<SlackClientConfig>) {
    this.config = { ...DEFAULT_SLACK_CONFIG, ...config };
  }

  // ===========================================
  // Low-level Slack API
  // ===========================================

  private async callSlackApi<T>(
    method: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.statusText}`);
    }

    const data = (await response.json()) as T & { ok: boolean; error?: string };

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    return data;
  }

  private async postMessage(
    channel: string,
    blocks: Block[],
    text: string
  ): Promise<SlackMessageResult> {
    try {
      const result = await this.callSlackApi<{ ts: string; channel: string }>(
        'chat.postMessage',
        {
          channel,
          blocks,
          text, // Fallback text for notifications
        }
      );

      return {
        success: true,
        ts: result.ts,
        channel: result.channel,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private async updateMessage(
    channel: string,
    ts: string,
    blocks: Block[],
    text: string
  ): Promise<SlackMessageResult> {
    try {
      const result = await this.callSlackApi<{ ts: string; channel: string }>(
        'chat.update',
        {
          channel,
          ts,
          blocks,
          text,
        }
      );

      return {
        success: true,
        ts: result.ts,
        channel: result.channel,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // ===========================================
  // Validation Message Operations (FR-012, FR-013, FR-014, FR-015)
  // ===========================================

  /**
   * Send a validation request to Slack.
   */
  async sendValidationRequest(item: ValidationItem): Promise<SlackMessageResult> {
    const { insight_summary: summary } = item;
    const categoryEmoji = CATEGORY_EMOJI[summary.category];
    const categoryLabel = CATEGORY_LABELS[summary.category];
    const importanceEmoji = IMPORTANCE_EMOJI[summary.importance];

    const blocks: Block[] = [
      header(`${categoryEmoji} New Insight for Review`),
      section(
        `*Category:* ${categoryLabel}\n` +
          `*Importance:* ${importanceEmoji} ${summary.importance.toUpperCase()}\n` +
          `*Confidence:* ${Math.round(summary.confidence * 100)}%`
      ),
      divider(),
      section(`*Content:*\n${summary.content}`),
    ];

    if (summary.extracted_quote) {
      blocks.push(section(`*Source Quote:*\n> ${summary.extracted_quote}`));
    }

    blocks.push(
      context(
        `Source: ${summary.source_type} | ` +
          `Validation ID: ${item.id} | ` +
          `Created: <!date^${Math.floor(new Date(item.created_at).getTime() / 1000)}^{date_short} {time}|${item.created_at}>`
      ),
      divider(),
      approveRejectActions(item.id)
    );

    return this.postMessage(
      this.config.validationChannel,
      blocks,
      `New ${categoryLabel} insight for review: ${summary.content.substring(0, 100)}...`
    );
  }

  /**
   * Send a reminder for a pending validation.
   */
  async sendValidationReminder(
    item: ValidationItem,
    reminderNumber: number
  ): Promise<SlackMessageResult> {
    const { insight_summary: summary } = item;
    const categoryEmoji = CATEGORY_EMOJI[summary.category];
    const categoryLabel = CATEGORY_LABELS[summary.category];

    const blocks: Block[] = [
      header(`⏰ Reminder: Insight Pending Review (#${reminderNumber})`),
      section(
        `*Category:* ${categoryEmoji} ${categoryLabel}\n` +
          `*Content Preview:* ${summary.content.substring(0, 200)}...`
      ),
      context(
        `Waiting since: <!date^${Math.floor(new Date(item.created_at).getTime() / 1000)}^{date_short} {time}|${item.created_at}>`
      ),
      divider(),
      approveRejectActions(item.id),
    ];

    return this.postMessage(
      this.config.validationChannel,
      blocks,
      `Reminder: ${categoryLabel} insight still pending review`
    );
  }

  /**
   * Update a validation message to show it's been processed.
   */
  async updateValidationProcessed(
    channel: string,
    ts: string,
    decision: 'approved' | 'rejected',
    validator: string,
    item: ValidationItem
  ): Promise<SlackMessageResult> {
    const { insight_summary: summary } = item;
    const categoryEmoji = CATEGORY_EMOJI[summary.category];
    const categoryLabel = CATEGORY_LABELS[summary.category];
    const decisionEmoji = decision === 'approved' ? '✅' : '❌';

    const blocks: Block[] = [
      header(`${decisionEmoji} Insight ${decision.charAt(0).toUpperCase() + decision.slice(1)}`),
      section(
        `*Category:* ${categoryEmoji} ${categoryLabel}\n` +
          `*Content:* ${summary.content.substring(0, 200)}...`
      ),
      context(
        `${decisionEmoji} ${decision.toUpperCase()} by <@${validator}> at ` +
          `<!date^${Math.floor(Date.now() / 1000)}^{date_short} {time}|now>`
      ),
    ];

    return this.updateMessage(channel, ts, blocks, `Insight ${decision} by ${validator}`);
  }

  // ===========================================
  // Weekly Synthesis Operations (FR-025, FR-026)
  // ===========================================

  /**
   * Send the weekly synthesis report.
   */
  async sendWeeklySynthesis(synthesis: WeeklySynthesis): Promise<SlackMessageResult> {
    const blocks: Block[] = [
      header('📊 Weekly Learning Loop Synthesis'),
      context(
        `Period: ${new Date(synthesis.period.start).toLocaleDateString()} - ` +
          `${new Date(synthesis.period.end).toLocaleDateString()} | ` +
          `Brain: ${synthesis.brain_id}`
      ),
      divider(),
    ];

    // Total insights section
    blocks.push(
      section(`*📈 Total Insights:* ${synthesis.overview.total_insights_extracted}`),
      section(
        `Validated: ${synthesis.overview.insights_validated} | ` +
          `Auto-approved: ${synthesis.overview.insights_auto_approved} | ` +
          `Rejected: ${synthesis.overview.insights_rejected}`
      )
    );

    // Category breakdown
    if (synthesis.category_stats.length > 0) {
      blocks.push(divider(), section('*📁 By Category:*'));

      for (const stats of synthesis.category_stats) {
        const emoji = CATEGORY_EMOJI[stats.category] || '📌';
        const label = CATEGORY_LABELS[stats.category] || stats.category;
        blocks.push(
          context(`${emoji} ${label}: ${stats.count} insights (avg confidence: ${Math.round(stats.avg_confidence * 100)}%)`)
        );
      }
    }

    // Top objections
    if (synthesis.top_objections.length > 0) {
      blocks.push(divider(), section('*🚫 Top Objections:*'));

      synthesis.top_objections.slice(0, 3).forEach((obj, i) => {
        blocks.push(context(`${i + 1}. "${obj.content}" (${obj.occurrence_count} occurrences)`));
      });
    }

    // Template performance
    if (synthesis.top_templates.length > 0) {
      blocks.push(divider(), section('*📝 Best Performing Templates:*'));

      synthesis.top_templates.slice(0, 3).forEach((tmpl, i) => {
        blocks.push(
          context(`${i + 1}. ${tmpl.template_name} - ${Math.round(tmpl.success_rate * 100)}% success rate`)
        );
      });
    }

    // ICP signals
    if (synthesis.icp_signals.length > 0) {
      blocks.push(divider(), section('*🎯 ICP Signals:*'));

      synthesis.icp_signals.slice(0, 3).forEach((signal) => {
        blocks.push(context(`• ${signal.description}`));
      });
    }

    // Competitive intel
    if (synthesis.competitive_intel.length > 0) {
      blocks.push(divider(), section('*🔍 Competitive Intelligence:*'));

      const competitors = synthesis.competitive_intel.map(c => c.competitor_name);
      if (competitors.length > 0) {
        blocks.push(
          context(`Competitors mentioned: ${competitors.join(', ')}`)
        );
      }

      synthesis.competitive_intel.slice(0, 2).forEach((intel) => {
        if (intel.positioning_opportunities.length > 0) {
          blocks.push(context(`• ${intel.positioning_opportunities[0]}`));
        }
      });
    }

    blocks.push(
      divider(),
      context(`Generated at <!date^${Math.floor(Date.now() / 1000)}^{date_short} {time}|now>`)
    );

    return this.postMessage(
      this.config.synthesisChannel,
      blocks,
      `Weekly Learning Loop Synthesis: ${synthesis.overview.total_insights_extracted} insights processed`
    );
  }

  /**
   * Send an alert for declining template performance.
   */
  async sendDecliningTemplateAlert(
    brainId: string,
    templateId: string,
    templateName: string,
    currentRate: number,
    previousRate: number
  ): Promise<SlackMessageResult> {
    const decline = Math.round((previousRate - currentRate) * 100);

    const blocks: Block[] = [
      header('⚠️ Template Performance Alert'),
      section(
        `Template *${templateName}* is showing declining performance.\n\n` +
          `*Current Success Rate:* ${Math.round(currentRate * 100)}%\n` +
          `*Previous Success Rate:* ${Math.round(previousRate * 100)}%\n` +
          `*Decline:* ${decline}pp`
      ),
      context(`Brain: ${brainId} | Template ID: ${templateId}`),
      divider(),
      section('_Consider reviewing this template or running A/B tests with alternatives._'),
    ];

    return this.postMessage(
      this.config.synthesisChannel,
      blocks,
      `Template "${templateName}" performance declined by ${decline}pp`
    );
  }

  // ===========================================
  // Utility Methods
  // ===========================================

  /**
   * Test connection to Slack.
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.callSlackApi('auth.test', {});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get bot info.
   */
  async getBotInfo(): Promise<{ userId: string; teamId: string } | null> {
    try {
      const result = await this.callSlackApi<{
        user_id: string;
        team_id: string;
      }>('auth.test', {});
      return {
        userId: result.user_id,
        teamId: result.team_id,
      };
    } catch {
      return null;
    }
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Learning Loop Slack client instance.
 */
export function createSlackClient(
  config?: Partial<SlackClientConfig>
): LearningLoopSlackClient {
  return new LearningLoopSlackClient(config);
}
