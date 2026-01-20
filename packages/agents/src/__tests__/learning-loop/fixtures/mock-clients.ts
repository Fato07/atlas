/**
 * Mock Clients for Learning Loop Tests
 *
 * Provides mock implementations of external clients (Qdrant, Slack, Redis)
 * with tracking capabilities for test assertions.
 *
 * @module __tests__/learning-loop/fixtures/mock-clients
 */

import { vi } from 'vitest';
import type { DuplicateCheckResult } from '../../../learning-loop/qdrant-client';
import type { InsightCategory } from '../../../learning-loop/contracts';
import { TEST_BRAIN_ID } from './index';

// ===========================================
// Mock Qdrant Client
// ===========================================

export interface MockQdrantClientOptions {
  /** Pre-configured duplicate check result */
  duplicateResult?: Partial<DuplicateCheckResult>;
  /** Should search throw an error */
  searchShouldFail?: boolean;
  /** Should write throw an error */
  writeShouldFail?: boolean;
}

export function createMockQdrantClient(options: MockQdrantClientOptions = {}) {
  const _searchCalls: Array<{
    collection: string;
    brainId: string;
    query: string;
  }> = [];

  const _writeCalls: Array<{
    collection: string;
    payload: unknown;
  }> = [];

  const _duplicateChecks: Array<{
    brainId: string;
    content: string;
  }> = [];

  return {
    search: vi.fn(async (opts: { collection: string; brainId: string; query: string }) => {
      _searchCalls.push(opts);

      if (options.searchShouldFail) {
        throw new Error('Qdrant search failed');
      }

      return [];
    }),

    checkDuplicateByContent: vi.fn(
      async (brainId: string, content: string): Promise<DuplicateCheckResult> => {
        _duplicateChecks.push({ brainId, content });

        if (options.duplicateResult) {
          return {
            isDuplicate: options.duplicateResult.isDuplicate ?? false,
            similarId: options.duplicateResult.similarId ?? null,
            similarity: options.duplicateResult.similarity ?? null,
          };
        }

        return {
          isDuplicate: false,
          similarId: null,
          similarity: null,
        };
      }
    ),

    write: vi.fn(async (collection: string, payload: unknown) => {
      _writeCalls.push({ collection, payload });

      if (options.writeShouldFail) {
        throw new Error('Qdrant write failed');
      }

      return {
        id: `qdrant_${Date.now()}`,
        status: 'success',
      };
    }),

    searchInsights: vi.fn(async () => []),

    writeInsightWithContent: vi.fn(async (brainId: string, payload: unknown) => {
      _writeCalls.push({ collection: 'insights', payload });

      if (options.writeShouldFail) {
        return { success: false, pointId: '', error: 'Write failed' };
      }

      return {
        success: true,
        pointId: `qdrant_${Date.now()}`,
      };
    }),

    updateApplicationStats: vi.fn(async () => true),

    archiveInsight: vi.fn(async () => true),

    // Test inspection methods
    _searchCalls,
    _writeCalls,
    _duplicateChecks,
    _reset: () => {
      _searchCalls.length = 0;
      _writeCalls.length = 0;
      _duplicateChecks.length = 0;
    },
  };
}

// ===========================================
// Mock Slack Client
// ===========================================

export interface MockSlackClientOptions {
  /** Should postMessage throw an error */
  postMessageShouldFail?: boolean;
  /** Should updateMessage throw an error */
  updateMessageShouldFail?: boolean;
}

export interface SlackMessageCall {
  channel: string;
  blocks: unknown[];
  text?: string;
  threadTs?: string;
}

export interface SlackUpdateCall {
  channel: string;
  ts: string;
  blocks: unknown[];
}

export function createMockSlackClient(options: MockSlackClientOptions = {}) {
  const _postMessageCalls: SlackMessageCall[] = [];
  const _updateMessageCalls: SlackUpdateCall[] = [];

  let messageCounter = 1000000;

  return {
    postMessage: vi.fn(
      async (channel: string, blocks: unknown[], opts?: { text?: string; threadTs?: string }) => {
        _postMessageCalls.push({
          channel,
          blocks,
          text: opts?.text,
          threadTs: opts?.threadTs,
        });

        if (options.postMessageShouldFail) {
          throw new Error('Slack postMessage failed');
        }

        return {
          ok: true,
          ts: `${++messageCounter}.123456`,
          channel,
        };
      }
    ),

    updateMessage: vi.fn(async (channel: string, ts: string, blocks: unknown[]) => {
      _updateMessageCalls.push({ channel, ts, blocks });

      if (options.updateMessageShouldFail) {
        throw new Error('Slack updateMessage failed');
      }

      return {
        ok: true,
        ts,
        channel,
      };
    }),

    // Validation-specific methods
    sendValidationRequest: vi.fn(async (validationItem: unknown) => {
      _postMessageCalls.push({
        channel: 'learning-loop-validations',
        blocks: [],
        text: 'Validation request',
      });

      if (options.postMessageShouldFail) {
        throw new Error('Slack sendValidationRequest failed');
      }

      return {
        ok: true,
        ts: `${++messageCounter}.123456`,
        channel: 'learning-loop-validations',
      };
    }),

    updateValidationMessage: vi.fn(async (channel: string, ts: string, status: string) => {
      _updateMessageCalls.push({ channel, ts, blocks: [] });

      if (options.updateMessageShouldFail) {
        throw new Error('Slack updateValidationMessage failed');
      }

      return {
        ok: true,
        ts,
        channel,
      };
    }),

    // Test inspection methods
    _postMessageCalls,
    _updateMessageCalls,
    _sendValidationCalls: [] as Array<unknown>,
    _reset: () => {
      _postMessageCalls.length = 0;
      _updateMessageCalls.length = 0;
      messageCounter = 1000000;
    },
  };
}

// ===========================================
// Mock Redis Client
// ===========================================

export interface MockRedisClientOptions {
  /** Initial data to populate the store */
  initialData?: Record<string, string>;
  /** Should operations throw an error */
  shouldFail?: boolean;
}

export function createMockRedisClient(options: MockRedisClientOptions = {}) {
  const store: Map<string, { value: string; expiresAt: number | null }> = new Map();

  // Initialize with provided data
  if (options.initialData) {
    for (const [key, value] of Object.entries(options.initialData)) {
      store.set(key, { value, expiresAt: null });
    }
  }

  const _getCalls: string[] = [];
  const _setCalls: Array<{ key: string; value: string; ttl?: number }> = [];
  const _delCalls: string[] = [];

  return {
    get: vi.fn(async (key: string): Promise<string | null> => {
      _getCalls.push(key);

      if (options.shouldFail) {
        throw new Error('Redis get failed');
      }

      const entry = store.get(key);
      if (!entry) return null;

      // Check expiration
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }

      return entry.value;
    }),

    set: vi.fn(
      async (key: string, value: string, opts?: { ex?: number }): Promise<void> => {
        _setCalls.push({ key, value, ttl: opts?.ex });

        if (options.shouldFail) {
          throw new Error('Redis set failed');
        }

        const expiresAt = opts?.ex ? Date.now() + opts.ex * 1000 : null;
        store.set(key, { value, expiresAt });
      }
    ),

    del: vi.fn(async (key: string): Promise<void> => {
      _delCalls.push(key);

      if (options.shouldFail) {
        throw new Error('Redis del failed');
      }

      store.delete(key);
    }),

    ping: vi.fn(async (): Promise<boolean> => {
      if (options.shouldFail) {
        throw new Error('Redis ping failed');
      }
      return true;
    }),

    keys: vi.fn(async (pattern: string): Promise<string[]> => {
      if (options.shouldFail) {
        throw new Error('Redis keys failed');
      }

      // Simple pattern matching (just handles * wildcard)
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return Array.from(store.keys()).filter(key => regex.test(key));
    }),

    // Test inspection methods
    _store: store,
    _getCalls,
    _setCalls,
    _delCalls,
    _reset: () => {
      store.clear();
      _getCalls.length = 0;
      _setCalls.length = 0;
      _delCalls.length = 0;
    },
  };
}

// ===========================================
// Mock State Manager
// ===========================================

export interface MockStateManagerOptions {
  /** Initial brain ID */
  brainId?: string;
  /** Initial metrics */
  initialMetrics?: {
    insightsExtracted?: number;
    insightsValidated?: number;
    insightsAutoApproved?: number;
    insightsRejected?: number;
    kbWrites?: number;
    extractionErrors?: number;
    avgExtractionMs?: number;
  };
}

export function createMockStateManager(options: MockStateManagerOptions = {}) {
  let brainId = options.brainId ?? TEST_BRAIN_ID;
  const recentInsights: Array<{ insight_id: string; content_hash: string; category: InsightCategory }> = [];
  let pendingValidations = 0;

  const metrics = {
    insightsExtracted: options.initialMetrics?.insightsExtracted ?? 0,
    insightsValidated: options.initialMetrics?.insightsValidated ?? 0,
    insightsAutoApproved: options.initialMetrics?.insightsAutoApproved ?? 0,
    insightsRejected: options.initialMetrics?.insightsRejected ?? 0,
    kbWrites: options.initialMetrics?.kbWrites ?? 0,
    extractionErrors: options.initialMetrics?.extractionErrors ?? 0,
    avgExtractionMs: options.initialMetrics?.avgExtractionMs ?? 0,
  };

  const _checkpointCalls: Array<{ timestamp: string }> = [];
  const _errorRecords: Array<{ type: string; message: string; context?: unknown }> = [];

  return {
    getBrainId: vi.fn(() => brainId),
    setBrainId: vi.fn((id: string) => {
      brainId = id;
    }),

    findDuplicateInsight: vi.fn((contentKey: string) => {
      const found = recentInsights.find(i => i.content_hash === contentKey);
      return found ? { insight_id: found.insight_id, category: found.category } : null;
    }),

    addRecentInsight: vi.fn((insightData: { insight_id: string; content_hash?: string; category: InsightCategory } | string, contentHash?: string, category?: InsightCategory) => {
      if (typeof insightData === 'object') {
        recentInsights.push({
          insight_id: insightData.insight_id,
          content_hash: insightData.content_hash ?? '',
          category: insightData.category,
        });
      } else {
        recentInsights.push({
          insight_id: insightData,
          content_hash: contentHash ?? '',
          category: category ?? 'pain_point',
        });
      }
    }),

    getPendingValidationCount: vi.fn(() => pendingValidations),
    setPendingValidationCount: vi.fn((count: number) => {
      pendingValidations = count;
    }),
    incrementPendingValidations: vi.fn(() => {
      pendingValidations++;
    }),
    decrementPendingValidations: vi.fn(() => {
      pendingValidations = Math.max(0, pendingValidations - 1);
    }),

    addPendingValidation: vi.fn((validation: { validation_id: string; insight_id: string; brain_id: string }) => {
      pendingValidations++;
    }),

    removePendingValidation: vi.fn((validationId: string) => {
      pendingValidations = Math.max(0, pendingValidations - 1);
    }),

    recordKBWrite: vi.fn(() => {
      metrics.kbWrites++;
    }),

    recordAutoApproval: vi.fn(() => {
      metrics.insightsAutoApproved++;
    }),

    completeValidation: vi.fn((validationId: string, approved: boolean) => {
      if (approved) {
        metrics.insightsValidated++;
      } else {
        metrics.insightsRejected++;
      }
      pendingValidations = Math.max(0, pendingValidations - 1);
    }),

    getSessionStats: vi.fn(() => ({
      insightsExtracted: metrics.insightsExtracted,
      insightsValidated: metrics.insightsValidated,
      insightsAutoApproved: metrics.insightsAutoApproved,
      insightsRejected: metrics.insightsRejected,
      kbWrites: metrics.kbWrites,
      pendingValidations,
      extractionErrors: metrics.extractionErrors,
      avgExtractionMs: metrics.avgExtractionMs,
    })),

    getMetrics: vi.fn(() => metrics),

    updateMetrics: vi.fn((updates: Partial<typeof metrics>) => {
      Object.assign(metrics, updates);
    }),

    incrementInsightsExtracted: vi.fn(() => {
      metrics.insightsExtracted++;
    }),

    incrementInsightsValidated: vi.fn(() => {
      metrics.insightsValidated++;
    }),

    incrementInsightsAutoApproved: vi.fn(() => {
      metrics.insightsAutoApproved++;
    }),

    incrementInsightsRejected: vi.fn(() => {
      metrics.insightsRejected++;
    }),

    incrementKbWrites: vi.fn(() => {
      metrics.kbWrites++;
    }),

    incrementExtractionErrors: vi.fn(() => {
      metrics.extractionErrors++;
    }),

    updateExtractionTime: vi.fn((ms: number) => {
      const total = metrics.avgExtractionMs * metrics.insightsExtracted;
      metrics.avgExtractionMs = (total + ms) / (metrics.insightsExtracted + 1);
    }),

    recordError: vi.fn((type: string, message: string, context?: unknown) => {
      _errorRecords.push({ type, message, context });
    }),

    checkpoint: vi.fn(async () => {
      _checkpointCalls.push({ timestamp: new Date().toISOString() });
    }),

    recordReminderSent: vi.fn((validationId: string) => {
      // Track reminder sent
    }),

    load: vi.fn(async () => {}),
    save: vi.fn(async () => {}),

    // Test inspection
    _recentInsights: recentInsights,
    _metrics: metrics,
    _checkpointCalls,
    _errorRecords,
    _reset: () => {
      brainId = options.brainId ?? TEST_BRAIN_ID;
      recentInsights.length = 0;
      pendingValidations = 0;
      Object.assign(metrics, {
        insightsExtracted: 0,
        insightsValidated: 0,
        insightsAutoApproved: 0,
        insightsRejected: 0,
        kbWrites: 0,
        extractionErrors: 0,
        avgExtractionMs: 0,
      });
      _checkpointCalls.length = 0;
      _errorRecords.length = 0;
    },
  };
}

// ===========================================
// Mock Anthropic Client
// ===========================================

export interface MockAnthropicClientOptions {
  /** Pre-configured response content */
  responseContent?: string;
  /** Should the API call fail */
  shouldFail?: boolean;
  /** Error message if shouldFail is true */
  errorMessage?: string;
}

export function createMockAnthropicClient(options: MockAnthropicClientOptions = {}) {
  const _createCalls: Array<{
    model: string;
    system: string;
    messages: Array<{ role: string; content: string }>;
  }> = [];

  const defaultResponse = JSON.stringify([
    {
      category: 'pain_point',
      content: 'Manual data entry taking 2+ hours daily',
      extracted_quote: 'We spend over 2 hours every day just entering data manually',
      importance: 'high',
      actionable: true,
      action_suggestion: 'Emphasize automation in follow-up',
      confidence: 0.9,
    },
  ]);

  return {
    messages: {
      create: vi.fn(
        async (opts: {
          model: string;
          max_tokens: number;
          temperature: number;
          system: string;
          messages: Array<{ role: string; content: string }>;
        }) => {
          _createCalls.push({
            model: opts.model,
            system: opts.system,
            messages: opts.messages,
          });

          if (options.shouldFail) {
            throw new Error(options.errorMessage ?? 'Anthropic API error');
          }

          return {
            id: 'msg_test_001',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: options.responseContent ?? defaultResponse,
              },
            ],
            model: opts.model,
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: 500,
              output_tokens: 200,
            },
          };
        }
      ),
    },
    _createCalls,
    _reset: () => {
      _createCalls.length = 0;
    },
  };
}

// ===========================================
// Mock Embedder Function
// ===========================================

export function createMockEmbedder() {
  const _embedCalls: string[] = [];

  return {
    embed: vi.fn(async (text: string): Promise<number[]> => {
      _embedCalls.push(text);
      // Return a deterministic mock embedding based on text length
      return Array.from({ length: 1024 }, (_, i) => (text.length + i) / 1000);
    }),
    _embedCalls,
    _reset: () => {
      _embedCalls.length = 0;
    },
  };
}

// ===========================================
// Mock MCP Tool Caller
// ===========================================

export function createMockMcpToolCaller() {
  const _toolCalls: Array<{ tool: string; params: unknown }> = [];
  const responses: Map<string, unknown> = new Map();

  return {
    call: vi.fn(async <T>(tool: string, params: Record<string, unknown>): Promise<T> => {
      _toolCalls.push({ tool, params });

      if (responses.has(tool)) {
        return responses.get(tool) as T;
      }

      // Default responses based on tool name
      if (tool.includes('search')) {
        return { results: [] } as T;
      }
      if (tool.includes('write')) {
        return { success: true, id: `id_${Date.now()}` } as T;
      }

      return {} as T;
    }),

    setResponse: (tool: string, response: unknown) => {
      responses.set(tool, response);
    },

    _toolCalls,
    _reset: () => {
      _toolCalls.length = 0;
      responses.clear();
    },
  };
}
