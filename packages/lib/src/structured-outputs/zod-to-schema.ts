/**
 * Zod to JSON Schema Converter
 *
 * Converts Zod schemas to JSON Schema format compatible with
 * Anthropic's tool use API.
 *
 * @module @atlas-gtm/lib/structured-outputs
 */

import { zodToJsonSchema as zodToJsonSchemaLib } from 'zod-to-json-schema';
import type { ZodSchema } from 'zod';

/**
 * JSON Schema type compatible with Anthropic's tool input_schema
 */
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  enum?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * Convert a Zod schema to JSON Schema format.
 *
 * This wrapper around zod-to-json-schema configures the output
 * for compatibility with Anthropic's tool use API:
 * - Removes $schema and $ref for cleaner output
 * - Targets JSON Schema draft-07 (compatible with Claude)
 * - Handles Zod-specific types like branded types
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { zodToJsonSchema } from '@atlas-gtm/lib/structured-outputs';
 *
 * const UserSchema = z.object({
 *   name: z.string().describe('User full name'),
 *   age: z.number().int().min(0),
 *   email: z.string().email(),
 * });
 *
 * const jsonSchema = zodToJsonSchema(UserSchema);
 * // {
 * //   type: 'object',
 * //   properties: {
 * //     name: { type: 'string', description: 'User full name' },
 * //     age: { type: 'integer', minimum: 0 },
 * //     email: { type: 'string', format: 'email' }
 * //   },
 * //   required: ['name', 'age', 'email']
 * // }
 * ```
 *
 * @param schema - The Zod schema to convert
 * @returns JSON Schema compatible with Anthropic's tool input_schema
 */
export function zodToJsonSchema(schema: ZodSchema): JsonSchema {
  const result = zodToJsonSchemaLib(schema, {
    // Remove $schema field for cleaner output
    $refStrategy: 'none',
    // Target JSON Schema draft-07 for Claude compatibility
    target: 'jsonSchema7',
  });

  // Remove the $schema property if present
  const { $schema, ...cleanSchema } = result as Record<string, unknown>;

  return cleanSchema as JsonSchema;
}

/**
 * Convert a Zod schema to JSON Schema with custom name.
 *
 * Useful for creating named definitions that can be referenced.
 *
 * @param schema - The Zod schema to convert
 * @param name - The name for the schema definition
 * @returns JSON Schema with the schema under a named definition
 */
export function zodToNamedSchema(
  schema: ZodSchema,
  name: string,
): { definitions: Record<string, JsonSchema>; $ref: string } {
  const jsonSchema = zodToJsonSchema(schema);

  return {
    definitions: {
      [name]: jsonSchema,
    },
    $ref: `#/definitions/${name}`,
  };
}

/**
 * Validate that a JSON Schema has the required structure for tool use.
 *
 * Checks that:
 * - Schema has a type property
 * - Object schemas have properties defined
 * - Required array contains valid property names
 *
 * @param schema - The JSON Schema to validate
 * @returns True if valid, throws error if invalid
 */
export function validateToolSchema(schema: JsonSchema): boolean {
  if (!schema.type) {
    throw new Error('Tool schema must have a type property');
  }

  if (schema.type === 'object') {
    if (!schema.properties || Object.keys(schema.properties).length === 0) {
      throw new Error('Object schema must have at least one property');
    }

    if (schema.required) {
      const propertyNames = Object.keys(schema.properties);
      for (const req of schema.required) {
        if (!propertyNames.includes(req)) {
          throw new Error(
            `Required property "${req}" not found in schema properties`,
          );
        }
      }
    }
  }

  return true;
}
