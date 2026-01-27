/**
 * Learning Loop Webhook Router
 *
 * HTTP endpoint handlers for the Learning Loop agent.
 * Implements webhook authentication and request validation.
 *
 * @module learning-loop/webhook
 */

import {
  InsightExtractionRequestSchema,
  ValidationCallbackRequestSchema,
  SynthesisRequestSchema,
  TemplateOutcomeRequestSchema,
  HTTP_STATUS,
  WEBHOOK_ROUTES,
  validateWebhookSecret,
  type InsightExtractionRequest,
  type InsightExtractionResponse,
  type ValidationCallbackRequest,
  type ValidationCallbackResponse,
  type SynthesisRequest,
  type SynthesisResponse,
  type TemplateOutcomeRequest,
  type TemplateOutcomeResponse,
  type HealthCheckResponse,
  type QueueStatusResponse,
} from './contracts';
import type { LearningLoopStateManager } from './state';
import { getLogger } from './logger';

// Security imports
import {
  isLakeraGuardEnabled,
  screenWebhookInput,
} from '@atlas-gtm/lib/security';

// ===========================================
// Types
// ===========================================

export interface WebhookRouterConfig {
  /** Secret for webhook authentication */
  webhookSecret: string;
  /** Port to listen on */
  port: number;
  /** Base path for routes */
  basePath: string;
}

export const DEFAULT_WEBHOOK_CONFIG: WebhookRouterConfig = {
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  port: parseInt(process.env.LEARNING_LOOP_PORT ?? '4004', 10),
  basePath: '/webhook/learning-loop',
};

export interface RequestContext {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

export interface ResponseContext {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type RouteHandler = (ctx: RequestContext) => Promise<ResponseContext>;

// ===========================================
// Webhook Router Class
// ===========================================

export class LearningLoopWebhookRouter {
  private readonly config: WebhookRouterConfig;
  private readonly routes: Map<string, Map<string, RouteHandler>>;
  private stateManager: LearningLoopStateManager | null = null;

  // Handlers to be set by the agent
  private insightHandler: ((req: InsightExtractionRequest) => Promise<InsightExtractionResponse>) | null = null;
  private validationHandler: ((req: ValidationCallbackRequest) => Promise<ValidationCallbackResponse>) | null = null;
  private synthesisHandler: ((req: SynthesisRequest) => Promise<SynthesisResponse>) | null = null;
  private templateOutcomeHandler: ((req: TemplateOutcomeRequest) => Promise<TemplateOutcomeResponse>) | null = null;

  constructor(config?: Partial<WebhookRouterConfig>) {
    this.config = { ...DEFAULT_WEBHOOK_CONFIG, ...config };
    this.routes = new Map();
    this.setupRoutes();
  }

  // ===========================================
  // Route Setup
  // ===========================================

  private setupRoutes(): void {
    // Health check (no auth required)
    this.addRoute('GET', WEBHOOK_ROUTES.HEALTH, this.handleHealth.bind(this));

    // Queue status - uses :brain_id param, so we use a base path
    this.addRoute('GET', '/webhook/learning-loop/queue', this.handleQueueStatus.bind(this));

    // Insight extraction (POST /webhook/learning-loop/insight)
    this.addRoute('POST', WEBHOOK_ROUTES.INSIGHT_EXTRACT, this.handleInsightExtraction.bind(this));

    // Validation callback (POST /webhook/learning-loop/validate)
    this.addRoute('POST', WEBHOOK_ROUTES.VALIDATION_CALLBACK, this.handleValidationCallback.bind(this));

    // Weekly synthesis trigger (POST /webhook/learning-loop/synthesis)
    this.addRoute('POST', WEBHOOK_ROUTES.SYNTHESIS, this.handleSynthesisTrigger.bind(this));

    // Template outcome (POST /webhook/learning-loop/template-outcome)
    this.addRoute('POST', WEBHOOK_ROUTES.TEMPLATE_OUTCOME, this.handleTemplateOutcome.bind(this));

    // Stats endpoint - uses :brain_id param
    this.addRoute('GET', '/webhook/learning-loop/stats', this.handleStats.bind(this));
  }

  private addRoute(method: string, path: string, handler: RouteHandler): void {
    if (!this.routes.has(method)) {
      this.routes.set(method, new Map());
    }
    this.routes.get(method)!.set(path, handler);
  }

  // ===========================================
  // Handler Setters
  // ===========================================

  setStateManager(manager: LearningLoopStateManager): void {
    this.stateManager = manager;
  }

  setInsightHandler(handler: (req: InsightExtractionRequest) => Promise<InsightExtractionResponse>): void {
    this.insightHandler = handler;
  }

  setValidationHandler(handler: (req: ValidationCallbackRequest) => Promise<ValidationCallbackResponse>): void {
    this.validationHandler = handler;
  }

  setSynthesisHandler(handler: (req: SynthesisRequest) => Promise<SynthesisResponse>): void {
    this.synthesisHandler = handler;
  }

  setTemplateOutcomeHandler(handler: (req: TemplateOutcomeRequest) => Promise<TemplateOutcomeResponse>): void {
    this.templateOutcomeHandler = handler;
  }

  // ===========================================
  // Route Handlers
  // ===========================================

  private startTime = Date.now();

  private async handleHealth(_ctx: RequestContext): Promise<ResponseContext> {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const response: HealthCheckResponse = {
      status: 'healthy',
      version: '1.0.0',
      uptime_seconds: uptimeSeconds,
      dependencies: {
        qdrant: 'connected',  // Would be dynamic in production
        redis: 'connected',   // Would be dynamic in production
        slack: 'connected',   // Would be dynamic in production
      },
      metrics: {
        insights_processed_24h: 0,
        validations_pending: 0,
        avg_extraction_ms: 0,
      },
    };

    return { status: HTTP_STATUS.OK, body: response };
  }

  private async handleQueueStatus(ctx: RequestContext): Promise<ResponseContext> {
    // Verify auth for non-health endpoints
    const authError = this.verifyAuth(ctx);
    if (authError) return authError;

    if (!this.stateManager) {
      return this.errorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'State manager not initialized');
    }

    const stats = this.stateManager.getSessionStats();
    const brainId = this.stateManager.getBrainId() || '';

    const response: QueueStatusResponse = {
      brain_id: brainId,
      pending_count: stats.pendingValidations,
      approved_today: 0, // Would track in state manager in production
      rejected_today: 0, // Would track in state manager in production
      avg_decision_time_ms: null,
      oldest_pending: null, // Would need to get from pending validations
    };

    return { status: HTTP_STATUS.OK, body: response };
  }

  private async handleInsightExtraction(ctx: RequestContext): Promise<ResponseContext> {
    const logger = getLogger();

    // Verify auth
    const authError = this.verifyAuth(ctx);
    if (authError) return authError;

    // Validate request body
    const parseResult = InsightExtractionRequestSchema.safeParse(ctx.body);
    if (!parseResult.success) {
      logger.warn('Invalid insight extraction request', {
        errors: parseResult.error.errors,
      });
      return this.errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid request body', parseResult.error.errors);
    }

    // Security screening for insight content
    let requestData = parseResult.data;
    if (isLakeraGuardEnabled()) {
      const securityResult = await screenWebhookInput(
        requestData,
        'learning_loop_insight_webhook',
        crypto.randomUUID()
      );

      if (!securityResult.passed) {
        logger.warn('Security blocked insight extraction request', {
          reason: securityResult.reason,
          source_id: requestData.source_id,
        });
        return this.errorResponse(
          403,
          securityResult.reason || 'Request blocked by security'
        );
      }

      if (securityResult.sanitizedData) {
        requestData = securityResult.sanitizedData as typeof requestData;
      }
    }

    if (!this.insightHandler) {
      return this.errorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Insight handler not configured');
    }

    try {
      const response = await this.insightHandler(requestData);
      return { status: HTTP_STATUS.OK, body: response };
    } catch (error) {
      logger.error('Insight extraction failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.errorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Insight extraction failed');
    }
  }

  private async handleValidationCallback(ctx: RequestContext): Promise<ResponseContext> {
    const logger = getLogger();

    // Verify auth (can be webhook secret OR Slack signature)
    const authError = this.verifyAuth(ctx);
    if (authError) return authError;

    // Validate request body
    const parseResult = ValidationCallbackRequestSchema.safeParse(ctx.body);
    if (!parseResult.success) {
      logger.warn('Invalid validation callback request', {
        errors: parseResult.error.errors,
      });
      return this.errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid request body', parseResult.error.errors);
    }

    // Security screening for validation callback (may contain user feedback)
    let requestData = parseResult.data;
    if (isLakeraGuardEnabled()) {
      const securityResult = await screenWebhookInput(
        requestData,
        'learning_loop_validation_webhook',
        crypto.randomUUID()
      );

      if (!securityResult.passed) {
        logger.warn('Security blocked validation callback request', {
          reason: securityResult.reason,
          user_id: requestData.user.id,
        });
        return this.errorResponse(
          403,
          securityResult.reason || 'Request blocked by security'
        );
      }

      if (securityResult.sanitizedData) {
        requestData = securityResult.sanitizedData as typeof requestData;
      }
    }

    if (!this.validationHandler) {
      return this.errorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Validation handler not configured');
    }

    try {
      const response = await this.validationHandler(requestData);
      return { status: HTTP_STATUS.OK, body: response };
    } catch (error) {
      logger.error('Validation callback failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.errorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Validation callback failed');
    }
  }

  private async handleSynthesisTrigger(ctx: RequestContext): Promise<ResponseContext> {
    const logger = getLogger();

    // Verify auth
    const authError = this.verifyAuth(ctx);
    if (authError) return authError;

    // Validate request body
    const parseResult = SynthesisRequestSchema.safeParse(ctx.body);
    if (!parseResult.success) {
      logger.warn('Invalid synthesis request', {
        errors: parseResult.error.errors,
      });
      return this.errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid request body', parseResult.error.errors);
    }

    if (!this.synthesisHandler) {
      return this.errorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Synthesis handler not configured');
    }

    try {
      const response = await this.synthesisHandler(parseResult.data);
      return { status: HTTP_STATUS.OK, body: response };
    } catch (error) {
      logger.error('Synthesis trigger failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.errorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Synthesis trigger failed');
    }
  }

  private async handleTemplateOutcome(ctx: RequestContext): Promise<ResponseContext> {
    const logger = getLogger();

    // Verify auth
    const authError = this.verifyAuth(ctx);
    if (authError) return authError;

    // Validate request body
    const parseResult = TemplateOutcomeRequestSchema.safeParse(ctx.body);
    if (!parseResult.success) {
      logger.warn('Invalid template outcome request', {
        errors: parseResult.error.errors,
      });
      return this.errorResponse(HTTP_STATUS.BAD_REQUEST, 'Invalid request body', parseResult.error.errors);
    }

    if (!this.templateOutcomeHandler) {
      return this.errorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Template outcome handler not configured');
    }

    try {
      const response = await this.templateOutcomeHandler(parseResult.data);
      return { status: HTTP_STATUS.OK, body: response };
    } catch (error) {
      logger.error('Template outcome recording failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.errorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Template outcome recording failed');
    }
  }

  private async handleStats(ctx: RequestContext): Promise<ResponseContext> {
    // Verify auth
    const authError = this.verifyAuth(ctx);
    if (authError) return authError;

    if (!this.stateManager) {
      return this.errorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'State manager not initialized');
    }

    const stats = this.stateManager.getSessionStats();
    const metrics = this.stateManager.getMetrics();

    return {
      status: HTTP_STATUS.OK,
      body: {
        session: stats,
        metrics,
      },
    };
  }

  // ===========================================
  // Authentication
  // ===========================================

  private verifyAuth(ctx: RequestContext): ResponseContext | null {
    // Convert Headers to Record for validateWebhookSecret
    const headersRecord: Record<string, string | undefined> = {};
    ctx.headers.forEach((value, key) => {
      headersRecord[key.toLowerCase()] = value;
    });

    if (!validateWebhookSecret(headersRecord, this.config.webhookSecret)) {
      return this.errorResponse(HTTP_STATUS.UNAUTHORIZED, 'Invalid or missing webhook secret');
    }

    return null;
  }

  // ===========================================
  // Response Helpers
  // ===========================================

  private errorResponse(status: number, message: string, details?: unknown): ResponseContext {
    return {
      status,
      body: {
        success: false,
        error: message,
        details,
      },
    };
  }

  // ===========================================
  // Request Handling
  // ===========================================

  /**
   * Handle an incoming HTTP request.
   */
  async handleRequest(ctx: RequestContext): Promise<ResponseContext> {
    const methodRoutes = this.routes.get(ctx.method);

    if (!methodRoutes) {
      return this.errorResponse(HTTP_STATUS.NOT_FOUND, `Method ${ctx.method} not allowed`);
    }

    const handler = methodRoutes.get(ctx.path);

    if (!handler) {
      return this.errorResponse(HTTP_STATUS.NOT_FOUND, `Route ${ctx.path} not found`);
    }

    return handler(ctx);
  }

  /**
   * Get all registered routes (for documentation/debugging).
   */
  getRoutes(): Array<{ method: string; path: string }> {
    const routes: Array<{ method: string; path: string }> = [];

    for (const [method, pathMap] of this.routes) {
      for (const path of pathMap.keys()) {
        routes.push({ method, path });
      }
    }

    return routes;
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Learning Loop webhook router instance.
 */
export function createWebhookRouter(
  config?: Partial<WebhookRouterConfig>
): LearningLoopWebhookRouter {
  return new LearningLoopWebhookRouter(config);
}
