/**
 * Tool Builder Utility
 *
 * Wrapper for Anthropic's betaTool helper to create structured output tools
 * from Zod schemas. Provides type-safe tool definitions for Claude API calls.
 *
 * @module @atlas-gtm/lib/structured-outputs
 */

import type { Tool, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { zodToJsonSchema } from './zod-to-schema';
import type { ZodSchema, ZodType, z } from 'zod';

/**
 * Configuration for building a structured output tool
 */
export interface ToolBuilderConfig<T extends ZodSchema> {
  /** Unique name for the tool */
  name: string;
  /** Description of what the tool does (shown to Claude) */
  description: string;
  /** Zod schema defining the expected output structure */
  schema: T;
}

/**
 * A built tool ready for use with Claude API
 */
export interface BuiltTool<T> {
  /** The tool definition for Claude API */
  tool: Tool;
  /** Parse and validate the tool result */
  parse: (result: unknown) => T;
  /** The tool name for reference */
  name: string;
}

/**
 * Build a structured output tool from a Zod schema.
 *
 * This creates a tool definition compatible with the Anthropic SDK's
 * tool use feature, allowing Claude to return structured JSON data
 * that matches the provided schema.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { buildTool } from '@atlas-gtm/lib/structured-outputs';
 *
 * const BriefSchema = z.object({
 *   quick_context: z.string(),
 *   talking_points: z.array(z.string()),
 * });
 *
 * const briefTool = buildTool({
 *   name: 'generate_brief',
 *   description: 'Generate a pre-call brief with context and talking points',
 *   schema: BriefSchema,
 * });
 *
 * // Use with Anthropic SDK
 * const response = await client.messages.create({
 *   model: 'claude-sonnet-4-20250514',
 *   tools: [briefTool.tool],
 *   tool_choice: { type: 'tool', name: briefTool.name },
 *   messages: [...],
 * });
 *
 * // Parse the result
 * const brief = briefTool.parse(response.content[0].input);
 * ```
 */
export function buildTool<T extends ZodSchema>(
  config: ToolBuilderConfig<T>,
): BuiltTool<z.infer<T>> {
  const jsonSchema = zodToJsonSchema(config.schema);

  const tool: Tool = {
    name: config.name,
    description: config.description,
    input_schema: jsonSchema as Tool['input_schema'],
  };

  return {
    tool,
    name: config.name,
    parse: (result: unknown): z.infer<T> => {
      return config.schema.parse(result);
    },
  };
}

/**
 * Extract tool result from a Claude message response.
 *
 * Finds the first tool_use block matching the specified tool name
 * and returns its input.
 *
 * @param content - The message content blocks from Claude's response
 * @param toolName - The name of the tool to extract
 * @returns The tool input or null if not found
 */
export function extractToolResult(
  content: Array<{ type: string; name?: string; input?: unknown }>,
  toolName: string,
): unknown | null {
  const toolUse = content.find(
    (block) => block.type === 'tool_use' && block.name === toolName,
  );
  return toolUse?.input ?? null;
}

/**
 * Create tool_choice configuration to force a specific tool.
 *
 * @param toolName - The name of the tool to force
 * @returns Tool choice configuration for Anthropic SDK
 */
export function forceToolChoice(toolName: string): { type: 'tool'; name: string } {
  return { type: 'tool', name: toolName };
}

/**
 * Helper to create a structured output request with forced tool use.
 *
 * @param tool - The built tool to use
 * @param messages - The conversation messages
 * @returns Configuration object for Anthropic SDK create call
 */
export function createStructuredRequest<T>(
  tool: BuiltTool<T>,
  messages: MessageParam[],
): {
  tools: Tool[];
  tool_choice: { type: 'tool'; name: string };
  messages: MessageParam[];
} {
  return {
    tools: [tool.tool],
    tool_choice: forceToolChoice(tool.name),
    messages,
  };
}
