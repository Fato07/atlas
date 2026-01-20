/**
 * CRM Updater
 *
 * Updates CRM systems (Attio and Airtable) with meeting analysis results.
 * Creates tasks for action items and logs meeting activities.
 *
 * Implements FR-009 (Attio updates), FR-010 (Airtable updates).
 *
 * @module meeting-prep/crm-updater
 */

import type { BrainId } from '@atlas-gtm/lib';
import type { MeetingPrepLogger } from './logger';
import type {
  MeetingAnalysis,
  CRMUpdates,
  ActionItem,
} from './contracts/meeting-analysis';

// ===========================================
// Configuration
// ===========================================

export interface CRMUpdaterConfig {
  /** Create tasks for action items assigned to us */
  createTasks: boolean;

  /** Update pipeline stage based on qualification */
  updatePipelineStage: boolean;

  /** Log activities in CRM */
  logActivities: boolean;
}

export const DEFAULT_CRM_UPDATER_CONFIG: CRMUpdaterConfig = {
  createTasks: true,
  updatePipelineStage: true,
  logActivities: true,
};

export interface CRMUpdaterDependencies {
  /** MCP client function for tool calls */
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;

  /** Logger instance */
  logger: MeetingPrepLogger;
}

// ===========================================
// Types
// ===========================================

export interface UpdateCRMRequest {
  brainId: BrainId;
  analysis: MeetingAnalysis;
  attendeeEmail: string;

  /** Record IDs if already known */
  attioRecordId?: string;
  airtableRecordId?: string;
}

export interface UpdateCRMResult {
  success: true;
  updates: CRMUpdates;
}

export interface UpdateCRMError {
  success: false;
  error: string;
  code: 'ATTIO_ERROR' | 'AIRTABLE_ERROR' | 'PARTIAL_FAILURE';
  partialUpdates?: Partial<CRMUpdates>;
}

export type UpdateCRMOutput = UpdateCRMResult | UpdateCRMError;

// ===========================================
// Pipeline Stage Mapping
// ===========================================

const RECOMMENDATION_TO_STAGE: Record<string, string> = {
  hot: 'Qualified - Hot',
  warm: 'Qualified - Warm',
  nurture: 'Nurture',
  disqualify: 'Disqualified',
};

const RECOMMENDATION_TO_STATUS: Record<string, string> = {
  hot: 'qualified',
  warm: 'qualified',
  nurture: 'nurture',
  disqualify: 'disqualified',
};

// ===========================================
// CRM Updater Class
// ===========================================

export class CRMUpdater {
  private readonly config: CRMUpdaterConfig;
  private readonly deps: CRMUpdaterDependencies;

  constructor(
    deps: CRMUpdaterDependencies,
    config?: Partial<CRMUpdaterConfig>
  ) {
    this.config = { ...DEFAULT_CRM_UPDATER_CONFIG, ...config };
    this.deps = deps;
  }

  /**
   * Update CRM systems with meeting analysis results.
   */
  async update(request: UpdateCRMRequest): Promise<UpdateCRMOutput> {
    const { brainId, analysis, attendeeEmail } = request;
    const timer = this.deps.logger.startTimer();

    this.deps.logger.debug('Starting CRM updates', {
      meeting_id: analysis.meeting_id,
      analysis_id: analysis.analysis_id,
      attendee_email: attendeeEmail,
    });

    const updates: CRMUpdates = {
      attio: {
        pipeline_stage: null,
        deal_value: null,
        meeting_notes_added: false,
        tasks_created: [],
      },
      airtable: {
        status_updated: false,
        qualification_updated: false,
      },
    };

    const errors: string[] = [];

    // Update Attio
    try {
      const attioResult = await this.updateAttio(request, updates.attio);
      updates.attio = attioResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Attio: ${errorMessage}`);
      this.deps.logger.error('Attio update failed', {
        meeting_id: analysis.meeting_id,
        error: errorMessage,
      });
    }

    // Update Airtable
    try {
      const airtableResult = await this.updateAirtable(request, updates.airtable);
      updates.airtable = airtableResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Airtable: ${errorMessage}`);
      this.deps.logger.error('Airtable update failed', {
        meeting_id: analysis.meeting_id,
        error: errorMessage,
      });
    }

    // Log CRM updated event
    this.deps.logger.crmUpdated({
      meeting_id: analysis.meeting_id,
      brain_id: brainId,
      analysis_id: analysis.analysis_id,
      attio_updated: updates.attio.meeting_notes_added || updates.attio.pipeline_stage !== null,
      airtable_updated: updates.airtable.status_updated || updates.airtable.qualification_updated,
      attio_tasks_created: updates.attio.tasks_created.length,
      pipeline_stage: updates.attio.pipeline_stage ?? undefined,
    });

    // Determine result
    if (errors.length === 0) {
      return {
        success: true,
        updates,
      };
    }

    // Check if any updates succeeded
    const anySuccess =
      updates.attio.meeting_notes_added ||
      updates.attio.pipeline_stage !== null ||
      updates.airtable.status_updated ||
      updates.airtable.qualification_updated;

    if (anySuccess) {
      return {
        success: false,
        error: errors.join('; '),
        code: 'PARTIAL_FAILURE',
        partialUpdates: updates,
      };
    }

    // Complete failure
    return {
      success: false,
      error: errors.join('; '),
      code: errors[0].startsWith('Attio') ? 'ATTIO_ERROR' : 'AIRTABLE_ERROR',
    };
  }

  /**
   * Update Attio CRM with analysis results.
   */
  private async updateAttio(
    request: UpdateCRMRequest,
    currentUpdates: CRMUpdates['attio']
  ): Promise<CRMUpdates['attio']> {
    const { analysis, attendeeEmail, attioRecordId } = request;
    const updates = { ...currentUpdates };

    // Find or create the person record
    let recordId = attioRecordId;
    if (!recordId) {
      const searchResult = await this.deps.callMcpTool<{ id?: string }>('attio_search_person', {
        email: attendeeEmail,
      });
      recordId = searchResult.id;
    }

    if (!recordId) {
      this.deps.logger.debug('Attio record not found, skipping updates', {
        email: attendeeEmail,
      });
      return updates;
    }

    // Update pipeline stage if configured
    if (this.config.updatePipelineStage) {
      const newStage = RECOMMENDATION_TO_STAGE[analysis.bant.overall.recommendation];
      if (newStage) {
        await this.deps.callMcpTool('attio_update_record', {
          record_id: recordId,
          fields: {
            pipeline_stage: newStage,
            last_meeting_date: new Date().toISOString(),
            qualification_score: analysis.bant.overall.score,
          },
        });
        updates.pipeline_stage = newStage;
      }
    }

    // Log meeting activity
    if (this.config.logActivities) {
      const activityContent = this.formatMeetingNotes(analysis);
      await this.deps.callMcpTool('attio_add_activity', {
        record_id: recordId,
        type: 'meeting',
        content: activityContent,
        metadata: {
          meeting_id: analysis.meeting_id,
          analysis_id: analysis.analysis_id,
          bant_score: analysis.bant.overall.score,
          recommendation: analysis.bant.overall.recommendation,
          objections_count: analysis.objections.length,
        },
      });
      updates.meeting_notes_added = true;
    }

    // Create tasks for action items assigned to us
    if (this.config.createTasks) {
      const ourActionItems = analysis.action_items.filter(
        (item) => item.assignee === 'us' || item.assignee === 'both'
      );

      for (const item of ourActionItems) {
        const taskResult = await this.deps.callMcpTool<{ task_id: string }>('attio_create_task', {
          record_id: recordId,
          title: item.description,
          due_date: item.due_date ?? this.getDefaultDueDate(item.priority),
          priority: item.priority,
        });
        updates.tasks_created.push(taskResult.task_id);
      }
    }

    return updates;
  }

  /**
   * Update Airtable with analysis results.
   */
  private async updateAirtable(
    request: UpdateCRMRequest,
    currentUpdates: CRMUpdates['airtable']
  ): Promise<CRMUpdates['airtable']> {
    const { analysis, attendeeEmail, airtableRecordId } = request;
    const updates = { ...currentUpdates };

    // Find the lead record
    let recordId = airtableRecordId;
    if (!recordId) {
      const searchResult = await this.deps.callMcpTool<{ id?: string }>('airtable_search_lead', {
        email: attendeeEmail,
      });
      recordId = searchResult.id;
    }

    if (!recordId) {
      this.deps.logger.debug('Airtable record not found, skipping updates', {
        email: attendeeEmail,
      });
      return updates;
    }

    // Update lead status and qualification
    const newStatus = RECOMMENDATION_TO_STATUS[analysis.bant.overall.recommendation];
    const updateFields: Record<string, unknown> = {
      last_meeting_date: analysis.analyzed_at,
      meetings_count: { increment: 1 },
    };

    if (newStatus) {
      updateFields.qualification_status = newStatus;
      updates.qualification_updated = true;
    }

    // Only set status to "Meeting Held" if not disqualified
    if (analysis.bant.overall.recommendation !== 'disqualify') {
      updateFields.status = 'Meeting Held';
      updates.status_updated = true;
    } else {
      updateFields.status = 'Disqualified';
      updates.status_updated = true;
    }

    await this.deps.callMcpTool('airtable_update_record', {
      table: 'Leads',
      record_id: recordId,
      fields: updateFields,
    });

    return updates;
  }

  /**
   * Format meeting notes for CRM activity log.
   */
  private formatMeetingNotes(analysis: MeetingAnalysis): string {
    const sections: string[] = [];

    // BANT Summary
    sections.push('## Qualification Summary');
    sections.push(`**Score**: ${analysis.bant.overall.score}/100 (${analysis.bant.overall.recommendation.toUpperCase()})`);
    sections.push(`**Summary**: ${analysis.bant.overall.summary}`);
    sections.push('');

    // BANT Details
    sections.push('### BANT Breakdown');
    sections.push(`- **Budget**: ${analysis.bant.budget.status} (${Math.round(analysis.bant.budget.confidence * 100)}%)`);
    if (analysis.bant.budget.amount) {
      sections.push(`  - Amount: ${analysis.bant.budget.amount}`);
    }
    sections.push(`- **Authority**: ${analysis.bant.authority.status} (${Math.round(analysis.bant.authority.confidence * 100)}%)`);
    if (analysis.bant.authority.stakeholders.length > 0) {
      sections.push(`  - Stakeholders: ${analysis.bant.authority.stakeholders.join(', ')}`);
    }
    sections.push(`- **Need**: ${analysis.bant.need.status} (${Math.round(analysis.bant.need.confidence * 100)}%)`);
    sections.push(`  - Urgency: ${analysis.bant.need.urgency}`);
    sections.push(`- **Timeline**: ${analysis.bant.timeline.status} (${Math.round(analysis.bant.timeline.confidence * 100)}%)`);
    if (analysis.bant.timeline.target_date) {
      sections.push(`  - Target: ${analysis.bant.timeline.target_date}`);
    }
    sections.push('');

    // Objections
    if (analysis.objections.length > 0) {
      sections.push('### Objections');
      for (const objection of analysis.objections) {
        const statusEmoji = objection.status === 'resolved' ? '✅' : objection.status === 'deferred' ? '⏳' : '❌';
        sections.push(`${statusEmoji} **${objection.category}**: ${objection.text}`);
        if (objection.resolution) {
          sections.push(`   → Resolution: ${objection.resolution}`);
        }
      }
      sections.push('');
    }

    // Action Items
    if (analysis.action_items.length > 0) {
      sections.push('### Action Items');
      for (const item of analysis.action_items) {
        const assigneeLabel = item.assignee === 'us' ? '🏢 Us' : item.assignee === 'them' ? '👤 Them' : '🤝 Both';
        sections.push(`- [${item.priority.toUpperCase()}] ${item.description} (${assigneeLabel})`);
      }
      sections.push('');
    }

    // Key Quotes
    if (analysis.key_quotes.length > 0) {
      sections.push('### Key Quotes');
      for (const quote of analysis.key_quotes.slice(0, 3)) {
        sections.push(`> "${quote.quote}"`);
        sections.push(`> — ${quote.speaker === 'prospect' ? 'Prospect' : 'Us'}: ${quote.significance}`);
        sections.push('');
      }
    }

    // Competitive Intel
    if (analysis.competitive_mentions.length > 0) {
      sections.push('### Competitive Intel');
      for (const mention of analysis.competitive_mentions) {
        const sentimentEmoji = mention.sentiment === 'positive' ? '👍' : mention.sentiment === 'negative' ? '👎' : '➖';
        sections.push(`- ${sentimentEmoji} **${mention.competitor}**: ${mention.context}`);
      }
    }

    return sections.join('\n');
  }

  /**
   * Get default due date based on priority.
   */
  private getDefaultDueDate(priority: ActionItem['priority']): string {
    const now = new Date();
    const daysToAdd = priority === 'high' ? 1 : priority === 'medium' ? 3 : 7;
    now.setDate(now.getDate() + daysToAdd);
    return now.toISOString().split('T')[0];
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a CRM updater instance.
 */
export function createCRMUpdater(
  deps: CRMUpdaterDependencies,
  config?: Partial<CRMUpdaterConfig>
): CRMUpdater {
  return new CRMUpdater(deps, config);
}
