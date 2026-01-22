/**
 * Reply Handler Agent - Voyage AI Embedder
 *
 * Creates embeddings using Voyage AI's API for KB vector search.
 * Uses voyage-3-lite model which produces 1024-dimension vectors.
 *
 * @module reply-handler/embedder
 */

// ===========================================
// Types
// ===========================================

export interface VoyageEmbeddingResponse {
  object: 'list';
  data: Array<{
    object: 'embedding';
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

export interface EmbedderConfig {
  /** Voyage AI API key */
  apiKey: string;
  /** Model to use (default: voyage-3-lite) */
  model?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

// ===========================================
// Constants
// ===========================================

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
// voyage-3 produces 1024-dimension vectors, matching our Qdrant collections
const DEFAULT_MODEL = 'voyage-3';
const DEFAULT_TIMEOUT = 30000;

// ===========================================
// Embedder Factory
// ===========================================

/**
 * Create a Voyage AI embedder function.
 *
 * @param config - Embedder configuration (API key or full config)
 * @returns Async function that generates embeddings
 *
 * @example
 * ```typescript
 * const embedder = createVoyageEmbedder({
 *   apiKey: process.env.VOYAGE_API_KEY!,
 *   model: 'voyage-3-lite',
 * });
 *
 * const embedding = await embedder('This is a sample text');
 * console.log(embedding.length); // 1024
 * ```
 */
export function createVoyageEmbedder(config: EmbedderConfig | string) {
  const { apiKey, model = DEFAULT_MODEL, timeout = DEFAULT_TIMEOUT } =
    typeof config === 'string' ? { apiKey: config } : config;

  if (!apiKey) {
    throw new Error('Voyage AI API key is required');
  }

  /**
   * Generate embedding for a text input.
   *
   * @param text - Text to embed
   * @returns 1024-dimension embedding vector
   * @throws Error if the API call fails
   */
  return async function embed(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(VOYAGE_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text,
          model,
          input_type: 'query', // Optimize for search queries
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(
          `Voyage AI embedding failed with status ${response.status}: ${errorText}`
        );
      }

      const data = (await response.json()) as VoyageEmbeddingResponse;

      if (!data.data || data.data.length === 0) {
        throw new Error('Voyage AI returned empty embedding response');
      }

      return data.data[0].embedding;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Voyage AI embedding timed out after ${timeout}ms`);
      }

      throw error;
    }
  };
}

/**
 * Create an embedder for batch operations.
 *
 * @param config - Embedder configuration
 * @returns Async function that generates embeddings for multiple texts
 */
export function createBatchEmbedder(config: EmbedderConfig | string) {
  const { apiKey, model = DEFAULT_MODEL, timeout = DEFAULT_TIMEOUT } =
    typeof config === 'string' ? { apiKey: config } : config;

  if (!apiKey) {
    throw new Error('Voyage AI API key is required');
  }

  /**
   * Generate embeddings for multiple texts.
   *
   * @param texts - Array of texts to embed
   * @returns Array of 1024-dimension embedding vectors
   */
  return async function embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(VOYAGE_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: texts,
          model,
          input_type: 'document',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(
          `Voyage AI batch embedding failed with status ${response.status}: ${errorText}`
        );
      }

      const data = (await response.json()) as VoyageEmbeddingResponse;

      // Sort by index to ensure correct ordering
      return data.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Voyage AI batch embedding timed out after ${timeout}ms`);
      }

      throw error;
    }
  };
}

// ===========================================
// Mock Embedder for Testing
// ===========================================

/**
 * Create a mock embedder for testing.
 * Returns a fixed 1024-dimension vector.
 *
 * @param dimension - Vector dimension (default: 1024)
 * @returns Mock embed function
 */
export function createMockEmbedder(dimension = 1024) {
  let callCount = 0;

  return async function mockEmbed(_text: string): Promise<number[]> {
    callCount++;
    // Generate deterministic but unique vectors based on call count
    return Array.from(
      { length: dimension },
      (_, i) => Math.sin(i + callCount) * 0.5
    );
  };
}

// ===========================================
// Type Exports
// ===========================================

export type EmbedFunction = ReturnType<typeof createVoyageEmbedder>;
export type BatchEmbedFunction = ReturnType<typeof createBatchEmbedder>;
