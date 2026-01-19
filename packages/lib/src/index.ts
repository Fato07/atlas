/**
 * Atlas GTM Library
 *
 * Shared utilities for the Atlas GTM system.
 */

// Types
export * from './types';

// Embeddings
export {
  embedDocument,
  embedQuery,
  embeddingService,
} from './embeddings';

// Observability (Langfuse integration)
export * from './observability';

// Security (Lakera Guard integration)
export * from './security';
