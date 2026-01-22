/**
 * Reply Handler - Classification Result Contract
 *
 * Defines the 3-category classification result schema for reply routing.
 * Categories: A (Interested), B (Not Interested), C (Manual Review)
 *
 * Implements: FR-003 (classify replies into exactly one of three categories)
 *
 * @module reply-handler/contracts/classification-result
 */

import { z } from 'zod';
import { buildTool } from '@atlas-gtm/lib';

// ===========================================
// Classification Category
// ===========================================

/**
 * Reply classification categories (FR-003)
 *
 * - A: Interested - Clear positive buying signals
 * - B: Not Interested - Clear negative signals or opt-out
 * - C: Manual Review - Ambiguous, requires human judgment
 */
export const ClassificationCategorySchema = z.enum(['A', 'B', 'C']);
export type ClassificationCategory = z.infer<typeof ClassificationCategorySchema>;

/**
 * Category descriptions for reference and prompts
 */
export const CATEGORY_DESCRIPTIONS = {
  A: 'Interested - Clear positive buying signals (meeting requests, interest expressed, wants to talk)',
  B: 'Not Interested - Clear negative signals or opt-out (no thanks, unsubscribe, stop contacting)',
  C: 'Manual Review - Ambiguous, requires human judgment (questions, objections, maybe later)',
} as const;

// ===========================================
// Classification Signals
// ===========================================

/**
 * Positive signals indicating Category A
 */
export const CATEGORY_A_SIGNALS = [
  'yes',
  "let's talk",
  'interested',
  'sounds good',
  'schedule',
  'book a call',
  'calendar',
  'meeting',
  'demo',
  'learn more',
  'tell me more',
  'when are you free',
] as const;

/**
 * Negative signals indicating Category B
 */
export const CATEGORY_B_SIGNALS = [
  'no thanks',
  'not interested',
  'unsubscribe',
  'remove me',
  'stop',
  "don't contact",
  'wrong person',
  'not a fit',
  'already have',
  'not relevant',
] as const;

/**
 * Ambiguous signals indicating Category C
 */
export const CATEGORY_C_SIGNALS = [
  'what is',
  'how much',
  'pricing',
  'maybe later',
  'not right now',
  'send more info',
  'can you explain',
  'next quarter',
  'budget',
  'talk to',
  'forward to',
] as const;

// ===========================================
// Classification Result Schema
// ===========================================

/**
 * Classification result from Claude (FR-003)
 *
 * Returned by CATEGORY_CLASSIFICATION_TOOL for type-safe structured outputs.
 */
export const ClassificationResultSchema = z.object({
  /**
   * Classification category (A, B, or C)
   */
  category: ClassificationCategorySchema.describe(
    'Classification category: A (Interested), B (Not Interested), or C (Manual Review)'
  ),

  /**
   * Confidence score (0.0 - 1.0)
   * >= 0.7: Auto-route to category workflow
   * < 0.7: Default to Category C for human review
   */
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence score (0.0-1.0). Below 0.7 routes to Category C.'),

  /**
   * Brief explanation of classification decision
   */
  reasoning: z
    .string()
    .min(1)
    .max(500)
    .describe('Brief explanation of why this category was chosen, citing specific signals'),

  /**
   * Key phrases that influenced the classification
   */
  signals: z
    .array(z.string().max(100))
    .max(5)
    .describe('Key phrases from the reply that influenced classification'),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

// ===========================================
// Classification Tool Definition
// ===========================================

/**
 * Structured output tool for 3-category classification.
 *
 * Usage:
 * ```typescript
 * const response = await anthropic.messages.create({
 *   model: 'claude-sonnet-4-20250514',
 *   tools: [CATEGORY_CLASSIFICATION_TOOL.tool],
 *   tool_choice: forceToolChoice(CATEGORY_CLASSIFICATION_TOOL.name),
 *   messages: [{ role: 'user', content: classificationPrompt }],
 * });
 *
 * const result = extractToolResult(response.content, CATEGORY_CLASSIFICATION_TOOL.name);
 * const classification = CATEGORY_CLASSIFICATION_TOOL.parse(result);
 * ```
 */
export const CATEGORY_CLASSIFICATION_TOOL = buildTool({
  name: 'classify_reply_category',
  description: `Classify an incoming reply into one of three categories:
- Category A (Interested): Clear positive buying signals. Triggers CRM creation, calendar link, LinkedIn connection.
- Category B (Not Interested): Clear negative signals or opt-out. Triggers DNC status, referral evaluation.
- Category C (Manual Review): Ambiguous, requires human judgment. Triggers pattern storage, similar pattern lookup, Slack notification.

Use confidence threshold of 0.7 for auto-routing. Below 0.7 defaults to Category C.`,
  schema: ClassificationResultSchema,
});

// ===========================================
// Helper Functions
// ===========================================

/**
 * Check if classification should auto-route or default to C
 * FR: Below 0.7 confidence routes to Category C
 */
export function shouldAutoRoute(classification: ClassificationResult): boolean {
  return classification.confidence >= 0.7;
}

/**
 * Get effective category (applies confidence threshold)
 */
export function getEffectiveCategory(
  classification: ClassificationResult
): ClassificationCategory {
  if (!shouldAutoRoute(classification)) {
    return 'C'; // Low confidence defaults to manual review
  }
  return classification.category;
}

/**
 * Validate classification result
 */
export function parseClassificationResult(data: unknown): ClassificationResult {
  return ClassificationResultSchema.parse(data);
}

/**
 * Safe parse with error details
 */
export function safeParseClassificationResult(data: unknown): {
  success: boolean;
  data?: ClassificationResult;
  error?: z.ZodError;
} {
  const result = ClassificationResultSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
