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

// Structured Outputs (Zod to JSON Schema for Claude tools)
export * from './structured-outputs';

// Vertical Registry (data-driven vertical detection)
export {
  VerticalRegistry,
  createVerticalRegistry,
  matchKeyword,
  matchCampaignPattern,
} from './vertical-registry';

// AI Classifier (Claude-powered vertical classification)
export { AIClassifier, createAIClassifier } from './ai-classifier';

// Brain Manager (runtime brain operations)
// Note: GetBrainOptions, BrainFilters, TemplateFilters are exported from './types'
export {
  BrainManager,
  createBrainManager,
  type BrainManagerConfig,
  type StoredBrain,
  type CreateBrainInput,
  type UpdateBrainInput,
  type CopyBrainOptions,
} from './brain-manager';

// Slack Utilities
export { parseSlackChannelId } from './slack-utils';
