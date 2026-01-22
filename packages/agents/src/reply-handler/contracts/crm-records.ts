/**
 * Reply Handler - CRM and Enrichment Contracts
 *
 * Defines schemas for Attio CRM records and Airtable lead records.
 *
 * Implements:
 * - FR-005: Create CRM record with "New Reply" stage
 * - FR-025: Sync lead data from Airtable to Attio
 * - FR-026: Bidirectional reference between Airtable and Attio
 *
 * @module reply-handler/contracts/crm-records
 */

import { z } from 'zod';

// ===========================================
// Lead Status (Airtable)
// ===========================================

/**
 * Lead status in Airtable
 */
export const LeadStatusSchema = z.enum([
  'new',
  'enriched',
  'in_sequence',
  'replied',
  'pending_review', // Category C
  'not_interested', // Category B / DNC
  'booked',
  'converted',
]);

export type LeadStatus = z.infer<typeof LeadStatusSchema>;

// ===========================================
// Pipeline Stage (Attio CRM)
// ===========================================

/**
 * Attio pipeline stages
 */
export const PipelineStageSchema = z.enum([
  'new_reply',
  'qualifying',
  'meeting_scheduled',
  'meeting_held',
  'proposal',
  'closed_won',
  'closed_lost',
]);

export type PipelineStage = z.infer<typeof PipelineStageSchema>;

// ===========================================
// Airtable Lead Record
// ===========================================

/**
 * Lead record from Airtable (Lead data hub)
 */
export const AirtableLeadSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  linkedin_url: z.string().url().optional(),

  // Status tracking
  status: LeadStatusSchema,
  classification: z.enum(['A', 'B', 'C']).optional(),

  // Sequence tracking
  email_campaign_id: z.string().optional(),
  linkedin_campaign_id: z.string().optional(),
  sequence_started_at: z.string().datetime().optional(),
  last_reply_at: z.string().datetime().optional(),

  // Enrichment data
  company_size: z.number().int().positive().optional(),
  industry: z.string().optional(),
  enrichment_data: z.record(z.unknown()).optional(),

  // Scoring
  icp_score: z.number().min(0).max(100).optional(),
  is_high_quality: z.boolean().optional(),

  // CRM reference (FR-026)
  attio_record_id: z.string().optional(),
});

export type AirtableLead = z.infer<typeof AirtableLeadSchema>;

// ===========================================
// Attio CRM Record
// ===========================================

/**
 * Activity type for CRM records
 */
export const ActivityTypeSchema = z.enum([
  'reply_received',
  'meeting_scheduled',
  'note_added',
  'stage_changed',
  'enrichment_completed',
  'calendar_link_sent',
]);

export type ActivityType = z.infer<typeof ActivityTypeSchema>;

/**
 * Activity log entry
 */
export const CRMActivitySchema = z.object({
  type: ActivityTypeSchema,
  content: z.string(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

export type CRMActivity = z.infer<typeof CRMActivitySchema>;

/**
 * CRM record for Attio (FR-005)
 *
 * Only created for Category A (interested) leads
 */
export const AttioRecordSchema = z.object({
  id: z.string().uuid(),

  // Lead identity
  lead_id: z.string(), // Airtable reference (FR-026)
  email: z.string().email(),
  name: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),

  // Pipeline (FR-005: "New Reply" stage)
  stage: PipelineStageSchema,

  // Timestamps
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),

  // Source tracking
  source_channel: z.enum(['email', 'linkedin']),
  source_campaign_id: z.string(),
  source_reply_id: z.string(),

  // Classification data
  classification_confidence: z.number().min(0).max(1),
  classification_reasoning: z.string().optional(),

  // Enrichment (FR-006, FR-021-023 - Phase 2)
  profile_summary: z.string().optional(),
  pre_call_brief: z.string().optional(),

  // Activity log
  activities: z.array(CRMActivitySchema).optional(),
});

export type AttioRecord = z.infer<typeof AttioRecordSchema>;

// ===========================================
// CRM Creation Input
// ===========================================

/**
 * Input for creating an Attio CRM record
 */
export const CreateAttioRecordInputSchema = z.object({
  lead_id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),

  // Source
  source_channel: z.enum(['email', 'linkedin']),
  source_campaign_id: z.string(),
  source_reply_id: z.string(),

  // Classification
  classification_confidence: z.number().min(0).max(1),
  classification_reasoning: z.string().optional(),
});

export type CreateAttioRecordInput = z.infer<typeof CreateAttioRecordInputSchema>;

// ===========================================
// Airtable Update Input
// ===========================================

/**
 * Input for updating Airtable lead status
 */
export const UpdateAirtableLeadInputSchema = z.object({
  lead_id: z.string(),
  status: LeadStatusSchema,
  classification: z.enum(['A', 'B', 'C']).optional(),
  last_reply_at: z.string().datetime().optional(),
  attio_record_id: z.string().optional(), // FR-026: bidirectional reference
});

export type UpdateAirtableLeadInput = z.infer<typeof UpdateAirtableLeadInputSchema>;

// ===========================================
// Helper Functions
// ===========================================

/**
 * Create input for new Attio record from Category A workflow
 */
export function createAttioRecordInput(params: {
  leadId: string;
  email: string;
  name?: string;
  company?: string;
  title?: string;
  channel: 'email' | 'linkedin';
  campaignId: string;
  replyId: string;
  confidence: number;
  reasoning?: string;
}): CreateAttioRecordInput {
  return {
    lead_id: params.leadId,
    email: params.email,
    name: params.name,
    company: params.company,
    title: params.title,
    source_channel: params.channel,
    source_campaign_id: params.campaignId,
    source_reply_id: params.replyId,
    classification_confidence: params.confidence,
    classification_reasoning: params.reasoning,
  };
}

/**
 * Create input for updating Airtable lead after classification
 */
export function createAirtableUpdateInput(
  leadId: string,
  classification: 'A' | 'B' | 'C',
  attioRecordId?: string
): UpdateAirtableLeadInput {
  const statusMap: Record<'A' | 'B' | 'C', LeadStatus> = {
    A: 'replied',
    B: 'not_interested',
    C: 'pending_review',
  };

  return {
    lead_id: leadId,
    status: statusMap[classification],
    classification,
    last_reply_at: new Date().toISOString(),
    attio_record_id: attioRecordId,
  };
}

/**
 * Check if lead is high-quality (executive title OR company >50)
 */
export function isHighQualityLead(lead: AirtableLead): boolean {
  const executiveTitles = [
    'ceo',
    'cto',
    'cfo',
    'coo',
    'cmo',
    'cio',
    'founder',
    'co-founder',
    'cofounder',
    'vp',
    'vice president',
    'director',
    'head of',
    'chief',
    'president',
  ];

  const titleLower = lead.title?.toLowerCase() ?? '';
  const hasExecutiveTitle = executiveTitles.some((t) => titleLower.includes(t));
  const hasLargeCompany = (lead.company_size ?? 0) > 50;

  return hasExecutiveTitle || hasLargeCompany;
}

/**
 * Create initial activity log entry
 */
export function createInitialActivity(
  channel: 'email' | 'linkedin',
  replyText: string
): CRMActivity {
  return {
    type: 'reply_received',
    content: `Interested reply received via ${channel}: "${replyText.slice(0, 100)}${replyText.length > 100 ? '...' : ''}"`,
    timestamp: new Date().toISOString(),
    metadata: { channel },
  };
}
