/**
 * Mock Server Bootstrap for E2E Testing
 *
 * Starts the Reply Handler server with mocked external dependencies.
 * Use this for E2E testing without requiring real API keys.
 *
 * Usage:
 *   bun run src/__tests__/reply-handler/fixtures/mock-server.ts
 *
 * @module __tests__/reply-handler/fixtures/mock-server
 */

import { mock } from 'bun:test';
import { createReplyHandlerAgent } from '../../../reply-handler/agent';
import { createWebhookServer } from '../../../reply-handler/webhook';
import { createMockEmbedder } from '../../../reply-handler/embedder';
import { createMockMcpBridge } from '../../../reply-handler/mcp-bridge';
import type { SlackInteractivePayload } from '../../../reply-handler/slack-flow';
import { MOCK_CLASSIFICATIONS, MOCK_KB_TEMPLATES } from './index';

// ===========================================
// Configuration
// ===========================================

const TEST_PORT = parseInt(process.env.TEST_PORT ?? '3099', 10);
const WEBHOOK_SECRET = process.env.INSTANTLY_WEBHOOK_SECRET ?? 'test_webhook_secret';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? 'test_slack_secret';
const DEFAULT_BRAIN_ID = process.env.DEFAULT_BRAIN_ID ?? 'brain_fintech';

// ===========================================
// Mock Factories
// ===========================================

/**
 * Creates a mock Anthropic client that returns configurable classifications
 */
function createMockAnthropicClient() {
  // Track call count for different behaviors
  let callCount = 0;

  return {
    messages: {
      create: mock(async (params: { messages: Array<{ content: string }> }) => {
        callCount++;

        // Detect intent from the user message content
        const userContent = params.messages[0]?.content ?? '';
        const lowerContent = userContent.toLowerCase();

        let classification = MOCK_CLASSIFICATIONS.positive_interest;

        if (lowerContent.includes('budget') || lowerContent.includes('quarter')) {
          classification = MOCK_CLASSIFICATIONS.objection;
        } else if (lowerContent.includes('question') || lowerContent.includes('integrate') || lowerContent.includes('soc2')) {
          classification = MOCK_CLASSIFICATIONS.question;
        } else if (lowerContent.includes('not the right person') || lowerContent.includes('procurement')) {
          classification = MOCK_CLASSIFICATIONS.referral;
        } else if (lowerContent.includes('out of office') || lowerContent.includes('vacation')) {
          classification = MOCK_CLASSIFICATIONS.out_of_office;
        } else if (lowerContent.includes('unsubscribe') || lowerContent.includes('remove me')) {
          classification = MOCK_CLASSIFICATIONS.unsubscribe;
        } else if (lowerContent.includes('not interested') || lowerContent.includes('no thanks')) {
          classification = MOCK_CLASSIFICATIONS.not_interested;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(classification),
            },
          ],
          usage: {
            input_tokens: 150,
            output_tokens: 100,
          },
        };
      }),
    },
  };
}

/**
 * Creates a mock Qdrant client that returns KB templates
 */
function createMockQdrantClient() {
  return {
    search: mock(async (collection: string, params: { filter?: { must?: Array<{ key: string; match: { value: string } }> } }) => {
      // Determine which template to return based on collection/filter
      const replyType = params.filter?.must?.find(f => f.key === 'reply_type')?.match?.value;
      const objectionType = params.filter?.must?.find(f => f.key === 'objection_type')?.match?.value;

      if (collection === 'objection_handlers' || objectionType) {
        return [MOCK_KB_TEMPLATES.objection_budget];
      }

      if (replyType === 'positive_response') {
        return [MOCK_KB_TEMPLATES.positive_interest];
      }

      if (replyType === 'answer_question') {
        return [MOCK_KB_TEMPLATES.question];
      }

      // Default to positive template
      return [MOCK_KB_TEMPLATES.positive_interest];
    }),
    count: mock(async () => ({ count: 25 })),
    getCollections: mock(async () => ({
      collections: [
        { name: 'response_templates' },
        { name: 'objection_handlers' },
      ],
    })),
  };
}

/**
 * Creates a mock Slack client
 */
function createMockSlackClient() {
  const postedMessages: Array<{ channel: string; text: string; blocks?: unknown }> = [];

  return {
    chat: {
      postMessage: mock(async (params: { channel: string; text: string; blocks?: unknown }) => {
        postedMessages.push(params);
        console.log(`[Slack Mock] Posted message to ${params.channel}`);
        return { ok: true, ts: `mock_ts_${Date.now()}` };
      }),
    },
    views: {
      open: mock(async (params: { trigger_id: string; view: unknown }) => {
        console.log(`[Slack Mock] Opened modal for trigger ${params.trigger_id}`);
        return { ok: true };
      }),
    },
    // Expose for test assertions
    _postedMessages: postedMessages,
  };
}

// ===========================================
// Server Bootstrap
// ===========================================

async function startMockServer() {
  console.log('Starting Reply Handler Mock Server...\n');
  console.log(`Port: ${TEST_PORT}`);
  console.log(`Brain ID: ${DEFAULT_BRAIN_ID}`);
  console.log('Mode: Mock (no real API calls)\n');

  // Create mock clients
  const anthropic = createMockAnthropicClient();
  const qdrant = createMockQdrantClient();
  const slack = createMockSlackClient();
  const embedder = createMockEmbedder(1024);
  const callMcpTool = createMockMcpBridge();

  console.log('Mock clients created');

  // Create the agent with mock dependencies
  const agent = createReplyHandlerAgent({
    anthropicClient: anthropic as any,
    qdrantClient: qdrant as any,
    embedder,
    callMcpTool,
    slackClient: slack as any,
    slackChannels: {
      approvals: 'C_MOCK_APPROVALS',
      escalations: 'C_MOCK_ESCALATIONS',
    },
    senderName: 'Test Sender',
    meetingLink: 'https://calendly.com/test/demo',
  });

  console.log('Agent created');

  // Create Slack action handler
  const handleSlackAction = async (
    payload: SlackInteractivePayload
  ): Promise<{ action: string; success: boolean; error?: string }> => {
    const userId = payload.user?.username ?? payload.user?.id ?? 'unknown';

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
          error: 'Invalid action format',
        };
      }

      switch (actionType) {
        case 'approve_draft': {
          const result = await agent.approveDraft(draftId, userId);
          return { action: 'approve', success: result.success, error: result.error };
        }
        case 'reject_draft': {
          const result = await agent.rejectDraft(draftId, userId);
          return { action: 'reject', success: result.success, error: result.error };
        }
        case 'edit_draft': {
          return { action: 'edit_modal', success: true };
        }
        default:
          return { action: actionType, success: false, error: 'Unknown action' };
      }
    }

    if (payload.type === 'view_submission' && payload.view) {
      if (payload.view.callback_id === 'edit_draft_modal') {
        let metadata: { draftId?: string };
        try {
          metadata = JSON.parse(payload.view.private_metadata || '{}');
        } catch {
          return { action: 'edit_submit', success: false, error: 'Invalid metadata' };
        }

        if (!metadata.draftId) {
          return { action: 'edit_submit', success: false, error: 'Missing draft ID' };
        }

        const stateValues = payload.view.state?.values ?? {};
        let editedContent: string | undefined;

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
          return { action: 'edit_submit', success: false, error: 'No content' };
        }

        const result = await agent.approveWithEdits(metadata.draftId, editedContent, userId);
        return { action: 'approve_with_edits', success: result.success, error: result.error };
      }
    }

    return { action: 'unknown', success: false, error: 'Unknown payload type' };
  };

  // Start webhook server
  const server = createWebhookServer({
    port: TEST_PORT,
    brainId: DEFAULT_BRAIN_ID,
    instantlySecret: WEBHOOK_SECRET,
    slackSigningSecret: SLACK_SIGNING_SECRET,
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
  console.log(`Reply Handler Mock Server Running!`);
  console.log(`========================================\n`);
  console.log(`Health Check:  http://localhost:${TEST_PORT}/health`);
  console.log(`Reply Webhook: http://localhost:${TEST_PORT}/webhook/reply`);
  console.log(`Slack Webhook: http://localhost:${TEST_PORT}/webhook/slack`);
  console.log(`\nWebhook Secret: ${WEBHOOK_SECRET}`);
  console.log(`\nPress Ctrl+C to stop the server.\n`);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down mock server...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down mock server...');
    server.stop();
    process.exit(0);
  });

  return { server, agent, slack };
}

// Run if executed directly
startMockServer().catch((error) => {
  console.error('Failed to start mock server:', error);
  process.exit(1);
});

export { startMockServer };
