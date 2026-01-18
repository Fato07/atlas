/**
 * Voyage AI Embedding Utilities
 *
 * Provides functions for generating 512-dimension vectors using Voyage AI's
 * voyage-3.5-lite model for semantic search and document storage.
 */

import type {
  EmbeddingConfig,
  EmbeddingResult,
  EmbeddingError,
  EmbeddingInputType,
} from './types';

// Configuration for voyage-3.5-lite model
// Note: voyage-3.5-lite outputs 1024 dimensions (not 512)
const EMBEDDING_CONFIG: EmbeddingConfig = {
  model: 'voyage-3.5-lite',
  dimension: 1024,
  maxTokens: 8000,
};

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

/**
 * Voyage AI API response structure
 */
interface VoyageApiResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

/**
 * Voyage AI API error response
 */
interface VoyageApiError {
  error?: {
    message: string;
    type: string;
    code?: string;
  };
  detail?: string;
}

/**
 * Truncate text to fit within token limit
 * Uses a rough estimate of 4 characters per token
 */
function truncateToTokenLimit(text: string, maxTokens: number): string {
  const estimatedCharsPerToken = 4;
  const maxChars = maxTokens * estimatedCharsPerToken;

  if (text.length <= maxChars) {
    return text;
  }

  // Truncate and add indicator
  return text.slice(0, maxChars - 3) + '...';
}

/**
 * Create an EmbeddingError object
 */
function createError(
  code: EmbeddingError['code'],
  message: string,
  retryAfterMs?: number
): EmbeddingError {
  return { code, message, retryAfterMs };
}

/**
 * Call Voyage AI embedding API
 */
async function callVoyageApi(
  text: string,
  inputType: EmbeddingInputType
): Promise<EmbeddingResult> {
  const apiKey = process.env.VOYAGE_API_KEY;

  if (!apiKey) {
    throw createError(
      'API_ERROR',
      'VOYAGE_API_KEY environment variable is not set'
    );
  }

  // Validate input
  if (!text || typeof text !== 'string') {
    throw createError('INVALID_INPUT', 'Input text must be a non-empty string');
  }

  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    throw createError('INVALID_INPUT', 'Input text cannot be empty or whitespace only');
  }

  // Truncate if needed
  const processedText = truncateToTokenLimit(trimmedText, EMBEDDING_CONFIG.maxTokens);

  try {
    const response = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: [processedText],
        model: EMBEDDING_CONFIG.model,
        input_type: inputType,
      }),
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      throw createError(
        'RATE_LIMITED',
        'Rate limit exceeded. Please retry after the specified time.',
        retryAfterMs
      );
    }

    // Handle other error responses
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as VoyageApiError;
      const errorMessage = errorBody.error?.message || errorBody.detail || `API error: ${response.status}`;
      throw createError('API_ERROR', errorMessage);
    }

    const data = await response.json() as VoyageApiResponse;

    // Validate response structure
    if (!data.data || !data.data[0] || !data.data[0].embedding) {
      throw createError('API_ERROR', 'Invalid response structure from Voyage API');
    }

    const embedding = data.data[0].embedding;

    // Verify dimension
    if (embedding.length !== EMBEDDING_CONFIG.dimension) {
      console.warn(
        `Warning: Expected ${EMBEDDING_CONFIG.dimension} dimensions, got ${embedding.length}`
      );
    }

    return {
      vector: embedding,
      model: data.model,
      inputType,
      tokensUsed: data.usage.total_tokens,
    };
  } catch (error) {
    // Re-throw EmbeddingErrors as-is
    if (error && typeof error === 'object' && 'code' in error) {
      throw error;
    }

    // Wrap other errors
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    throw createError('API_ERROR', message);
  }
}

/**
 * Embed a document for storage in Qdrant.
 * Uses "document" input type for optimal retrieval.
 *
 * @param text - Text content to embed
 * @returns 512-dimension vector with metadata
 * @throws EmbeddingError on failure
 *
 * @example
 * ```typescript
 * const result = await embedDocument("This is market research content.");
 * console.log(result.vector.length); // 512
 * ```
 */
export async function embedDocument(text: string): Promise<EmbeddingResult> {
  return callVoyageApi(text, 'document');
}

/**
 * Embed a query for searching Qdrant.
 * Uses "query" input type for optimal matching.
 *
 * @param text - Query text to embed
 * @returns 512-dimension vector with metadata
 * @throws EmbeddingError on failure
 *
 * @example
 * ```typescript
 * const result = await embedQuery("Find market research about AI");
 * console.log(result.vector.length); // 512
 * ```
 */
export async function embedQuery(text: string): Promise<EmbeddingResult> {
  return callVoyageApi(text, 'query');
}

/**
 * Embedding service object implementing EmbeddingService interface
 */
export const embeddingService = {
  embedDocument,
  embedQuery,
  config: EMBEDDING_CONFIG,
};

export default embeddingService;
