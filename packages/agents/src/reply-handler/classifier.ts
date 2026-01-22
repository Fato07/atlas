/**
 * Reply Handler Agent - Reply Classifier
 *
 * Classifies reply intent, sentiment, and complexity using Claude.
 * Implements FR-002 (intent classification), FR-003 (sentiment analysis),
 * and FR-004 (complexity assessment).
 *
 * @module reply-handler/classifier
 */

import Anthropic from '@anthropic-ai/sdk';
import { extractToolResult, forceToolChoice } from '@atlas-gtm/lib';
import type {
  Classification,
  Intent,
  Complexity,
  Urgency,
} from './contracts/handler-result';
import { CLASSIFICATION_TOOL, type ClassificationResult } from './contracts/classification-tool';
import {
  CATEGORY_CLASSIFICATION_TOOL,
  type ClassificationCategory,
  type ClassificationResult as CategoryClassificationResult,
  getEffectiveCategory,
} from './contracts/classification-result';
import { parseEmailReply, detectAutoReply, getWordCount } from './email-parser';

// ===========================================
// Classification Configuration
// ===========================================

export interface ClassifierConfig {
  /** Anthropic client instance */
  client: Anthropic;

  /** Model to use for classification */
  model?: string;

  /** Maximum tokens for classification response */
  maxTokens?: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 1024;

// ===========================================
// Intent Detection Patterns
// ===========================================

/**
 * Heuristic patterns for fast intent pre-detection
 */
const INTENT_PATTERNS: Record<Intent, RegExp[]> = {
  positive_interest: [
    /\b(interested|love to|would like to|let'?s|sounds good|sign me up)\b/i,
    /\b(schedule|book|set up|arrange).*(call|meeting|demo|chat)\b/i,
    /\b(want to|keen to|excited to).*(learn|know|hear|see)\b/i,
    /\byes,?\s+(please|let'?s|i'?d like|that works)\b/i,
    /\bgreat,?\s+(let'?s|sounds|i'?m in)\b/i,
  ],
  question: [
    /\?\s*$/m,
    /\b(what|when|where|who|why|how|which|can you|could you|do you)\b/i,
    /\b(pricing|price|cost|rate|fee|package)\b/i,
    /\b(how does|how do|how much|how long)\b/i,
    /\b(tell me more|more info|more information|details)\b/i,
  ],
  objection: [
    /\b(budget|afford|expensive|cost too much|too pricey)\b/i,
    /\b(not the right time|bad timing|maybe later|next quarter|next year)\b/i,
    /\b(already using|current solution|happy with|competitor|alternative)\b/i,
    /\b(need to check|need approval|talk to|run it by|decision maker)\b/i,
    /\b(not interested right now|revisit later|circle back)\b/i,
  ],
  referral: [
    /\b(not the right person|wrong person|try reaching|contact instead|better suited)\b/i,
    /\b(forward|forwarding|passing|pass this to|send to|cc'?ing)\b/i,
    /\b(you should talk to|speak with|reach out to)\b/i,
    /\b(handles this|responsible for|in charge of)\b/i,
  ],
  unsubscribe: [
    /\b(unsubscribe|opt out|remove me|stop emailing|stop contacting)\b/i,
    /\b(take me off|don'?t email|don'?t contact|leave me alone)\b/i,
    /\b(no more emails|stop sending)\b/i,
  ],
  not_interested: [
    /\b(not interested|no thank(s)?|pass|decline|not for us|not a fit)\b/i,
    /\b(don'?t need|we'?re good|all set|covered|sorted)\b/i,
    /\b(thanks,?\s*but no|appreciate,?\s*but)\b/i,
  ],
  out_of_office: [
    /\b(out of office|out of the office|away from|on vacation|on leave)\b/i,
    /\b(automatic reply|auto-?reply|will respond when|limited access)\b/i,
    /\b(returning|back on|back in the office)\b/i,
  ],
  bounce: [
    /\b(delivery failed|undeliverable|mail delivery|message not delivered)\b/i,
    /\b(mailbox not found|user unknown|address rejected)\b/i,
    /\b(permanent failure|550|553|5\.\d\.\d)\b/i,
  ],
  unclear: [], // No patterns - fallback
};

// ===========================================
// Classifier Class
// ===========================================

export class ReplyClassifier {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: ClassifierConfig) {
    this.client = config.client;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  // ===========================================
  // Main Classification Method
  // ===========================================

  /**
   * Classify a reply's intent, sentiment, and complexity
   */
  async classify(params: {
    replyText: string;
    leadName?: string;
    leadCompany?: string;
    lastSentTemplate?: string;
    threadContext?: string;
  }): Promise<Classification> {
    const startTime = Date.now();

    // Step 1: Parse email to extract new content
    const parsed = parseEmailReply(params.replyText);
    const cleanContent = parsed.newContent;

    // Step 2: Check for auto-reply (fast path)
    const autoReply = detectAutoReply(cleanContent);
    if (autoReply.isAutoReply) {
      return this.createAutoReplyClassification(autoReply.type!, startTime);
    }

    // Step 3: Heuristic pre-classification
    const heuristicIntent = this.detectIntentHeuristic(cleanContent);

    // Step 4: Use Claude for full classification
    const claudeResult = await this.classifyWithClaude({
      content: cleanContent,
      heuristicIntent,
      leadName: params.leadName,
      leadCompany: params.leadCompany,
      lastSentTemplate: params.lastSentTemplate,
      threadContext: params.threadContext,
    });

    // Step 5: Assess complexity
    const complexity = this.assessComplexity(
      cleanContent,
      claudeResult.intent,
      claudeResult.sentiment,
      claudeResult.confidence
    );

    // Step 6: Derive urgency
    const urgency = this.deriveUrgency(
      claudeResult.intent,
      claudeResult.sentiment,
      complexity
    );

    // Step 7: Build classification result
    return {
      intent: claudeResult.intent,
      intent_confidence: claudeResult.confidence,
      intent_reasoning: claudeResult.reasoning,
      sentiment: claudeResult.sentiment,
      complexity,
      urgency,
      reply_type: this.mapIntentToReplyType(claudeResult.intent),
      classified_at: new Date().toISOString(),
      model_version: this.model,
      tokens_used: claudeResult.tokensUsed,
    };
  }

  // ===========================================
  // Heuristic Detection
  // ===========================================

  /**
   * Fast heuristic intent detection using patterns
   */
  private detectIntentHeuristic(content: string): Intent | undefined {
    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          return intent as Intent;
        }
      }
    }
    return undefined;
  }

  // ===========================================
  // Claude Classification
  // ===========================================

  /**
   * Use Claude for detailed classification with structured outputs
   */
  private async classifyWithClaude(params: {
    content: string;
    heuristicIntent?: Intent;
    leadName?: string;
    leadCompany?: string;
    lastSentTemplate?: string;
    threadContext?: string;
  }): Promise<{
    intent: Intent;
    confidence: number;
    sentiment: number;
    reasoning: string;
    tokensUsed: number;
  }> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(params);

    // Use structured outputs via tool use pattern
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      tools: [CLASSIFICATION_TOOL.tool],
      tool_choice: forceToolChoice(CLASSIFICATION_TOOL.name),
      messages: [{ role: 'user', content: userPrompt }],
    });

    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    // Extract tool result using structured output helper
    const toolResult = extractToolResult(response.content, CLASSIFICATION_TOOL.name);
    if (!toolResult) {
      return {
        intent: 'unclear',
        confidence: 0.5,
        sentiment: 0,
        reasoning: 'No tool result returned from classification',
        tokensUsed,
      };
    }

    // Parse and validate with Zod schema (type-safe!)
    try {
      const parsed = CLASSIFICATION_TOOL.parse(toolResult) as ClassificationResult;
      return {
        intent: parsed.intent,
        confidence: parsed.intent_confidence,
        sentiment: parsed.sentiment,
        reasoning: parsed.intent_reasoning,
        tokensUsed,
      };
    } catch (error) {
      return {
        intent: 'unclear',
        confidence: 0.5,
        sentiment: 0,
        reasoning: `Failed to parse classification: ${error instanceof Error ? error.message : 'Unknown error'}`,
        tokensUsed,
      };
    }
  }

  private buildSystemPrompt(): string {
    return `You are an expert sales reply classifier for B2B outreach. Your task is to analyze email replies and determine:

1. INTENT - What the sender wants:
   - positive_interest: Wants to learn more, schedule call, see demo, engage further
   - question: Asking about pricing, features, timeline, process
   - objection: Budget concerns, timing issues, competitor preference, authority/decision-maker issues
   - referral: Wrong person, suggesting someone else to contact
   - unsubscribe: Wants to opt out of future emails
   - not_interested: Polite decline, not a fit
   - out_of_office: Automatic vacation/OOO reply
   - bounce: Email delivery failure
   - unclear: Cannot determine intent

2. COMPLEXITY - How complex is the required response:
   - simple: Straightforward reply, single intent
   - medium: Requires some context or consideration
   - complex: Multi-part response or nuanced handling needed

3. URGENCY - How quickly should we respond:
   - low: Can wait, non-time-sensitive
   - medium: Respond within reasonable time
   - high: Time-sensitive, needs immediate attention

4. SENTIMENT (-1.0 to 1.0): -1.0 very negative to +1.0 very positive

Use the classify_reply tool to provide your structured analysis.`;
  }

  private buildUserPrompt(params: {
    content: string;
    heuristicIntent?: Intent;
    leadName?: string;
    leadCompany?: string;
    lastSentTemplate?: string;
    threadContext?: string;
  }): string {
    let prompt = `Classify this email reply:\n\n---\n${params.content}\n---\n`;

    if (params.leadName || params.leadCompany) {
      prompt += `\nContext: From ${params.leadName || 'Unknown'} at ${params.leadCompany || 'Unknown Company'}`;
    }

    if (params.lastSentTemplate) {
      prompt += `\n\nPrevious outreach was about: ${params.lastSentTemplate}`;
    }

    if (params.heuristicIntent) {
      prompt += `\n\nInitial pattern match suggests: ${params.heuristicIntent} (verify this)`;
    }

    prompt += '\n\nUse the classify_reply tool to provide your analysis.';

    return prompt;
  }

  // ===========================================
  // Complexity Assessment (FR-004)
  // ===========================================

  /**
   * Assess reply complexity based on spec.md criteria
   */
  private assessComplexity(
    content: string,
    intent: Intent,
    sentiment: number,
    confidence: number
  ): Complexity {
    const wordCount = getWordCount(content);

    // Simple criteria per FR-004:
    // - Single intent, positive/neutral sentiment, reply length < 100 words, KB match confidence >= 0.70
    const isSimple =
      sentiment >= -0.3 &&
      wordCount < 100 &&
      confidence >= 0.7 &&
      this.isSingleIntent(content);

    // Complex criteria per FR-004:
    // - Multiple intents, negative sentiment, reply length > 300 words, KB match confidence < 0.50,
    //   or contains questions requiring custom answers
    const isComplex =
      sentiment < -0.5 ||
      wordCount > 300 ||
      confidence < 0.5 ||
      this.hasMultipleIntents(content) ||
      this.requiresCustomAnswer(content);

    if (isComplex) return 'complex';
    if (isSimple) return 'simple';
    return 'medium';
  }

  private isSingleIntent(content: string): boolean {
    // Count how many intent patterns match
    let matchCount = 0;
    for (const patterns of Object.values(INTENT_PATTERNS)) {
      if (patterns.some(p => p.test(content))) {
        matchCount++;
      }
    }
    return matchCount <= 1;
  }

  private hasMultipleIntents(content: string): boolean {
    // Multiple questions or mixed signals
    const questionCount = (content.match(/\?/g) || []).length;
    return questionCount > 2;
  }

  private requiresCustomAnswer(content: string): boolean {
    // Check for specific technical questions that need custom answers
    const customIndicators = [
      /\b(specifically|particular|exact|specific)\b/i,
      /\b(our (industry|company|situation|case))\b/i,
      /\b(integrate|integration|API|connect)\b/i,
      /\b(customize|customization|tailor)\b/i,
    ];
    return customIndicators.some(p => p.test(content));
  }

  // ===========================================
  // Urgency Derivation
  // ===========================================

  /**
   * Derive urgency from intent, sentiment, and complexity
   */
  private deriveUrgency(
    intent: Intent,
    sentiment: number,
    complexity: Complexity
  ): Urgency {
    // High urgency: positive interest or negative sentiment
    if (intent === 'positive_interest') return 'high';
    if (sentiment < -0.5) return 'high';

    // Low urgency: non-actionable intents
    if (['out_of_office', 'bounce', 'unsubscribe'].includes(intent)) return 'low';

    // Medium urgency: questions, objections, referrals
    if (['question', 'objection', 'referral'].includes(intent)) return 'medium';

    // Default based on complexity
    return complexity === 'complex' ? 'medium' : 'low';
  }

  // ===========================================
  // Reply Type Mapping
  // ===========================================

  /**
   * Map intent to reply type for KB matching
   */
  private mapIntentToReplyType(intent: Intent): string {
    const mapping: Record<Intent, string> = {
      positive_interest: 'positive_response',
      question: 'question_response',
      objection: 'objection_handler',
      referral: 'referral_response',
      unsubscribe: 'unsubscribe_confirmation',
      not_interested: 'decline_acknowledgment',
      out_of_office: 'ooo_handling',
      bounce: 'bounce_handling',
      unclear: 'clarification_request',
    };
    return mapping[intent];
  }

  // ===========================================
  // Auto-Reply Classification
  // ===========================================

  /**
   * Create classification for detected auto-replies
   */
  private createAutoReplyClassification(
    type: 'ooo' | 'bounce' | 'auto_response',
    startTime: number
  ): Classification {
    const intent: Intent = type === 'ooo' ? 'out_of_office' : type === 'bounce' ? 'bounce' : 'unclear';

    return {
      intent,
      intent_confidence: 0.95,
      intent_reasoning: `Detected ${type} auto-reply pattern`,
      sentiment: 0,
      complexity: 'simple',
      urgency: 'low',
      reply_type: this.mapIntentToReplyType(intent),
      classified_at: new Date().toISOString(),
      model_version: 'heuristic',
      tokens_used: 0,
    };
  }
}

// ===========================================
// A/B/C Category Classification (GTM Operations)
// ===========================================

/**
 * Classify a reply into Category A/B/C for GTM operations routing
 *
 * Implements FR-003: Classify replies into exactly one of three categories
 * - Category A: Interested (positive buying signals)
 * - Category B: Not Interested (negative signals or opt-out)
 * - Category C: Manual Review (ambiguous, requires human judgment)
 */
export async function classifyReplyCategory(
  client: Anthropic,
  params: {
    replyText: string;
    channel: 'email' | 'linkedin';
    leadContext?: {
      name?: string;
      company?: string;
      title?: string;
      industry?: string;
    };
    conversationHistory?: Array<{
      role: 'outbound' | 'reply';
      content: string;
    }>;
  },
  options?: {
    model?: string;
    maxTokens?: number;
  }
): Promise<{
  category: ClassificationCategory;
  effectiveCategory: ClassificationCategory;
  confidence: number;
  reasoning: string;
  signals: string[];
  tokensUsed: number;
}> {
  const model = options?.model ?? 'claude-sonnet-4-20250514';
  const maxTokens = options?.maxTokens ?? 1024;

  // Parse email to extract new content
  const parsed = parseEmailReply(params.replyText);
  const cleanContent = parsed.newContent;

  // Check for auto-reply (Category B - non-actionable)
  const autoReply = detectAutoReply(cleanContent);
  if (autoReply.isAutoReply) {
    return {
      category: 'B',
      effectiveCategory: 'B',
      confidence: 0.95,
      reasoning: `Detected ${autoReply.type} auto-reply pattern - not a human response`,
      signals: [autoReply.type ?? 'auto_reply'],
      tokensUsed: 0,
    };
  }

  // Build system prompt for A/B/C classification
  const systemPrompt = `You are an expert at classifying sales reply intent for a GTM operations system.

Your task is to classify each reply into EXACTLY ONE of three categories:

## Category A - INTERESTED
Clear positive buying signals. The prospect wants to engage further.
Signals:
- "Yes", "Let's talk", "I'm interested"
- Meeting/call requests, calendar availability
- Demo requests, wanting to learn more
- Positive acknowledgment of the value proposition

## Category B - NOT INTERESTED
Clear negative signals or explicit opt-out. The prospect does not want to engage.
Signals:
- "No thanks", "Not interested", "Pass"
- Unsubscribe requests, "Stop emailing me"
- Hostile or rude responses
- Clear "not a fit" or "already have a solution"
- Out-of-office replies (non-actionable)
- Bounce/delivery failures

## Category C - MANUAL REVIEW
Ambiguous replies that require human judgment. Could go either way.
Signals:
- Questions about pricing, features, timeline
- Objections (budget, timing, authority)
- "Maybe later", "Send more info"
- Referrals to another person
- Conditional interest ("If you can do X...")
- Mixed signals or unclear intent

## Rules:
1. If confidence is below 0.7, default to Category C (human review)
2. When in doubt, choose C - it's safer to have humans review than to misroute
3. Consider the tone and context, not just keywords

Use the classify_reply_category tool to provide your structured classification.`;

  // Build user prompt
  let userPrompt = `Classify this ${params.channel} reply into Category A, B, or C:\n\n---\n${cleanContent}\n---`;

  if (params.leadContext) {
    const ctx = params.leadContext;
    userPrompt += `\n\nLead Context:`;
    if (ctx.name) userPrompt += `\n- Name: ${ctx.name}`;
    if (ctx.company) userPrompt += `\n- Company: ${ctx.company}`;
    if (ctx.title) userPrompt += `\n- Title: ${ctx.title}`;
    if (ctx.industry) userPrompt += `\n- Industry: ${ctx.industry}`;
  }

  if (params.conversationHistory && params.conversationHistory.length > 0) {
    userPrompt += `\n\nConversation History (most recent last):`;
    for (const msg of params.conversationHistory.slice(-3)) {
      userPrompt += `\n[${msg.role}]: ${msg.content.slice(0, 200)}${msg.content.length > 200 ? '...' : ''}`;
    }
  }

  userPrompt += '\n\nProvide your classification using the classify_reply_category tool.';

  // Call Claude with structured output
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    tools: [CATEGORY_CLASSIFICATION_TOOL.tool],
    tool_choice: forceToolChoice(CATEGORY_CLASSIFICATION_TOOL.name),
    messages: [{ role: 'user', content: userPrompt }],
  });

  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

  // Extract and parse tool result
  const toolResult = extractToolResult(response.content, CATEGORY_CLASSIFICATION_TOOL.name);
  if (!toolResult) {
    return {
      category: 'C',
      effectiveCategory: 'C',
      confidence: 0.5,
      reasoning: 'No tool result returned from classification - defaulting to manual review',
      signals: [],
      tokensUsed,
    };
  }

  try {
    const parsed = CATEGORY_CLASSIFICATION_TOOL.parse(toolResult) as CategoryClassificationResult;
    const effectiveCategory = getEffectiveCategory(parsed);

    return {
      category: parsed.category,
      effectiveCategory,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      signals: parsed.signals,
      tokensUsed,
    };
  } catch (error) {
    return {
      category: 'C',
      effectiveCategory: 'C',
      confidence: 0.5,
      reasoning: `Failed to parse classification: ${error instanceof Error ? error.message : 'Unknown error'}`,
      signals: [],
      tokensUsed,
    };
  }
}

/**
 * Map detailed intent to A/B/C category
 *
 * Useful for converting legacy intent-based classification to category routing
 */
export function intentToCategory(intent: Intent): ClassificationCategory {
  const categoryA: Intent[] = ['positive_interest'];
  const categoryB: Intent[] = ['unsubscribe', 'not_interested', 'out_of_office', 'bounce'];

  if (categoryA.includes(intent)) return 'A';
  if (categoryB.includes(intent)) return 'B';
  return 'C'; // question, objection, referral, unclear
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a reply classifier
 */
export function createClassifier(config: ClassifierConfig): ReplyClassifier {
  return new ReplyClassifier(config);
}
