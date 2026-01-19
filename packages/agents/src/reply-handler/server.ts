/**
 * Reply Handler Agent - Server Entry Point
 *
 * Initializes all clients and starts the webhook server.
 * This is the main entry point for running the Reply Handler Agent.
 *
 * Usage:
 *   bun run src/reply-handler/server.ts
 *
 * Required environment variables:
 *   ANTHROPIC_API_KEY    - Anthropic API key for Claude
 *   VOYAGE_API_KEY       - Voyage AI API key for embeddings
 *   QDRANT_URL           - Qdrant server URL
 *   SLACK_BOT_TOKEN      - Slack bot token
 *   SLACK_SIGNING_SECRET - Slack signing secret
 *   SLACK_APPROVAL_CHANNEL    - Slack channel for approvals
 *   SLACK_ESCALATION_CHANNEL  - Slack channel for escalations
 *   INSTANTLY_WEBHOOK_SECRET  - Instantly webhook secret
 *   MCP_SERVER_URL       - MCP server URL
 *   DEFAULT_BRAIN_ID     - Default brain ID for processing
 *
 * @module reply-handler/server
 */

import Anthropic from '@anthropic-ai/sdk';
import { QdrantClient } from '@qdrant/js-client-rest';
import { WebClient } from '@slack/web-api';

import { createReplyHandlerAgent, ReplyHandlerAgent } from './agent';
import { createWebhookServer } from './webhook';
import { createMcpBridge } from './mcp-bridge';
import { createVoyageEmbedder } from './embedder';
import type { SlackInteractivePayload } from './slack-flow';

// ===========================================
// Environment Variables
// ===========================================

interface EnvConfig {
  // AI Services
  anthropicApiKey: string;
  voyageApiKey: string;

  // Vector DB
  qdrantUrl: string;

  // Slack
  slackBotToken: string;
  slackSigningSecret: string;
  slackApprovalChannel: string;
  slackEscalationChannel: string;

  // Instantly
  instantlyWebhookSecret: string;

  // MCP Server
  mcpServerUrl: string;

  // Reply Handler
  defaultBrainId: string;
  port: number;

  // Optional
  senderName?: string;
  meetingLink?: string;
}

function loadEnvConfig(): EnvConfig {
  const required = [
    'ANTHROPIC_API_KEY',
    'VOYAGE_API_KEY',
    'QDRANT_URL',
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_APPROVAL_CHANNEL',
    'SLACK_ESCALATION_CHANNEL',
    'INSTANTLY_WEBHOOK_SECRET',
    'MCP_SERVER_URL',
    'DEFAULT_BRAIN_ID',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    voyageApiKey: process.env.VOYAGE_API_KEY!,
    qdrantUrl: process.env.QDRANT_URL!,
    slackBotToken: process.env.SLACK_BOT_TOKEN!,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET!,
    slackApprovalChannel: process.env.SLACK_APPROVAL_CHANNEL!,
    slackEscalationChannel: process.env.SLACK_ESCALATION_CHANNEL!,
    instantlyWebhookSecret: process.env.INSTANTLY_WEBHOOK_SECRET!,
    mcpServerUrl: process.env.MCP_SERVER_URL!,
    defaultBrainId: process.env.DEFAULT_BRAIN_ID!,
    port: parseInt(process.env.REPLY_HANDLER_PORT ?? '3002', 10),
    senderName: process.env.SENDER_NAME,
    meetingLink: process.env.MEETING_LINK,
  };
}

// ===========================================
// Client Initialization
// ===========================================

function initializeClients(config: EnvConfig) {
  console.log('Initializing clients...');

  // Anthropic client for Claude
  const anthropic = new Anthropic({
    apiKey: config.anthropicApiKey,
  });

  // Qdrant client for KB
  const qdrant = new QdrantClient({
    url: config.qdrantUrl,
  });

  // Slack Web API client
  const slack = new WebClient(config.slackBotToken);

  // Voyage AI embedder
  const embedder = createVoyageEmbedder({
    apiKey: config.voyageApiKey,
    model: 'voyage-3-lite',
  });

  // MCP bridge function
  const callMcpTool = createMcpBridge({
    baseUrl: config.mcpServerUrl,
    timeout: 30000,
  });

  console.log('Clients initialized successfully');

  return {
    anthropic,
    qdrant,
    slack,
    embedder,
    callMcpTool,
  };
}

// ===========================================
// Slack Action Handler
// ===========================================

/**
 * Create a Slack action handler that bridges to the agent's draft methods.
 *
 * Action IDs:
 * - approve_draft::{draftId}  - Approve draft as-is
 * - edit_draft::{draftId}     - Open edit modal
 * - reject_draft::{draftId}   - Reject draft
 * - escalate_draft::{draftId} - Escalate to human
 */
function createSlackActionHandler(agent: ReplyHandlerAgent) {
  return async (
    payload: SlackInteractivePayload
  ): Promise<{ action: string; success: boolean; error?: string }> => {
    const userId = payload.user?.username ?? payload.user?.id ?? 'unknown';

    // Handle block_actions (button clicks)
    if (payload.type === 'block_actions' && payload.actions) {
      const action = payload.actions[0];
      if (!action) {
        return { action: 'none', success: false, error: 'No action provided' };
      }

      const [actionType, draftId] = action.action_id.split('::');

      if (!draftId) {
        return {
          action: actionType,
          success: false,
          error: 'Invalid action format - missing draft ID',
        };
      }

      switch (actionType) {
        case 'approve_draft': {
          const result = await agent.approveDraft(draftId, userId);
          return {
            action: 'approve',
            success: result.success,
            error: result.error,
          };
        }

        case 'reject_draft': {
          const result = await agent.rejectDraft(draftId, userId);
          return {
            action: 'reject',
            success: result.success,
            error: result.error,
          };
        }

        case 'edit_draft': {
          // Edit triggers a modal - return success to open it
          // The actual edit submission will come as view_submission
          return { action: 'edit_modal', success: true };
        }

        case 'escalate_draft': {
          const result = await agent.rejectDraft(draftId, userId);
          return {
            action: 'escalate',
            success: result.success,
            error: result.error,
          };
        }

        default:
          return {
            action: actionType,
            success: false,
            error: `Unknown action type: ${actionType}`,
          };
      }
    }

    // Handle view_submission (modal form submission)
    if (payload.type === 'view_submission' && payload.view) {
      const callbackId = payload.view.callback_id;

      if (callbackId === 'edit_draft_modal') {
        // Parse private_metadata for draft ID
        let metadata: { draftId?: string };
        try {
          metadata = JSON.parse(payload.view.private_metadata || '{}');
        } catch {
          return {
            action: 'edit_submit',
            success: false,
            error: 'Invalid modal metadata',
          };
        }

        if (!metadata.draftId) {
          return {
            action: 'edit_submit',
            success: false,
            error: 'Missing draft ID in modal metadata',
          };
        }

        // Extract edited content from modal state
        const stateValues = payload.view.state?.values ?? {};
        let editedContent: string | undefined;

        // Find the edited text input
        for (const blockId in stateValues) {
          const block = stateValues[blockId];
          for (const actionId in block) {
            const field = block[actionId];
            if (field.type === 'plain_text_input' && field.value) {
              editedContent = field.value;
              break;
            }
          }
          if (editedContent) break;
        }

        if (!editedContent) {
          return {
            action: 'edit_submit',
            success: false,
            error: 'No edited content provided',
          };
        }

        const result = await agent.approveWithEdits(
          metadata.draftId,
          editedContent,
          userId
        );

        return {
          action: 'approve_with_edits',
          success: result.success,
          error: result.error,
        };
      }

      return {
        action: 'view_submission',
        success: false,
        error: `Unknown callback ID: ${callbackId}`,
      };
    }

    return {
      action: 'unknown',
      success: false,
      error: `Unknown payload type: ${payload.type}`,
    };
  };
}

// ===========================================
// Main Entry Point
// ===========================================

async function main() {
  console.log('Starting Reply Handler Agent Server...\n');

  // Load environment configuration
  const envConfig = loadEnvConfig();
  console.log(`Port: ${envConfig.port}`);
  console.log(`Default Brain: ${envConfig.defaultBrainId}`);
  console.log(`Qdrant URL: ${envConfig.qdrantUrl}`);
  console.log(`MCP Server: ${envConfig.mcpServerUrl}\n`);

  // Initialize clients
  const clients = initializeClients(envConfig);

  // Create the agent
  console.log('Creating Reply Handler Agent...');
  const agent = createReplyHandlerAgent({
    anthropicClient: clients.anthropic,
    qdrantClient: clients.qdrant,
    embedder: clients.embedder,
    callMcpTool: clients.callMcpTool,
    slackClient: clients.slack,
    slackChannels: {
      approvals: envConfig.slackApprovalChannel,
      escalations: envConfig.slackEscalationChannel,
    },
    senderName: envConfig.senderName,
    meetingLink: envConfig.meetingLink,
  });
  console.log('Agent created successfully\n');

  // Create Slack action handler
  const handleSlackAction = createSlackActionHandler(agent);

  // Start webhook server
  console.log('Starting webhook server...');
  const server = createWebhookServer({
    port: envConfig.port,
    brainId: envConfig.defaultBrainId,
    instantlySecret: envConfig.instantlyWebhookSecret,
    slackSigningSecret: envConfig.slackSigningSecret,
    handleReply: (input) => agent.processReply(input),
    handleSlackAction,
    getDraftStatus: (draftId) => {
      const draft = agent.getDraft(draftId);
      if (!draft) return Promise.resolve(null);
      return Promise.resolve({
        status: draft.status,
        createdAt: draft.created_at,
        expiresAt: draft.expires_at,
        resolvedAt: draft.approved_at,
        resolvedBy: draft.approved_by,
      });
    },
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
    },
  });

  console.log(`\n========================================`);
  console.log(`Reply Handler Agent Server is running!`);
  console.log(`========================================\n`);
  console.log(`Health Check:  http://localhost:${envConfig.port}/health`);
  console.log(`Reply Webhook: http://localhost:${envConfig.port}/webhook/reply`);
  console.log(`Slack Webhook: http://localhost:${envConfig.port}/webhook/slack`);
  console.log(`\nPress Ctrl+C to stop the server.\n`);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down server...');
    server.stop();
    process.exit(0);
  });
}

// Run the server
main().catch((error) => {
  console.error('Failed to start Reply Handler Agent:', error);
  process.exit(1);
});

// ===========================================
// Export for programmatic usage
// ===========================================

export {
  loadEnvConfig,
  initializeClients,
  createSlackActionHandler,
  type EnvConfig,
};
