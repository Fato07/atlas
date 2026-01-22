/**
 * Reply Handler - Category B (Not Interested) Workflow
 *
 * Handles leads with clear negative signals or opt-outs.
 * Implements: FR-009, FR-010, FR-011, FR-012
 *
 * Actions:
 * 1. Update Airtable status to "not_interested" (FR-011)
 * 2. Generate profile summary for future reference (FR-009)
 * 3. Evaluate referral potential (FR-010)
 * 4. Auto-send referral request to VP+ polite decliners (FR-012)
 *
 * @module reply-handler/category-b
 */

import type { McpToolFunction } from './mcp-bridge';
import type { ReplyHandlerLogger } from './logger';
import {
  type CategoryBInput,
  type CategoryBOutput,
  type ReferralEvaluation,
  type LeadReference,
  type ReplyReference,
  createAirtableUpdateInput,
  isVpPlusLevel,
  shouldAutoSendReferral,
} from './contracts';

// ===========================================
// Configuration
// ===========================================

export interface CategoryBConfig {
  /** MCP client function for tool calls */
  callMcpTool: McpToolFunction;

  /** Logger instance */
  logger: ReplyHandlerLogger;

  /** Whether to auto-send referral requests */
  autoSendReferrals?: boolean;

  /** Delay before sending referral (ms) */
  referralDelayMs?: number;

  /** Referral request template */
  referralTemplate?: string;
}

const DEFAULT_REFERRAL_DELAY_MS = 30000; // 30 seconds

const DEFAULT_REFERRAL_TEMPLATE = `Hi {firstName},

I completely understand - timing is everything.

Would you happen to know anyone in your network who might be facing {painPoint} challenges right now? A quick introduction would mean a lot.

Either way, best of luck with your projects!`;

// ===========================================
// Category B Workflow
// ===========================================

/**
 * Execute Category B (Not Interested) workflow.
 *
 * This workflow handles leads that have clearly declined or opted out.
 * It gracefully closes the lead, generates a summary for reference,
 * and evaluates referral potential for high-value contacts.
 *
 * @example
 * ```typescript
 * const result = await executeCategoryBWorkflow(input, config);
 * if (result.referral_sent) {
 *   console.log('Referral request sent to VP+ contact');
 * }
 * ```
 */
export async function executeCategoryBWorkflow(
  input: CategoryBInput,
  config: CategoryBConfig
): Promise<CategoryBOutput> {
  const { reply, lead, brain_id, classification } = input;
  const { callMcpTool, logger } = config;

  const errors: string[] = [];

  logger.info('Starting Category B workflow', {
    reply_id: reply.id,
    lead_id: lead.id,
    brain_id,
    confidence: classification.confidence,
  });

  // ===========================================
  // Step 1: Update Airtable status (FR-011)
  // ===========================================
  let airtableUpdated = false;
  try {
    const airtableInput = createAirtableUpdateInput(lead.id, 'B');
    await callMcpTool('airtable_update_lead', {
      lead_id: airtableInput.lead_id,
      status: airtableInput.status,
      classification: airtableInput.classification,
      last_reply_at: airtableInput.last_reply_at,
    });
    airtableUpdated = true;
    logger.info('Airtable lead status updated to not_interested', {
      reply_id: reply.id,
      lead_id: lead.id,
    });
  } catch (error) {
    const errorMsg = `Airtable update failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMsg);
    logger.error('Airtable update failed', error as Error, {
      reply_id: reply.id,
      lead_id: lead.id,
    });
  }

  // ===========================================
  // Step 2: Generate profile summary (FR-009)
  // ===========================================
  let profileSummaryGenerated = false;
  let profileSummary: string | undefined;
  try {
    profileSummary = generateProfileSummary(lead, reply, classification);
    profileSummaryGenerated = true;

    // Store summary in Airtable for future reference
    await callMcpTool('airtable_update_lead', {
      lead_id: lead.id,
      profile_summary: profileSummary,
      decline_reason: classification.reasoning,
    });

    logger.info('Profile summary generated', {
      reply_id: reply.id,
      lead_id: lead.id,
      summary_length: profileSummary.length,
    });
  } catch (error) {
    const errorMsg = `Profile summary generation failed: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(errorMsg);
    logger.error('Profile summary generation failed', error as Error, {
      reply_id: reply.id,
      lead_id: lead.id,
    });
  }

  // ===========================================
  // Step 3: Evaluate referral potential (FR-010)
  // ===========================================
  const referralEvaluation = evaluateReferralPotential(lead, reply, classification);

  logger.info('Referral potential evaluated', {
    reply_id: reply.id,
    lead_id: lead.id,
    is_vp_plus: referralEvaluation.is_vp_plus,
    decline_tone: referralEvaluation.decline_tone,
    network_fit: referralEvaluation.network_fit,
    referral_potential: referralEvaluation.referral_potential,
    auto_send_referral: referralEvaluation.auto_send_referral,
  });

  // ===========================================
  // Step 4: Auto-send referral request (FR-012)
  // VP+ + polite + aligned = auto-send
  // ===========================================
  let referralSent = false;
  let referralSentAt: string | undefined;

  if (
    config.autoSendReferrals !== false &&
    referralEvaluation.auto_send_referral &&
    shouldAutoSendReferral(referralEvaluation)
  ) {
    try {
      // Apply delay before sending referral
      const delay = config.referralDelayMs ?? DEFAULT_REFERRAL_DELAY_MS;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const referralMessage = buildReferralMessage(
        lead,
        config.referralTemplate ?? DEFAULT_REFERRAL_TEMPLATE
      );

      if (reply.channel === 'email') {
        await callMcpTool('instantly_send_reply', {
          campaign_id: reply.campaign_id,
          lead_email: lead.email,
          reply_body: referralMessage,
        });
      } else {
        // LinkedIn message
        await callMcpTool('heyreach_send_message', {
          lead_linkedin_url: lead.linkedin_url,
          message: referralMessage,
        });
      }

      referralSent = true;
      referralSentAt = new Date().toISOString();

      logger.info('Referral request sent', {
        reply_id: reply.id,
        lead_id: lead.id,
        channel: reply.channel,
        title: lead.title,
      });
    } catch (error) {
      const errorMsg = `Referral send failed: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
      logger.error('Referral request send failed', error as Error, {
        reply_id: reply.id,
        lead_id: lead.id,
      });
    }
  } else if (referralEvaluation.referral_potential && !referralEvaluation.auto_send_referral) {
    // Flag for manual follow-up (not VP+ or not polite enough for auto-send)
    logger.info('Referral potential flagged for manual follow-up', {
      reply_id: reply.id,
      lead_id: lead.id,
      reason: 'Does not meet auto-send criteria',
    });

    try {
      await callMcpTool('airtable_update_lead', {
        lead_id: lead.id,
        referral_potential: true,
        referral_auto_sent: false,
      });
    } catch (error) {
      logger.warn('Failed to flag referral potential', {
        reply_id: reply.id,
        lead_id: lead.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ===========================================
  // Build Result
  // ===========================================
  const success = airtableUpdated && profileSummaryGenerated;

  logger.info('Category B workflow completed', {
    reply_id: reply.id,
    lead_id: lead.id,
    success,
    airtable_updated: airtableUpdated,
    profile_summary_generated: profileSummaryGenerated,
    referral_sent: referralSent,
    error_count: errors.length,
  });

  return {
    success,
    lead_status_updated: airtableUpdated,
    new_status: 'not_interested',
    profile_summary_generated: profileSummaryGenerated,
    profile_summary: profileSummary,
    referral_evaluation: referralEvaluation,
    referral_sent: referralSent,
    referral_sent_at: referralSentAt,
    airtable_updated: airtableUpdated,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ===========================================
// Helper Functions
// ===========================================

/**
 * Generate profile summary for future reference (FR-009)
 */
function generateProfileSummary(
  lead: LeadReference,
  reply: ReplyReference,
  classification: CategoryBInput['classification']
): string {
  const name = lead.name || 'Unknown';
  const company = lead.company || 'Unknown Company';
  const title = lead.title || 'Unknown Role';

  const declineDate = new Date().toISOString().split('T')[0];

  return `**Lead Summary (Declined ${declineDate})**

- **Name**: ${name}
- **Title**: ${title}
- **Company**: ${company}
- **Email**: ${lead.email}
- **LinkedIn**: ${lead.linkedin_url || 'N/A'}

**Decline Details**:
- Channel: ${reply.channel}
- Response: "${reply.reply_text.slice(0, 200)}${reply.reply_text.length > 200 ? '...' : ''}"
- Classification Reasoning: ${classification.reasoning}

**Notes**: Lead declined outreach. Profile preserved for potential future re-engagement or referral networking.`;
}

/**
 * Evaluate referral potential based on seniority, tone, and network fit (FR-010)
 */
function evaluateReferralPotential(
  lead: LeadReference,
  reply: ReplyReference,
  classification: CategoryBInput['classification']
): ReferralEvaluation {
  // Check VP+ level (FR-010)
  const isVpPlus = isVpPlusLevel(lead.title);

  // Analyze decline tone from reply text
  const declineTone = analyzeDeclineTone(reply.reply_text);

  // Assess network fit (simplified - in production would check ICP alignment)
  const networkFit = assessNetworkFit(lead, classification);

  // Determine referral potential
  const referralPotential = isVpPlus && declineTone !== 'hostile' && networkFit !== 'misaligned';

  // Auto-send only for VP+ + polite + aligned (FR-012)
  const autoSendReferral = isVpPlus && declineTone === 'polite' && networkFit === 'aligned';

  return {
    is_vp_plus: isVpPlus,
    decline_tone: declineTone,
    network_fit: networkFit,
    referral_potential: referralPotential,
    auto_send_referral: autoSendReferral,
  };
}

/**
 * Analyze the tone of the decline response
 */
function analyzeDeclineTone(replyText: string): 'polite' | 'neutral' | 'hostile' {
  const text = replyText.toLowerCase();

  // Hostile indicators
  const hostileIndicators = [
    'stop',
    'spam',
    'remove',
    'unsubscribe',
    'never',
    "don't contact",
    "don't email",
    'harassment',
    'report',
    'block',
    'legal',
  ];

  // Polite indicators
  const politeIndicators = [
    'thank',
    'appreciate',
    'best',
    'good luck',
    'wish you',
    'unfortunately',
    "i'm afraid",
    'not at this time',
    'maybe later',
    'reach out later',
    'kind regards',
    'cheers',
  ];

  const hasHostile = hostileIndicators.some((indicator) => text.includes(indicator));
  const hasPolite = politeIndicators.some((indicator) => text.includes(indicator));

  if (hasHostile) return 'hostile';
  if (hasPolite) return 'polite';
  return 'neutral';
}

/**
 * Assess network fit based on lead context and ICP alignment
 */
function assessNetworkFit(
  lead: LeadReference,
  _classification: CategoryBInput['classification']
): 'aligned' | 'partial' | 'misaligned' {
  // In production, this would check:
  // - Lead's company industry vs our ICP industries
  // - Lead's company size vs our target company sizes
  // - Lead's network likely contains similar profiles

  // For now, use simple heuristics
  const title = lead.title?.toLowerCase() ?? '';
  const company = lead.company?.toLowerCase() ?? '';

  // Tech/SaaS companies are more aligned for referrals
  const alignedCompanyIndicators = [
    'tech',
    'software',
    'saas',
    'digital',
    'platform',
    'solutions',
    'ai',
    'cloud',
    'data',
  ];

  // Senior roles likely have better networks
  const seniorRoles = [
    'ceo',
    'cto',
    'cfo',
    'founder',
    'partner',
    'vp',
    'director',
    'head',
    'chief',
    'president',
  ];

  const hasAlignedCompany = alignedCompanyIndicators.some((ind) => company.includes(ind));
  const hasSeniorRole = seniorRoles.some((role) => title.includes(role));

  if (hasAlignedCompany && hasSeniorRole) return 'aligned';
  if (hasAlignedCompany || hasSeniorRole) return 'partial';
  return 'misaligned';
}

/**
 * Build referral request message
 */
function buildReferralMessage(lead: LeadReference, template: string): string {
  const firstName = extractFirstName(lead.name) || 'there';

  // Default pain point - in production would be pulled from ICP definition
  const painPoint = 'outbound sales efficiency';

  return template.replace('{firstName}', firstName).replace('{painPoint}', painPoint);
}

/**
 * Extract first name from full name
 */
function extractFirstName(name?: string): string | undefined {
  if (!name) return undefined;
  return name.split(' ')[0];
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a Category B workflow executor with configuration
 */
export function createCategoryBExecutor(config: CategoryBConfig) {
  return (input: CategoryBInput) => executeCategoryBWorkflow(input, config);
}
