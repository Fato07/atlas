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
import type {
  Classification,
  Intent,
  Complexity,
  Urgency,
} from './contracts/handler-result';
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
   * Use Claude for detailed classification
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

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Parse response
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    return this.parseClassificationResponse(text, tokensUsed);
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

2. CONFIDENCE (0.0-1.0): How certain you are about the intent classification

3. SENTIMENT (-1.0 to 1.0):
   - -1.0: Very negative (angry, hostile, frustrated)
   - 0.0: Neutral
   - 1.0: Very positive (enthusiastic, excited, grateful)

4. REASONING: Brief explanation of why you chose this classification

Output your analysis in this exact JSON format:
{
  "intent": "<intent>",
  "confidence": <0.0-1.0>,
  "sentiment": <-1.0 to 1.0>,
  "reasoning": "<brief explanation>"
}`;
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

    prompt += '\n\nProvide your classification as JSON:';

    return prompt;
  }

  private parseClassificationResponse(
    text: string,
    tokensUsed: number
  ): {
    intent: Intent;
    confidence: number;
    sentiment: number;
    reasoning: string;
    tokensUsed: number;
  } {
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        intent: 'unclear',
        confidence: 0.5,
        sentiment: 0,
        reasoning: 'Failed to parse classification response',
        tokensUsed,
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        intent: this.validateIntent(parsed.intent),
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
        sentiment: Math.max(-1, Math.min(1, parsed.sentiment ?? 0)),
        reasoning: parsed.reasoning ?? 'No reasoning provided',
        tokensUsed,
      };
    } catch {
      return {
        intent: 'unclear',
        confidence: 0.5,
        sentiment: 0,
        reasoning: 'Failed to parse JSON response',
        tokensUsed,
      };
    }
  }

  private validateIntent(intent: string): Intent {
    const validIntents: Intent[] = [
      'positive_interest',
      'question',
      'objection',
      'referral',
      'unsubscribe',
      'not_interested',
      'out_of_office',
      'bounce',
      'unclear',
    ];

    return validIntents.includes(intent as Intent) ? (intent as Intent) : 'unclear';
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
// Factory Function
// ===========================================

/**
 * Create a reply classifier
 */
export function createClassifier(config: ClassifierConfig): ReplyClassifier {
  return new ReplyClassifier(config);
}
