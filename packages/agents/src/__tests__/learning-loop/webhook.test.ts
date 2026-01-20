/**
 * Learning Loop Webhook Tests
 *
 * Tests for webhook API endpoints:
 * - Authentication (X-Webhook-Secret)
 * - Request validation
 * - Route handling
 * - Error responses
 *
 * @module __tests__/learning-loop/webhook.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LearningLoopWebhookRouter,
  createWebhookRouter,
} from '../../learning-loop/webhook';
import { HTTP_STATUS, WEBHOOK_ROUTES } from '../../learning-loop/contracts';
import type { RequestContext } from '../../learning-loop/webhook';
import {
  TEST_WEBHOOK_SECRET,
  TEST_BRAIN_ID,
  createTestInsightExtractionRequest,
  createTestValidationCallbackRequest,
  createTestSynthesisRequest,
  createTestTemplateOutcomeRequest,
} from './fixtures';
import { createMockStateManager } from './fixtures/mock-clients';

/**
 * Create a mock request context for testing.
 */
function createMockRequestContext(
  method: string,
  path: string,
  body: unknown,
  webhookSecret?: string | null
): RequestContext {
  const headers = new Headers();
  if (webhookSecret !== null) {
    headers.set('x-webhook-secret', webhookSecret ?? TEST_WEBHOOK_SECRET);
  }
  headers.set('content-type', 'application/json');

  return {
    method,
    path,
    headers,
    body,
  };
}

describe('LearningLoopWebhookRouter', () => {
  let router: LearningLoopWebhookRouter;
  let mockStateManager: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    mockStateManager = createMockStateManager({ brainId: TEST_BRAIN_ID });
    router = createWebhookRouter({
      webhookSecret: TEST_WEBHOOK_SECRET,
      port: 3002,
      basePath: '/webhook/learning-loop',
    });
    router.setStateManager(mockStateManager);
  });

  // ===========================================
  // Authentication Tests
  // ===========================================

  describe('Authentication', () => {
    it('should reject request with missing X-Webhook-Secret', async () => {
      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.INSIGHT_EXTRACT,
        createTestInsightExtractionRequest(),
        null // No secret
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid or missing webhook secret'),
      });
    });

    it('should reject request with invalid X-Webhook-Secret', async () => {
      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.INSIGHT_EXTRACT,
        createTestInsightExtractionRequest(),
        'wrong-secret'
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid or missing webhook secret'),
      });
    });

    it('should accept request with valid X-Webhook-Secret', async () => {
      // Set up a mock handler to avoid handler not configured error
      router.setInsightHandler(async () => ({
        success: true,
        extraction_id: 'test_123',
        insights_extracted: 0,
        insights_auto_approved: 0,
        insights_queued: 0,
        insights_rejected: 0,
        extraction_time_ms: 100,
      }));

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.INSIGHT_EXTRACT,
        createTestInsightExtractionRequest(),
        TEST_WEBHOOK_SECRET
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.OK);
    });

    it('should allow health check without authentication', async () => {
      const ctx = createMockRequestContext(
        'GET',
        WEBHOOK_ROUTES.HEALTH,
        {},
        null // No secret
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.body).toMatchObject({
        status: 'healthy',
      });
    });
  });

  // ===========================================
  // Health Check Tests
  // ===========================================

  describe('Health Check Endpoint', () => {
    it('should return healthy status', async () => {
      const ctx = createMockRequestContext('GET', WEBHOOK_ROUTES.HEALTH, {});

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.body).toMatchObject({
        status: 'healthy',
        version: expect.any(String),
        uptime_seconds: expect.any(Number),
        dependencies: {
          qdrant: expect.any(String),
          redis: expect.any(String),
          slack: expect.any(String),
        },
      });
    });
  });

  // ===========================================
  // Insight Extraction Tests
  // ===========================================

  describe('Insight Extraction Endpoint', () => {
    it('should validate request body schema', async () => {
      const invalidBody = {
        // Missing required fields
        content: 'Some content',
      };

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.INSIGHT_EXTRACT,
        invalidBody
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(response.body).toMatchObject({
        success: false,
        error: 'Invalid request body',
      });
    });

    it('should return error when handler not configured', async () => {
      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.INSIGHT_EXTRACT,
        createTestInsightExtractionRequest()
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
      expect(response.body).toMatchObject({
        success: false,
        error: 'Insight handler not configured',
      });
    });

    it('should call insight handler with valid request', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        success: true,
        extraction_id: 'extract_123',
        insights_extracted: 3,
        insights_auto_approved: 1,
        insights_queued: 2,
        insights_rejected: 0,
        extraction_time_ms: 250,
      });

      router.setInsightHandler(mockHandler);

      const requestBody = createTestInsightExtractionRequest({
        brain_id: TEST_BRAIN_ID,
        source_type: 'email_reply',
      });

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.INSIGHT_EXTRACT,
        requestBody
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.OK);
      // Verify handler was called with the parsed request data
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          brain_id: TEST_BRAIN_ID,
          source_type: 'email_reply',
          lead: expect.objectContaining({
            company_name: 'Acme Corporation',
          }),
        })
      );
      expect(response.body).toMatchObject({
        success: true,
        insights_extracted: 3,
      });
    });

    it('should handle handler errors gracefully', async () => {
      router.setInsightHandler(async () => {
        throw new Error('Database connection failed');
      });

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.INSIGHT_EXTRACT,
        createTestInsightExtractionRequest()
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
      expect(response.body).toMatchObject({
        success: false,
        error: 'Insight extraction failed',
      });
    });
  });

  // ===========================================
  // Validation Callback Tests
  // ===========================================

  describe('Validation Callback Endpoint', () => {
    it('should validate callback request body', async () => {
      const invalidBody = {
        insight_id: 'insight_123',
        // Missing decision field
      };

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.VALIDATION_CALLBACK,
        invalidBody
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    });

    it('should handle approve decision', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        success: true,
        insight_id: 'insight_123',
        decision: 'approved',
        kb_write_id: 'kb_456',
      });

      router.setValidationHandler(mockHandler);

      const callbackRequest = createTestValidationCallbackRequest({
        insight_id: 'insight_123',
        decision: 'approved',
        reviewer_id: 'U123456',
      });

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.VALIDATION_CALLBACK,
        callbackRequest
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(mockHandler).toHaveBeenCalledWith(callbackRequest);
    });

    it('should handle reject decision with reason', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        success: true,
        insight_id: 'insight_123',
        decision: 'rejected',
      });

      router.setValidationHandler(mockHandler);

      const callbackRequest = createTestValidationCallbackRequest({
        insight_id: 'insight_123',
        decision: 'rejected',
        rejection_reason: 'Not relevant to our ICP',
      });

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.VALIDATION_CALLBACK,
        callbackRequest
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.OK);
      // Verify the handler was called with the Slack block_actions payload
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'block_actions',
          actions: expect.arrayContaining([
            expect.objectContaining({
              action_id: 'insight_reject',
            }),
          ]),
        })
      );
    });
  });

  // ===========================================
  // Synthesis Trigger Tests
  // ===========================================

  describe('Synthesis Trigger Endpoint', () => {
    it('should validate synthesis request body', async () => {
      const invalidBody = {
        // Missing brain_id
        time_period: 'week',
      };

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.SYNTHESIS,
        invalidBody
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    });

    it('should call synthesis handler with valid request', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        success: true,
        synthesis_id: 'synth_123',
        insights_analyzed: 50,
        themes_identified: 5,
        slack_message_ts: '1234567890.123456',
      });

      router.setSynthesisHandler(mockHandler);

      const synthesisRequest = createTestSynthesisRequest({
        brain_id: TEST_BRAIN_ID,
      });

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.SYNTHESIS,
        synthesisRequest
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(mockHandler).toHaveBeenCalledWith(synthesisRequest);
      expect(response.body).toMatchObject({
        success: true,
        insights_analyzed: 50,
      });
    });
  });

  // ===========================================
  // Template Outcome Tests
  // ===========================================

  describe('Template Outcome Endpoint', () => {
    it('should validate template outcome request', async () => {
      const invalidBody = {
        template_id: 'template_123',
        // Missing outcome field
      };

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.TEMPLATE_OUTCOME,
        invalidBody
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    });

    it('should record positive template outcome', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        success: true,
        template_id: 'template_123',
        recorded: true,
        new_performance_score: 0.78,
      });

      router.setTemplateOutcomeHandler(mockHandler);

      const outcomeRequest = createTestTemplateOutcomeRequest({
        template_id: 'template_123',
        outcome: 'positive_reply',
        lead_id: 'lead_456',
      });

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.TEMPLATE_OUTCOME,
        outcomeRequest
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(mockHandler).toHaveBeenCalledWith(outcomeRequest);
    });

    it('should record negative template outcome', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        success: true,
        template_id: 'template_123',
        recorded: true,
        new_performance_score: 0.45,
      });

      router.setTemplateOutcomeHandler(mockHandler);

      const outcomeRequest = createTestTemplateOutcomeRequest({
        template_id: 'template_123',
        outcome: 'negative_reply',
      });

      const ctx = createMockRequestContext(
        'POST',
        WEBHOOK_ROUTES.TEMPLATE_OUTCOME,
        outcomeRequest
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.OK);
    });
  });

  // ===========================================
  // Queue Status Tests
  // ===========================================

  describe('Queue Status Endpoint', () => {
    it('should return queue status with pending count', async () => {
      mockStateManager.setPendingValidationCount(5);

      const ctx = createMockRequestContext(
        'GET',
        '/webhook/learning-loop/queue',
        {}
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.body).toMatchObject({
        brain_id: TEST_BRAIN_ID,
        pending_count: 5,
      });
    });

    it('should require authentication for queue status', async () => {
      const ctx = createMockRequestContext(
        'GET',
        '/webhook/learning-loop/queue',
        {},
        null
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    });
  });

  // ===========================================
  // Stats Endpoint Tests
  // ===========================================

  describe('Stats Endpoint', () => {
    it('should return session stats and metrics', async () => {
      // Set up some metrics in state manager
      mockStateManager.updateMetrics({
        insightsExtracted: 25,
        insightsValidated: 20,
        insightsAutoApproved: 10,
        insightsRejected: 5,
        kbWrites: 15,
      });

      const ctx = createMockRequestContext(
        'GET',
        '/webhook/learning-loop/stats',
        {}
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.OK);
      expect(response.body).toMatchObject({
        session: expect.any(Object),
        metrics: expect.objectContaining({
          insightsExtracted: 25,
        }),
      });
    });
  });

  // ===========================================
  // Route Not Found Tests
  // ===========================================

  describe('Route Handling', () => {
    it('should return 404 for unknown route', async () => {
      const ctx = createMockRequestContext(
        'POST',
        '/webhook/learning-loop/unknown',
        {}
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    it('should return 404 for wrong HTTP method', async () => {
      const ctx = createMockRequestContext(
        'DELETE',
        WEBHOOK_ROUTES.HEALTH,
        {}
      );

      const response = await router.handleRequest(ctx);

      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    });

    it('should list all registered routes', () => {
      const routes = router.getRoutes();

      expect(routes).toContainEqual({ method: 'GET', path: WEBHOOK_ROUTES.HEALTH });
      expect(routes).toContainEqual({ method: 'POST', path: WEBHOOK_ROUTES.INSIGHT_EXTRACT });
      expect(routes).toContainEqual({ method: 'POST', path: WEBHOOK_ROUTES.VALIDATION_CALLBACK });
      expect(routes).toContainEqual({ method: 'POST', path: WEBHOOK_ROUTES.SYNTHESIS });
      expect(routes).toContainEqual({ method: 'POST', path: WEBHOOK_ROUTES.TEMPLATE_OUTCOME });
    });
  });
});
