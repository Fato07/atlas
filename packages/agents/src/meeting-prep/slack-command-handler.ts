/**
 * Slack Slash Command Handler
 *
 * Handles Slack slash commands for on-demand brief generation.
 * Triggered by n8n which receives the Slack slash command webhook.
 *
 * Supported formats:
 * - /brief john@acme.com - Generate brief for upcoming meeting with this lead
 * - /brief MTG-12345 - Generate brief for specific meeting ID
 *
 * Implements FR-007 (manual brief request via Slack).
 *
 * @module meeting-prep/slack-command-handler
 */

import type { BrainId } from '@atlas-gtm/lib';
import type { MeetingPrepAgent } from './agent';
import type { MeetingPrepLogger } from './logger';

// ===========================================
// Types
// ===========================================

/**
 * Slack slash command payload (subset of fields we use)
 */
export interface SlackSlashCommandPayload {
  /** Slack command (e.g., "/brief") */
  command: string;
  /** Command arguments text (e.g., "john@acme.com" or "MTG-12345") */
  text: string;
  /** Slack user ID who invoked the command */
  user_id: string;
  /** Slack user name */
  user_name: string;
  /** Channel where command was invoked */
  channel_id: string;
  /** Unique response URL for async responses */
  response_url: string;
  /** Trigger ID for interactive messages */
  trigger_id?: string;
  /** Team ID */
  team_id: string;
  /** Team domain */
  team_domain?: string;
}

/**
 * Parsed command from slash command text
 */
export interface ParsedSlashCommand {
  /** Type of identifier provided */
  type: 'email' | 'meeting_id';
  /** The identifier value */
  value: string;
}

/**
 * Slash command handler configuration
 */
export interface SlashCommandHandlerConfig {
  /** Brain ID to use for brief generation */
  brainId: BrainId;
  /** Slack channel for brief delivery (optional, defaults to command channel) */
  deliveryChannel?: string;
}

/**
 * Slash command handler dependencies
 */
export interface SlashCommandHandlerDependencies {
  /** Meeting prep agent instance */
  agent: MeetingPrepAgent;
  /** Logger instance */
  logger: MeetingPrepLogger;
}

/**
 * Immediate acknowledgment response for Slack
 */
export interface SlackAckResponse {
  /** Response type - "ephemeral" only visible to user, "in_channel" visible to all */
  response_type: 'ephemeral' | 'in_channel';
  /** Message text */
  text: string;
}

/**
 * Command handling result
 */
export interface HandleCommandResult {
  /** Whether the command was valid and processing started */
  success: boolean;
  /** Immediate acknowledgment to send to Slack */
  ack: SlackAckResponse;
  /** Error message if parsing failed */
  error?: string;
}

// ===========================================
// Constants
// ===========================================

/** Email regex pattern */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Meeting ID patterns (adjust based on your ID format) */
const MEETING_ID_PATTERNS = [
  /^[a-zA-Z0-9_-]{10,}$/, // Generic alphanumeric ID
  /^MTG-\d+$/i, // MTG-12345 format
  /^manual_\d+$/, // Manual meeting IDs
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID format
];

// ===========================================
// Slash Command Handler
// ===========================================

export class SlackSlashCommandHandler {
  private readonly config: SlashCommandHandlerConfig;
  private readonly deps: SlashCommandHandlerDependencies;

  constructor(
    deps: SlashCommandHandlerDependencies,
    config: SlashCommandHandlerConfig
  ) {
    this.deps = deps;
    this.config = config;
  }

  /**
   * Handle a Slack slash command.
   *
   * Returns an immediate acknowledgment and triggers async brief generation.
   */
  async handle(payload: SlackSlashCommandPayload): Promise<HandleCommandResult> {
    this.deps.logger.debug('Handling Slack slash command', {
      command: payload.command,
      text: payload.text,
      user: payload.user_name,
      channel: payload.channel_id,
    });

    // Parse the command text
    const parsed = this.parseCommandText(payload.text.trim());

    if (!parsed) {
      return {
        success: false,
        ack: {
          response_type: 'ephemeral',
          text: `:warning: Invalid format. Usage:\n` +
            `• \`/brief john@acme.com\` - Generate brief for lead's upcoming meeting\n` +
            `• \`/brief MTG-12345\` - Generate brief for specific meeting`,
        },
        error: 'Invalid command format',
      };
    }

    // Log the command
    this.deps.logger.info('Slash command received', {
      type: parsed.type,
      value: parsed.value,
      user: payload.user_name,
      channel: payload.channel_id,
    });

    // Trigger async brief generation
    // Don't await - we need to respond to Slack within 3 seconds
    this.triggerBriefGeneration(parsed, payload).catch((error) => {
      this.deps.logger.error('Async brief generation failed', {
        error: error instanceof Error ? error.message : String(error),
        type: parsed.type,
        value: parsed.value,
      });
    });

    // Return immediate acknowledgment
    const ackMessage = parsed.type === 'email'
      ? `:hourglass_flowing_sand: Generating brief for meeting with *${parsed.value}*...`
      : `:hourglass_flowing_sand: Generating brief for meeting *${parsed.value}*...`;

    return {
      success: true,
      ack: {
        response_type: 'ephemeral',
        text: ackMessage + '\n\nYou will receive the brief in the meeting-briefs channel shortly.',
      },
    };
  }

  /**
   * Parse command text to extract email or meeting ID.
   */
  private parseCommandText(text: string): ParsedSlashCommand | null {
    if (!text) {
      return null;
    }

    // Check if it's an email
    if (EMAIL_PATTERN.test(text)) {
      return {
        type: 'email',
        value: text.toLowerCase(),
      };
    }

    // Check if it matches any meeting ID pattern
    for (const pattern of MEETING_ID_PATTERNS) {
      if (pattern.test(text)) {
        return {
          type: 'meeting_id',
          value: text,
        };
      }
    }

    return null;
  }

  /**
   * Trigger async brief generation.
   */
  private async triggerBriefGeneration(
    parsed: ParsedSlashCommand,
    payload: SlackSlashCommandPayload
  ): Promise<void> {
    const request = parsed.type === 'email'
      ? { attendee_email: parsed.value, brain_id: this.config.brainId }
      : { meeting_id: parsed.value, brain_id: this.config.brainId };

    this.deps.logger.debug('Triggering async brief generation', {
      request,
      response_url: payload.response_url,
    });

    try {
      const result = await this.deps.agent.generateBriefManual(request);

      // If we have a response_url, we could send a follow-up message
      // For now, the brief will be delivered to the configured Slack channel
      this.deps.logger.info('Brief generation completed via slash command', {
        success: result.success,
        brief_id: result.brief_id,
        status: result.status,
        message: result.message,
      });
    } catch (error) {
      this.deps.logger.error('Brief generation failed', {
        error: error instanceof Error ? error.message : String(error),
        parsed,
      });

      // Optionally: Send error message to response_url
      // await this.sendFollowUpMessage(payload.response_url, {
      //   response_type: 'ephemeral',
      //   text: `:x: Failed to generate brief: ${error.message}`,
      // });
    }
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Slack slash command handler instance.
 */
export function createSlashCommandHandler(
  deps: SlashCommandHandlerDependencies,
  config: SlashCommandHandlerConfig
): SlackSlashCommandHandler {
  return new SlackSlashCommandHandler(deps, config);
}

// ===========================================
// Webhook Handler Helper
// ===========================================

/**
 * Parse Slack form-urlencoded body to command payload.
 *
 * Slack sends slash command data as application/x-www-form-urlencoded.
 */
export function parseSlackCommandBody(body: string): SlackSlashCommandPayload | null {
  try {
    const params = new URLSearchParams(body);

    const command = params.get('command');
    const text = params.get('text');
    const user_id = params.get('user_id');
    const user_name = params.get('user_name');
    const channel_id = params.get('channel_id');
    const response_url = params.get('response_url');
    const team_id = params.get('team_id');

    if (!command || !user_id || !user_name || !channel_id || !response_url || !team_id) {
      return null;
    }

    return {
      command,
      text: text || '',
      user_id,
      user_name,
      channel_id,
      response_url,
      team_id,
      trigger_id: params.get('trigger_id') || undefined,
      team_domain: params.get('team_domain') || undefined,
    };
  } catch {
    return null;
  }
}
