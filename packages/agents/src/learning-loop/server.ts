/**
 * Learning Loop Agent - Server Entry Point
 *
 * Initializes all clients and starts the webhook server.
 * This is the main entry point for running the Learning Loop Agent.
 *
 * Usage:
 *   bun run src/learning-loop/server.ts
 *
 * Required environment variables:
 *   QDRANT_URL                   - Qdrant server URL
 *   UPSTASH_REDIS_REST_URL       - Upstash Redis REST URL
 *   UPSTASH_REDIS_REST_TOKEN     - Upstash Redis REST token
 *   SLACK_BOT_TOKEN              - Slack bot token
 *   ANTHROPIC_API_KEY            - Anthropic API key for Claude
 *   VOYAGE_API_KEY               - Voyage AI API key for embeddings
 *   WEBHOOK_SECRET               - Webhook authentication secret
 *
 * Optional environment variables:
 *   LEARNING_LOOP_PORT                    - Port to listen on (default: 4004)
 *   DEFAULT_BRAIN_ID                      - Default brain ID for processing
 *   LEARNING_LOOP_VALIDATION_CHANNEL      - Slack channel for validations
 *   LEARNING_LOOP_SYNTHESIS_CHANNEL       - Slack channel for synthesis reports
 *
 * @module learning-loop/server
 */

import { loadEnvConfig, loadConfig, type EnvConfig } from './config';
import {
  createLearningLoopAgent,
  createAndInitializeLearningLoopAgent,
  type LearningLoopAgent,
} from './agent';
import {
  LearningLoopWebhookRouter,
  createWebhookRouter,
  type RequestContext,
  type ResponseContext,
} from './webhook';
import {
  type InsightExtractionRequest,
  type InsightExtractionResponse,
  type ValidationCallbackRequest,
  type ValidationCallbackResponse,
  type SynthesisRequest,
  type SynthesisResponse,
  type TemplateOutcomeRequest,
  type TemplateOutcomeResponse,
  type HealthCheckResponse,
} from './contracts';
import { getLogger, createLogger, setLogger } from './logger';

// ===========================================
// Server Configuration
// ===========================================

interface ServerConfig {
  port: number;
  webhookSecret: string;
  defaultBrainId: string;
}

function loadServerConfig(): ServerConfig {
  return {
    port: parseInt(process.env.LEARNING_LOOP_PORT ?? '4004', 10),
    webhookSecret: process.env.WEBHOOK_SECRET ?? '',
    defaultBrainId: process.env.DEFAULT_BRAIN_ID ?? '',
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
  const model = config.model ?? 'voyage-3';

  return async (text: string): Promise<number[]> => {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
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

    const data = (await response.json()) as {
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

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

// ===========================================
// Server State
// ===========================================

interface ServerState {
  startTime: number;
  processedToday: number;
  errorsToday: number;
  insightsExtracted: number;
  validationsProcessed: number;
}

const serverState: ServerState = {
  startTime: Date.now(),
  processedToday: 0,
  errorsToday: 0,
  insightsExtracted: 0,
  validationsProcessed: 0,
};

// ===========================================
// Request Handlers
// ===========================================

function handleCors(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  return null;
}

function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function buildHealthResponse(agent: LearningLoopAgent | null): HealthCheckResponse {
  const uptimeSeconds = Math.floor((Date.now() - serverState.startTime) / 1000);

  const stats = agent?.getStats();

  return {
    status: agent ? 'healthy' : 'degraded',
    version: '1.0.0',
    uptime_seconds: uptimeSeconds,
    dependencies: {
      qdrant: 'connected',
      redis: 'connected',
      slack: 'connected',
    },
    metrics: {
      insights_processed_24h: stats?.insightsExtracted ?? serverState.insightsExtracted,
      validations_pending: stats?.pendingValidations ?? 0,
      avg_extraction_ms: stats?.avgExtractionMs ?? 0,
    },
  };
}

// ===========================================
// Main Server
// ===========================================

async function main() {
  console.log('Starting Learning Loop Agent Server...\n');

  // Setup logger
  const logger = createLogger({ level: 'info' });
  setLogger(logger);

  // Load configurations
  const serverConfig = loadServerConfig();
  console.log(`Port: ${serverConfig.port}`);
  console.log(`Default Brain: ${serverConfig.defaultBrainId || 'not set'}\n`);

  let envConfig: EnvConfig;
  try {
    envConfig = loadEnvConfig();
    console.log(`Qdrant URL: ${envConfig.qdrant_url}`);
    console.log(`Redis URL: ${envConfig.redis_url.substring(0, 30)}...`);
    console.log(`Slack: configured\n`);
  } catch (error) {
    console.error('Failed to load environment configuration:', error);
    console.log('\nStarting in degraded mode (health endpoint only)...\n');

    // Start server in degraded mode
    const server = Bun.serve({
      port: serverConfig.port,
      async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        const corsResponse = handleCors(request);
        if (corsResponse) return corsResponse;

        if (path === '/health' || path === '/webhook/learning-loop/health') {
          const health = buildHealthResponse(null);
          health.status = 'unhealthy';
          health.dependencies = {
            qdrant: 'disconnected',
            redis: 'disconnected',
            slack: 'disconnected',
          };
          return addCorsHeaders(
            new Response(JSON.stringify(health), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        return addCorsHeaders(
          new Response(JSON.stringify({ error: 'Service unavailable - configuration error' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      },
    });

    console.log(`\n========================================`);
    console.log(`Learning Loop Agent Server (DEGRADED)`);
    console.log(`========================================\n`);
    console.log(`Health Check: http://localhost:${serverConfig.port}/health`);
    console.log(`\nServer is in degraded mode - fix configuration to enable full functionality.\n`);
    return;
  }

  // Create embedder and MCP bridge
  const embedder = createVoyageEmbedder({
    apiKey: envConfig.voyage_api_key,
    model: 'voyage-3',
  });

  const mcpServerUrl = process.env.MCP_SERVER_URL ?? 'http://localhost:8000';
  const callMcpTool = createMcpBridge({
    baseUrl: mcpServerUrl,
    timeout: 30000,
  });

  // Create and initialize agent
  console.log('Creating Learning Loop Agent...');
  let agent: LearningLoopAgent;
  try {
    agent = await createAndInitializeLearningLoopAgent({
      callMcpTool,
      embedder,
      config: {
        qdrant: {
          url: envConfig.qdrant_url,
          apiKey: envConfig.qdrant_api_key,
        },
        redis: {
          url: envConfig.redis_url,
          token: envConfig.redis_token,
        },
        slack: {
          botToken: envConfig.slack_bot_token,
        },
      },
    });

    // Set default brain ID if provided
    if (serverConfig.defaultBrainId) {
      agent.setBrainId(serverConfig.defaultBrainId);
    }

    console.log('Agent created and initialized successfully\n');
  } catch (error) {
    console.error('Failed to create agent:', error);
    process.exit(1);
  }

  // Create webhook router
  const webhookRouter = createWebhookRouter({
    webhookSecret: serverConfig.webhookSecret,
    port: serverConfig.port,
    basePath: '/webhook/learning-loop',
  });

  // Wire up handlers
  webhookRouter.setInsightHandler(async (req: InsightExtractionRequest): Promise<InsightExtractionResponse> => {
    // Generate job ID for async tracking
    const jobId = `insight_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Start processing asynchronously (fire and forget for now)
    // In production, this would use a proper job queue
    agent.processSource({
      source_id: req.source_id,
      source_type: req.source_type,
      content: req.content,
      brain_id: req.brain_id,
      thread_context: req.thread_context,
      lead: req.lead,
      template_used_id: req.template_used_id,
    }).then(result => {
      serverState.processedToday++;
      serverState.insightsExtracted += result.insightsExtracted;
    }).catch(error => {
      serverState.errorsToday++;
      getLogger().error('Background insight extraction failed', {
        job_id: jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Return async job response immediately
    return {
      success: true,
      job_id: jobId,
      estimated_ms: 5000, // Estimated processing time
    };
  });

  webhookRouter.setValidationHandler(async (req: ValidationCallbackRequest): Promise<ValidationCallbackResponse> => {
    // Parse Slack block_actions format
    const action = req.actions[0];
    if (!action) {
      return {
        replace_original: false,
        text: 'No action provided',
      };
    }

    // Extract validation ID and decision from action
    const validationId = action.value;
    const decision = action.action_id === 'insight_approve' || action.action_id === 'insight_approve_with_note'
      ? 'approved' as const
      : 'rejected' as const;
    const validatorId = req.user.id;

    await agent.handleValidation(validationId, decision, validatorId);
    serverState.validationsProcessed++;

    // Return Slack response format
    return {
      replace_original: true,
      text: `Insight ${decision} by <@${validatorId}>`,
    };
  });

  webhookRouter.setSynthesisHandler(async (req: SynthesisRequest): Promise<SynthesisResponse> => {
    // Generate synthesis ID for async tracking
    const synthesisId = `synthesis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Set brain ID for synthesis
    if (req.brain_id) {
      agent.setBrainId(req.brain_id);
    }

    // Start synthesis asynchronously
    agent.generateWeeklySynthesis().catch(error => {
      getLogger().error('Background synthesis failed', {
        synthesis_id: synthesisId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Return async job response immediately
    return {
      success: true,
      synthesis_id: synthesisId,
      estimated_ms: 30000, // Synthesis takes longer
    };
  });

  webhookRouter.setTemplateOutcomeHandler(async (req: TemplateOutcomeRequest): Promise<TemplateOutcomeResponse> => {
    const result = await agent.recordTemplateOutcome(req.template_id, req.outcome);

    if (!result.success) {
      throw new Error(result.error ?? 'Failed to record template outcome');
    }

    return {
      success: true,
      template_id: req.template_id,
      new_success_rate: result.newSuccessRate,
      times_used: result.timesUsed,
    };
  });

  // Start HTTP server
  console.log('Starting HTTP server...');
  const server = Bun.serve({
    port: serverConfig.port,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;

      // Handle CORS
      const corsResponse = handleCors(request);
      if (corsResponse) return corsResponse;

      // Root health check (for dashboard compatibility)
      if (path === '/health' && request.method === 'GET') {
        const health = buildHealthResponse(agent);
        return addCorsHeaders(
          new Response(JSON.stringify(health), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }

      // Route to webhook router for /webhook/learning-loop/* paths
      if (path.startsWith('/webhook/learning-loop')) {
        try {
          let body: unknown = null;
          if (request.method === 'POST') {
            body = await request.json();
          }

          const ctx: RequestContext = {
            method: request.method,
            path,
            headers: request.headers,
            body,
          };

          const result: ResponseContext = await webhookRouter.handleRequest(ctx);

          return addCorsHeaders(
            new Response(JSON.stringify(result.body), {
              status: result.status,
              headers: {
                'Content-Type': 'application/json',
                ...result.headers,
              },
            })
          );
        } catch (error) {
          serverState.errorsToday++;
          const message = error instanceof Error ? error.message : String(error);

          return addCorsHeaders(
            new Response(
              JSON.stringify({
                success: false,
                error: message,
              }),
              {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              }
            )
          );
        }
      }

      // 404 for unknown routes
      return addCorsHeaders(
        new Response(
          JSON.stringify({
            success: false,
            error: `Route ${path} not found`,
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );
    },
  });

  console.log(`\n========================================`);
  console.log(`Learning Loop Agent Server is running!`);
  console.log(`========================================\n`);
  console.log(`Health Check:     http://localhost:${serverConfig.port}/health`);
  console.log(`Insight Extract:  http://localhost:${serverConfig.port}/webhook/learning-loop/insight`);
  console.log(`Validation:       http://localhost:${serverConfig.port}/webhook/learning-loop/validate`);
  console.log(`Synthesis:        http://localhost:${serverConfig.port}/webhook/learning-loop/synthesis`);
  console.log(`Template Outcome: http://localhost:${serverConfig.port}/webhook/learning-loop/template-outcome`);
  console.log(`\nPress Ctrl+C to stop the server.\n`);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down server...');
    await agent.shutdown();
    server.stop();
    console.log('Server shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run the server
main().catch((error) => {
  console.error('Failed to start Learning Loop Agent:', error);
  process.exit(1);
});

// ===========================================
// Export for programmatic usage
// ===========================================

export {
  loadServerConfig,
  createVoyageEmbedder,
  createMcpBridge,
  type ServerConfig,
  type VoyageEmbedderConfig,
  type McpBridgeConfig,
};
