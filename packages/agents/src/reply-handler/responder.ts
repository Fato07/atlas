/**
 * Reply Handler Agent - Response Generator
 *
 * Generates personalized responses by filling templates with lead context
 * and applying Claude personalization. Implements FR-012, FR-013, FR-014.
 *
 * @module reply-handler/responder
 */

import Anthropic from '@anthropic-ai/sdk';
import type { KBMatch } from './contracts/handler-result';
import type { LeadContext } from './contracts/reply-input';
import type { TemplateVariables } from './types';
import { buildTemplateVariables } from './types';

// ===========================================
// Responder Configuration
// ===========================================

export interface ResponderConfig {
  /** Anthropic client for personalization */
  client: Anthropic;

  /** Campaign configuration */
  campaign: {
    senderName: string;
    meetingLink: string;
  };

  /** Personalization settings */
  personalization?: {
    /** Model to use for personalization */
    model?: string;

    /** Maximum tokens for personalization */
    maxTokens?: number;

    /** Enable/disable personalization */
    enabled?: boolean;
  };
}

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 512;

// ===========================================
// Template Variable Pattern
// ===========================================

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

// ===========================================
// Response Generator Class
// ===========================================

export class ResponseGenerator {
  private client: Anthropic;
  private campaign: ResponderConfig['campaign'];
  private personalization: Required<NonNullable<ResponderConfig['personalization']>>;

  constructor(config: ResponderConfig) {
    this.client = config.client;
    this.campaign = config.campaign;
    this.personalization = {
      model: config.personalization?.model ?? DEFAULT_MODEL,
      maxTokens: config.personalization?.maxTokens ?? DEFAULT_MAX_TOKENS,
      enabled: config.personalization?.enabled ?? true,
    };
  }

  // ===========================================
  // Main Response Generation
  // ===========================================

  /**
   * Generate a response from KB match and lead context
   */
  async generateResponse(params: {
    kbMatch: KBMatch;
    leadContext: LeadContext;
    replyText: string;
    threadContext?: string;
  }): Promise<{
    responseText: string;
    personalized: boolean;
    tokensUsed: number;
  }> {
    const { kbMatch, leadContext, replyText, threadContext } = params;

    // Step 1: Build template variables (FR-012)
    const variables = buildTemplateVariables(leadContext, {
      sender_name: this.campaign.senderName,
      meeting_link: this.campaign.meetingLink,
    });

    // Step 2: Fill template with variables (FR-012)
    let responseText = this.fillTemplate(kbMatch.content, variables);

    // Step 3: Apply personalization if enabled and instructions exist (FR-013)
    let tokensUsed = 0;
    let personalized = false;

    if (
      this.personalization.enabled &&
      kbMatch.personalization_instructions
    ) {
      const personalizedResult = await this.applyPersonalization({
        template: responseText,
        instructions: kbMatch.personalization_instructions,
        leadContext,
        replyText,
        threadContext,
      });

      responseText = personalizedResult.text;
      tokensUsed = personalizedResult.tokensUsed;
      personalized = true;
    }

    // Step 4: Final cleanup
    responseText = this.cleanupResponse(responseText);

    return {
      responseText,
      personalized,
      tokensUsed,
    };
  }

  // ===========================================
  // Template Filling (FR-012)
  // ===========================================

  /**
   * Fill template variables with values
   */
  fillTemplate(template: string, variables: TemplateVariables): string {
    return template.replace(VARIABLE_PATTERN, (match, varName) => {
      const key = varName.toLowerCase() as keyof TemplateVariables;
      const value = variables[key];

      if (value !== undefined && value !== null && value !== '') {
        return String(value);
      }

      // Return original placeholder if no value (will be logged as warning)
      return match;
    });
  }

  /**
   * Get list of variables in a template
   */
  getTemplateVariables(template: string): string[] {
    const matches = template.matchAll(VARIABLE_PATTERN);
    const variables: string[] = [];

    for (const match of matches) {
      const varName = match[1].toLowerCase();
      if (!variables.includes(varName)) {
        variables.push(varName);
      }
    }

    return variables;
  }

  /**
   * Check for unresolved variables
   */
  getUnresolvedVariables(text: string): string[] {
    const matches = text.matchAll(VARIABLE_PATTERN);
    return Array.from(matches, m => m[1]);
  }

  // ===========================================
  // Personalization (FR-013)
  // ===========================================

  /**
   * Apply Claude personalization to template
   */
  private async applyPersonalization(params: {
    template: string;
    instructions: string;
    leadContext: LeadContext;
    replyText: string;
    threadContext?: string;
  }): Promise<{ text: string; tokensUsed: number }> {
    const { template, instructions, leadContext, replyText, threadContext } = params;

    const systemPrompt = this.buildPersonalizationSystemPrompt(instructions);
    const userPrompt = this.buildPersonalizationUserPrompt(
      template,
      leadContext,
      replyText,
      threadContext
    );

    try {
      const response = await this.client.messages.create({
        model: this.personalization.model,
        max_tokens: this.personalization.maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text =
        response.content[0].type === 'text' ? response.content[0].text : template;
      const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

      // Extract just the response (remove any preamble/explanation)
      const cleanedText = this.extractPersonalizedResponse(text);

      return {
        text: cleanedText,
        tokensUsed,
      };
    } catch (error) {
      // Fallback to original template on error
      console.error('Personalization failed:', error);
      return {
        text: template,
        tokensUsed: 0,
      };
    }
  }

  private buildPersonalizationSystemPrompt(instructions: string): string {
    return `You are a professional sales email personalization assistant. Your task is to personalize email responses while maintaining their professional tone and core message.

PERSONALIZATION INSTRUCTIONS:
${instructions}

CRITICAL RULES (FR-014):
1. PRESERVE the template's core structure and call-to-action
2. PRESERVE any meeting links, scheduling links, or URLs
3. PRESERVE the sender's name and sign-off
4. ONLY personalize the greeting and body content as specified
5. Keep the tone professional and appropriate for B2B sales
6. DO NOT add new information not in the original template
7. DO NOT change the meaning or intent of the message
8. Output ONLY the personalized email text - no explanations or preamble

Your output should be the complete personalized email, ready to send.`;
  }

  private buildPersonalizationUserPrompt(
    template: string,
    leadContext: LeadContext,
    replyText: string,
    threadContext?: string
  ): string {
    let prompt = `Personalize this email response:\n\n---\n${template}\n---\n\n`;

    prompt += `LEAD CONTEXT:\n`;
    prompt += `- Name: ${leadContext.first_name ?? 'Unknown'} ${leadContext.last_name ?? ''}\n`;
    prompt += `- Company: ${leadContext.company ?? 'Unknown'}\n`;
    prompt += `- Title: ${leadContext.title ?? 'Unknown'}\n`;
    prompt += `- Industry: ${leadContext.industry ?? 'Unknown'}\n`;

    prompt += `\nTHEIR REPLY:\n${replyText}\n`;

    if (threadContext) {
      prompt += `\nPREVIOUS CONVERSATION CONTEXT:\n${threadContext}\n`;
    }

    prompt += `\nOutput the personalized email:`;

    return prompt;
  }

  private extractPersonalizedResponse(text: string): string {
    // Remove common preambles
    const preambles = [
      /^here['']?s the personalized.*?:\s*/i,
      /^personalized email:\s*/i,
      /^here is the personalized.*?:\s*/i,
      /^the personalized response.*?:\s*/i,
    ];

    let cleaned = text.trim();
    for (const preamble of preambles) {
      cleaned = cleaned.replace(preamble, '');
    }

    return cleaned.trim();
  }

  // ===========================================
  // Response Cleanup
  // ===========================================

  /**
   * Clean up final response
   */
  private cleanupResponse(text: string): string {
    return text
      // Remove extra whitespace
      .replace(/\n{3,}/g, '\n\n')
      // Trim leading/trailing whitespace
      .trim();
  }

  // ===========================================
  // Response Validation
  // ===========================================

  /**
   * Validate response before sending
   */
  validateResponse(response: string): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check for unresolved variables
    const unresolved = this.getUnresolvedVariables(response);
    if (unresolved.length > 0) {
      issues.push(`Unresolved variables: ${unresolved.join(', ')}`);
    }

    // Check minimum length
    if (response.trim().length < 20) {
      issues.push('Response too short');
    }

    // Check for common issues
    if (response.includes('[PERSONALIZE')) {
      issues.push('Contains unprocessed personalization marker');
    }

    if (response.includes('undefined') || response.includes('null')) {
      issues.push('Contains undefined/null values');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a response generator
 */
export function createResponder(config: ResponderConfig): ResponseGenerator {
  return new ResponseGenerator(config);
}

// ===========================================
// Template Utilities
// ===========================================

/**
 * Preview template with sample variables
 */
export function previewTemplate(
  template: string,
  sampleVariables?: Partial<TemplateVariables>
): string {
  const defaults: TemplateVariables = {
    first_name: 'John',
    last_name: 'Smith',
    company: 'Acme Corp',
    title: 'VP Engineering',
    email: 'john@acme.com',
    industry: 'Technology',
    sender_name: 'Sarah',
    meeting_link: 'https://calendly.com/example',
    ...sampleVariables,
  };

  return template.replace(VARIABLE_PATTERN, (match, varName) => {
    const key = varName.toLowerCase() as keyof TemplateVariables;
    return defaults[key] ?? `[${varName}]`;
  });
}

/**
 * Validate template syntax
 */
export function validateTemplate(template: string): {
  valid: boolean;
  variables: string[];
  issues: string[];
} {
  const issues: string[] = [];
  const variables: string[] = [];

  // Extract variables
  const matches = template.matchAll(VARIABLE_PATTERN);
  for (const match of matches) {
    variables.push(match[1].toLowerCase());
  }

  // Check for malformed variables
  const malformedPattern = /\{[^}]+\}(?!\})|(?<!\{)\{[^{]/g;
  const malformed = template.match(malformedPattern);
  if (malformed) {
    issues.push(`Malformed variable syntax: ${malformed.join(', ')}`);
  }

  // Check for empty template
  if (template.trim().length === 0) {
    issues.push('Template is empty');
  }

  // Check for common placeholder mistakes
  if (template.includes('{{first name}}') || template.includes('{{ first_name }}')) {
    issues.push('Variable names should not have spaces');
  }

  return {
    valid: issues.length === 0,
    variables: [...new Set(variables)],
    issues,
  };
}
