/**
 * Meeting Prep Agent - Server Entry Point
 *
 * Initializes all clients and starts the webhook server.
 * This is the main entry point for running the Meeting Prep Agent.
 *
 * Usage:
 *   bun run src/meeting-prep/server.ts
 *
 * Required environment variables:
 *   ANTHROPIC_API_KEY       - Anthropic API key for Claude
 *   VOYAGE_API_KEY          - Voyage AI API key for embeddings
 *   QDRANT_URL              - Qdrant server URL
 *   SLACK_BOT_TOKEN         - Slack bot token
 *   SLACK_BRIEF_CHANNEL     - Slack channel for briefs
 *   MEETING_PREP_SECRET     - Webhook authentication secret
 *   MCP_SERVER_URL          - MCP server URL
 *   DEFAULT_BRAIN_ID        - Default brain ID for processing
 *
 * @module meeting-prep/server
 */

import Anthropic from '@anthropic-ai/sdk';
import { QdrantClient } from '@qdrant/js-client-rest';
import { WebClient } from '@slack/web-api';
import type { BrainId } from '@atlas-gtm/lib';

import { createAndInitMeetingPrepAgent, MeetingPrepAgent } from './agent';
import { createWebhookServer } from './webhook';

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
  slackBriefChannel: string;

  // MCP Server
  mcpServerUrl: string;

  // Meeting Prep
  defaultBrainId: string;
  webhookSecret: string;
  port: number;

  // Optional
  statePath?: string;
}

function loadEnvConfig(): EnvConfig {
  const required = [
    'ANTHROPIC_API_KEY',
    'VOYAGE_API_KEY',
    'QDRANT_URL',
    'SLACK_BOT_TOKEN',
    'SLACK_BRIEF_CHANNEL',
    'MEETING_PREP_SECRET',
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
    slackBriefChannel: process.env.SLACK_BRIEF_CHANNEL!,
    webhookSecret: process.env.MEETING_PREP_SECRET!,
    mcpServerUrl: process.env.MCP_SERVER_URL!,
    defaultBrainId: process.env.DEFAULT_BRAIN_ID!,
    port: parseInt(process.env.MEETING_PREP_PORT ?? '3003', 10),
    statePath: process.env.MEETING_PREP_STATE_PATH,
  };
}

// ===========================================
// Voyage AI Embedder
// ===========================================

interface VoyageEmbedderConfig {
  apiKey: string;
  model?: string;
}

function createVoyageEmbedder(config: VoyageEmbedderConfig): (text: string) => Promise<number[]> {
  const model = config.model ?? 'voyage-3-lite';

  return async (text: string): Promise<number[]> => {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        model,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Voyage AI error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0].embedding;
  };
}

// ===========================================
// MCP Bridge
// ===========================================

interface McpBridgeConfig {
  baseUrl: string;
  timeout?: number;
}

function createMcpBridge(config: McpBridgeConfig) {
  const timeout = config.timeout ?? 30000;

  return async <T>(tool: string, params: Record<string, unknown>): Promise<T> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${config.baseUrl}/tools/${tool}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`MCP tool error: ${response.status} - ${error}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeoutId);
    }
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
// Main Entry Point
// ===========================================

async function main() {
  console.log('Starting Meeting Prep Agent Server...\n');

  // Load environment configuration
  const envConfig = loadEnvConfig();
  console.log(`Port: ${envConfig.port}`);
  console.log(`Default Brain: ${envConfig.defaultBrainId}`);
  console.log(`Qdrant URL: ${envConfig.qdrantUrl}`);
  console.log(`MCP Server: ${envConfig.mcpServerUrl}`);
  console.log(`Slack Brief Channel: ${envConfig.slackBriefChannel}\n`);

  // Initialize clients
  const clients = initializeClients(envConfig);

  // Create and initialize the agent
  console.log('Creating Meeting Prep Agent...');
  const agent = await createAndInitMeetingPrepAgent({
    brainId: envConfig.defaultBrainId as BrainId,
    anthropicClient: clients.anthropic,
    qdrantClient: clients.qdrant,
    embedder: clients.embedder,
    callMcpTool: clients.callMcpTool,
    slackClient: clients.slack,
    slackBriefChannel: envConfig.slackBriefChannel,
    statePath: envConfig.statePath,
  });
  console.log('Agent created and initialized successfully\n');

  // Start webhook server
  console.log('Starting webhook server...');
  const server = createWebhookServer({
    port: envConfig.port,
    webhookSecret: envConfig.webhookSecret,
    agent,
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
    },
  });

  console.log(`\n========================================`);
  console.log(`Meeting Prep Agent Server is running!`);
  console.log(`========================================\n`);
  console.log(`Health Check:    http://localhost:${envConfig.port}/webhook/meeting-prep/health`);
  console.log(`Brief Webhook:   http://localhost:${envConfig.port}/webhook/meeting-prep/brief`);
  console.log(`Manual Brief:    http://localhost:${envConfig.port}/webhook/meeting-prep/brief/manual`);
  console.log(`Analyze:         http://localhost:${envConfig.port}/webhook/meeting-prep/analyze`);
  console.log(`\nPress Ctrl+C to stop the server.\n`);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down server...');
    server.stop();
    await agent.shutdown();
    console.log('Agent shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run the server
main().catch((error) => {
  console.error('Failed to start Meeting Prep Agent:', error);
  process.exit(1);
});

// ===========================================
// Export for programmatic usage
// ===========================================

export {
  loadEnvConfig,
  initializeClients,
  createVoyageEmbedder,
  createMcpBridge,
  type EnvConfig,
  type VoyageEmbedderConfig,
  type McpBridgeConfig,
};
