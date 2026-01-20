/**
 * Structured Outputs Module
 *
 * Utilities for creating structured output tools with Zod schemas
 * for use with Anthropic's Claude API tool use feature.
 *
 * @module @atlas-gtm/lib/structured-outputs
 */

export {
  buildTool,
  extractToolResult,
  forceToolChoice,
  createStructuredRequest,
  type ToolBuilderConfig,
  type BuiltTool,
} from './tool-builder';

export {
  zodToJsonSchema,
  zodToNamedSchema,
  validateToolSchema,
  type JsonSchema,
} from './zod-to-schema';
