/**
 * Lead Scorer Agent - Server Entry Point
 *
 * Initializes the webhook handler and starts the HTTP server.
 * This is the main entry point for running the Lead Scorer Agent.
 *
 * Usage:
 *   bun run src/lead-scorer/server.ts
 *
 * Required environment variables:
 *   LEAD_SCORER_SECRET - Webhook authentication secret
 *   ANTHROPIC_API_KEY  - Anthropic API key for Claude (optional, for LLM angles)
 *
 * Optional environment variables:
 *   LEAD_SCORER_PORT              - Port to listen on (default: 4001)
 *   USE_HEURISTICS_FOR_ANGLE      - Use heuristics-only for angle (default: true)
 *   LANGFUSE_PUBLIC_KEY           - Langfuse public key (for observability)
 *   LANGFUSE_SECRET_KEY           - Langfuse secret key (for observability)
 *   LAKERA_GUARD_API_KEY          - Lakera Guard API key (for security)
 *
 * @module lead-scorer/server
 */

import { createWebhookHandler, WebhookHandler } from './webhook';
import { logger } from './logger';

// ===========================================
// Environment Configuration
// ===========================================

interface EnvConfig {
  webhookSecret: string;
  port: number;
  anthropicApiKey?: string;
  useHeuristicsForAngle: boolean;
}

function loadEnvConfig(): EnvConfig {
  const webhookSecret = process.env.LEAD_SCORER_SECRET;

  if (!webhookSecret) {
    throw new Error('Missing required environment variable: LEAD_SCORER_SECRET');
  }

  return {
    webhookSecret,
    port: parseInt(process.env.LEAD_SCORER_PORT ?? '4001', 10),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    useHeuristicsForAngle: process.env.USE_HEURISTICS_FOR_ANGLE !== 'false',
  };
}

// ===========================================
// Health Response Type
// ===========================================

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'error';
  timestamp: string;
  metrics: {
    processed_today: number;
    errors_today: number;
    avg_score: number;
    tier_distribution: Record<string, number>;
  };
  version: string;
  uptime_seconds: number;
}

// ===========================================
// Server State
// ===========================================

interface ServerState {
  startTime: number;
  processedToday: number;
  errorsToday: number;
  scores: number[];
  tierCounts: Record<string, number>;
}

const state: ServerState = {
  startTime: Date.now(),
  processedToday: 0,
  errorsToday: 0,
  scores: [],
  tierCounts: {},
};

// ===========================================
// Request Handlers
// ===========================================

function buildHealthResponse(): HealthResponse {
  const uptimeSeconds = Math.floor((Date.now() - state.startTime) / 1000);
  const avgScore =
    state.scores.length > 0
      ? state.scores.reduce((a, b) => a + b, 0) / state.scores.length
      : 0;

  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    metrics: {
      processed_today: state.processedToday,
      errors_today: state.errorsToday,
      avg_score: Math.round(avgScore * 100) / 100,
      tier_distribution: { ...state.tierCounts },
    },
    version: '1.0.0',
    uptime_seconds: uptimeSeconds,
  };
}

function handleCors(request: Request): Response | null {
  // Handle CORS preflight
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

// ===========================================
// Main Server
// ===========================================

async function main() {
  console.log('Starting Lead Scorer Agent Server...\n');

  // Load environment configuration
  const envConfig = loadEnvConfig();
  console.log(`Port: ${envConfig.port}`);
  console.log(`Heuristics-only angles: ${envConfig.useHeuristicsForAngle}`);
  console.log(`Anthropic API: ${envConfig.anthropicApiKey ? 'configured' : 'not configured'}\n`);

  // Create webhook handler
  console.log('Creating webhook handler...');
  const handler = createWebhookHandler({
    webhookSecret: envConfig.webhookSecret,
    anthropicApiKey: envConfig.anthropicApiKey,
    useHeuristicsForAngle: envConfig.useHeuristicsForAngle,
  });
  console.log('Webhook handler created successfully\n');

  // Start HTTP server
  console.log('Starting HTTP server...');
  const server = Bun.serve({
    port: envConfig.port,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;

      // Handle CORS
      const corsResponse = handleCors(request);
      if (corsResponse) return corsResponse;

      // Health check endpoint
      if (path === '/health' && request.method === 'GET') {
        const health = buildHealthResponse();
        return addCorsHeaders(
          new Response(JSON.stringify(health), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }

      // Webhook endpoint for scoring leads
      if (path === '/webhook/score-lead' && request.method === 'POST') {
        try {
          const body = await request.json();

          const result = await handler.handle({
            headers: request.headers,
            body,
          });

          // Track metrics
          if (result.body && 'success' in result.body && result.body.success === true) {
            if ('data' in result.body && result.body.data) {
              state.processedToday++;
              state.scores.push(result.body.data.score);
              const tier = result.body.data.tier;
              state.tierCounts[tier] = (state.tierCounts[tier] || 0) + 1;
            } else if ('skipped' in result.body && result.body.skipped) {
              // Skipped leads are still considered "processed"
              state.processedToday++;
            }
          } else {
            state.errorsToday++;
          }

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
          state.errorsToday++;
          const message = error instanceof Error ? error.message : String(error);

          logger.scoringFailed({
            lead_id: 'unknown',
            error_code: 'SCORING_FAILED',
            error_message: message,
          });

          return addCorsHeaders(
            new Response(
              JSON.stringify({
                success: false,
                error: {
                  code: 'SCORING_FAILED',
                  message: 'Invalid JSON in request body',
                },
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
            error: {
              code: 'NOT_FOUND',
              message: `Route ${path} not found`,
            },
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
  console.log(`Lead Scorer Agent Server is running!`);
  console.log(`========================================\n`);
  console.log(`Health Check:    http://localhost:${envConfig.port}/health`);
  console.log(`Score Webhook:   http://localhost:${envConfig.port}/webhook/score-lead`);
  console.log(`\nPress Ctrl+C to stop the server.\n`);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down server...');
    await handler.shutdown();
    server.stop();
    console.log('Server shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run the server
main().catch((error) => {
  console.error('Failed to start Lead Scorer Agent:', error);
  process.exit(1);
});

// ===========================================
// Export for programmatic usage
// ===========================================

export { loadEnvConfig, type EnvConfig, type HealthResponse };
