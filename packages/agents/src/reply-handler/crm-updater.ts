/**
 * Reply Handler Agent - CRM Updater
 *
 * Updates Airtable lead status and creates Attio records for qualified replies.
 * Implements FR-019 (Airtable status), FR-020 (Attio pipeline), FR-021 (activity logging).
 *
 * @module reply-handler/crm-updater
 */

import type { Classification, TierRouting, KBMatch } from './contracts/handler-result';
import type { LeadContext } from './contracts/reply-input';

// ===========================================
// CRM Updater Configuration
// ===========================================

export interface CRMUpdaterConfig {
  /** MCP client function for Attio tools */
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;

  /** Airtable configuration */
  airtable?: {
    /** Enable Airtable updates */
    enabled?: boolean;
    /** Base ID */
    baseId?: string;
    /** Table ID */
    tableId?: string;
  };

  /** Attio configuration */
  attio?: {
    /** Enable Attio updates */
    enabled?: boolean;
    /** Pipeline/List ID for sales pipeline */
    pipelineId?: string;
  };
}

// ===========================================
// Status Mapping
// ===========================================

const INTENT_TO_AIRTABLE_STATUS: Record<string, string> = {
  positive_interest: 'Interested',
  question: 'Question',
  objection: 'Objection',
  referral: 'Referral',
  not_interested: 'Not Interested',
  unsubscribe: 'Unsubscribe',
  out_of_office: 'Out of Office',
  bounce: 'Bounced',
  unclear: 'Needs Review',
};

const INTENT_TO_PIPELINE_STAGE: Record<string, string> = {
  positive_interest: 'Qualified',
  question: 'Interested',
  objection: 'Objection Handling',
  referral: 'Referral',
  not_interested: 'Disqualified',
  unclear: 'Needs Review',
};

// ===========================================
// CRM Update Result
// ===========================================

export interface CRMUpdateResult {
  /** Airtable update status */
  airtable: {
    updated: boolean;
    recordId?: string;
    status?: string;
    error?: string;
  };

  /** Attio update status */
  attio: {
    created: boolean;
    recordId?: string;
    pipelineStage?: string;
    error?: string;
  };
}

// ===========================================
// CRM Updater Class
// ===========================================

export class CRMUpdater {
  private callMcpTool: CRMUpdaterConfig['callMcpTool'];
  private airtableConfig: Required<NonNullable<CRMUpdaterConfig['airtable']>>;
  private attioConfig: Required<NonNullable<CRMUpdaterConfig['attio']>>;

  constructor(config: CRMUpdaterConfig) {
    this.callMcpTool = config.callMcpTool;
    this.airtableConfig = {
      enabled: config.airtable?.enabled ?? true,
      baseId: config.airtable?.baseId ?? '',
      tableId: config.airtable?.tableId ?? '',
    };
    this.attioConfig = {
      enabled: config.attio?.enabled ?? true,
      pipelineId: config.attio?.pipelineId ?? '',
    };
  }

  // ===========================================
  // Main Update Method
  // ===========================================

  /**
   * Update CRM systems after reply processing
   */
  async updateCRM(params: {
    leadContext: LeadContext;
    classification: Classification;
    routing: TierRouting;
    replyText: string;
    responseSent: boolean;
    responseText?: string;
  }): Promise<CRMUpdateResult> {
    const { leadContext, classification, routing, replyText, responseSent, responseText } = params;

    const result: CRMUpdateResult = {
      airtable: { updated: false },
      attio: { created: false },
    };

    // Run updates in parallel
    const [airtableResult, attioResult] = await Promise.allSettled([
      this.updateAirtable({
        leadContext,
        classification,
        routing,
        replyText,
        responseSent,
      }),
      this.updateAttio({
        leadContext,
        classification,
        routing,
        replyText,
        responseSent,
        responseText,
      }),
    ]);

    // Process Airtable result
    if (airtableResult.status === 'fulfilled') {
      result.airtable = airtableResult.value;
    } else {
      result.airtable = {
        updated: false,
        error: airtableResult.reason?.message ?? 'Unknown error',
      };
    }

    // Process Attio result
    if (attioResult.status === 'fulfilled') {
      result.attio = attioResult.value;
    } else {
      result.attio = {
        created: false,
        error: attioResult.reason?.message ?? 'Unknown error',
      };
    }

    return result;
  }

  // ===========================================
  // Airtable Updates (FR-019)
  // ===========================================

  /**
   * Update Airtable lead status
   */
  private async updateAirtable(params: {
    leadContext: LeadContext;
    classification: Classification;
    routing: TierRouting;
    replyText: string;
    responseSent: boolean;
  }): Promise<CRMUpdateResult['airtable']> {
    if (!this.airtableConfig.enabled) {
      return { updated: false, error: 'Airtable updates disabled' };
    }

    const { leadContext, classification, routing, responseSent } = params;

    // Map intent to Airtable status
    const status = INTENT_TO_AIRTABLE_STATUS[classification.intent] ?? 'Needs Review';

    // Airtable is accessed via n8n webhook, not MCP
    // This is a placeholder for the actual Airtable update logic
    // In production, this would call an n8n workflow endpoint

    try {
      // If lead has no Airtable record ID, try to find or create
      let recordId = leadContext.airtable_id;

      if (!recordId) {
        recordId = await this.ensureAirtableLead(leadContext);
      }

      if (!recordId) {
        return { updated: false, error: 'Could not find or create Airtable record' };
      }

      // Update the record via n8n webhook
      await this.callAirtableUpdate({
        recordId,
        fields: {
          Status: status,
          LastReplyIntent: classification.intent,
          LastReplySentiment: classification.sentiment,
          LastReplyTier: routing.tier,
          ResponseSent: responseSent,
          LastReplyAt: new Date().toISOString(),
        },
      });

      return {
        updated: true,
        recordId,
        status,
      };
    } catch (error) {
      return {
        updated: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Ensure Airtable lead exists (create if not found)
   * Implements edge case from F-006 in remediation plan
   */
  private async ensureAirtableLead(leadContext: LeadContext): Promise<string | undefined> {
    // Try to find existing record by email via n8n
    const existing = await this.findAirtableRecordByEmail(leadContext.email);
    if (existing) {
      return existing;
    }

    // Create new record from lead context
    try {
      const newRecord = await this.createAirtableRecord({
        Email: leadContext.email,
        FirstName: leadContext.first_name ?? '',
        LastName: leadContext.last_name ?? '',
        Company: leadContext.company ?? '',
        Title: leadContext.title ?? '',
        Industry: leadContext.industry ?? '',
        Status: 'New Reply',
        Source: 'Reply Handler - Auto Created',
        CreatedAt: new Date().toISOString(),
      });

      return newRecord?.id;
    } catch {
      return undefined;
    }
  }

  /**
   * Find Airtable record by email (via n8n webhook)
   */
  private async findAirtableRecordByEmail(email: string): Promise<string | undefined> {
    // This would call an n8n webhook that searches Airtable
    // Placeholder implementation
    try {
      const response = await fetch(
        `${process.env.N8N_WEBHOOK_URL}/airtable/find-by-email`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        }
      );

      if (!response.ok) {
        return undefined;
      }

      const data = await response.json() as { recordId?: string };
      return data.recordId;
    } catch {
      return undefined;
    }
  }

  /**
   * Create Airtable record (via n8n webhook)
   */
  private async createAirtableRecord(
    fields: Record<string, unknown>
  ): Promise<{ id: string } | undefined> {
    // This would call an n8n webhook that creates Airtable record
    // Placeholder implementation
    try {
      const response = await fetch(
        `${process.env.N8N_WEBHOOK_URL}/airtable/create`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        }
      );

      if (!response.ok) {
        return undefined;
      }

      return await response.json() as { id: string };
    } catch {
      return undefined;
    }
  }

  /**
   * Update Airtable record (via n8n webhook)
   */
  private async callAirtableUpdate(params: {
    recordId: string;
    fields: Record<string, unknown>;
  }): Promise<void> {
    // This would call an n8n webhook that updates Airtable
    // Placeholder implementation
    const response = await fetch(
      `${process.env.N8N_WEBHOOK_URL}/airtable/update`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: params.recordId,
          fields: params.fields,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Airtable update failed: ${response.status}`);
    }
  }

  // ===========================================
  // Attio Updates (FR-020, FR-021)
  // ===========================================

  /**
   * Update Attio CRM (create person, update pipeline, log activity)
   */
  private async updateAttio(params: {
    leadContext: LeadContext;
    classification: Classification;
    routing: TierRouting;
    replyText: string;
    responseSent: boolean;
    responseText?: string;
  }): Promise<CRMUpdateResult['attio']> {
    if (!this.attioConfig.enabled) {
      return { created: false, error: 'Attio updates disabled' };
    }

    const { leadContext, classification, routing, replyText, responseSent, responseText } = params;

    // Only create Attio records for qualified intents
    const qualifiedIntents = ['positive_interest', 'question', 'objection', 'referral'];
    if (!qualifiedIntents.includes(classification.intent)) {
      return { created: false, error: 'Intent does not qualify for Attio' };
    }

    try {
      // Step 1: Find or create person in Attio
      let person = await this.callMcpTool<{
        id?: { record_id: string };
      } | null>('find_person', {
        email: leadContext.email,
      });

      if (!person) {
        // Create new person
        const fullName = [leadContext.first_name, leadContext.last_name]
          .filter(Boolean)
          .join(' ') || 'Unknown';

        person = await this.callMcpTool<{
          id: { record_id: string };
        }>('create_person', {
          email: leadContext.email,
          name: fullName,
          company: leadContext.company,
          title: leadContext.title,
        });
      }

      const recordId = person?.id?.record_id;
      if (!recordId) {
        return { created: false, error: 'Could not create or find Attio person' };
      }

      // Step 2: Update pipeline stage (FR-020)
      const pipelineStage = INTENT_TO_PIPELINE_STAGE[classification.intent] ?? 'Interested';

      if (this.attioConfig.pipelineId) {
        await this.callMcpTool('update_pipeline_stage', {
          record_id: recordId,
          list_id: this.attioConfig.pipelineId,
          stage: pipelineStage,
        });
      }

      // Step 3: Log activity (FR-021)
      const activityContent = this.buildActivityContent({
        classification,
        routing,
        replyText,
        responseSent,
        responseText,
      });

      await this.callMcpTool('add_activity', {
        record_id: recordId,
        activity_type: 'email',
        content: activityContent,
        metadata: {
          source: 'reply_handler',
          intent: classification.intent,
          sentiment: classification.sentiment,
          tier: routing.tier,
          response_sent: responseSent,
        },
      });

      // Step 4: Create follow-up task if needed
      if (this.shouldCreateTask(classification, routing)) {
        await this.createFollowUpTask(recordId, classification, routing);
      }

      return {
        created: true,
        recordId,
        pipelineStage,
      };
    } catch (error) {
      return {
        created: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Build activity content for Attio
   */
  private buildActivityContent(params: {
    classification: Classification;
    routing: TierRouting;
    replyText: string;
    responseSent: boolean;
    responseText?: string;
  }): string {
    const { classification, routing, replyText, responseSent, responseText } = params;

    const parts: string[] = [
      `**Reply Received**`,
      ``,
      `Intent: ${classification.intent.replace('_', ' ')}`,
      `Sentiment: ${classification.sentiment.toFixed(2)}`,
      `Complexity: ${classification.complexity}`,
      `Urgency: ${classification.urgency}`,
      ``,
      `**Tier ${routing.tier} Routing**`,
      `Reason: ${routing.reason}`,
      ``,
      `**Reply Preview:**`,
      replyText.substring(0, 500) + (replyText.length > 500 ? '...' : ''),
    ];

    if (responseSent && responseText) {
      parts.push('');
      parts.push('**Response Sent:**');
      parts.push(responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
    }

    return parts.join('\n');
  }

  /**
   * Determine if a follow-up task should be created
   */
  private shouldCreateTask(
    classification: Classification,
    routing: TierRouting
  ): boolean {
    // Create tasks for:
    // - Tier 3 escalations
    // - Questions that need follow-up
    // - Objections requiring handling
    return (
      routing.tier === 3 ||
      (classification.intent === 'question' && classification.complexity !== 'simple') ||
      classification.intent === 'objection'
    );
  }

  /**
   * Create follow-up task in Attio
   */
  private async createFollowUpTask(
    recordId: string,
    classification: Classification,
    routing: TierRouting
  ): Promise<void> {
    const taskTitle = this.getTaskTitle(classification, routing);
    const dueDate = this.getTaskDueDate(classification);

    await this.callMcpTool('create_task', {
      record_id: recordId,
      title: taskTitle,
      due_date: dueDate,
      description: `Auto-created by Reply Handler\n\nIntent: ${classification.intent}\nTier: ${routing.tier}\nReason: ${routing.reason}`,
    });
  }

  /**
   * Get task title based on classification
   */
  private getTaskTitle(classification: Classification, routing: TierRouting): string {
    if (routing.tier === 3) {
      return `Review escalated reply - ${classification.intent.replace('_', ' ')}`;
    }

    switch (classification.intent) {
      case 'question':
        return 'Follow up on question';
      case 'objection':
        return 'Handle objection - schedule call';
      case 'referral':
        return 'Follow up with referred contact';
      default:
        return `Follow up - ${classification.intent.replace('_', ' ')}`;
    }
  }

  /**
   * Get task due date based on urgency
   */
  private getTaskDueDate(classification: Classification): string {
    const now = new Date();
    const daysToAdd =
      classification.urgency === 'high' ? 1 : classification.urgency === 'medium' ? 3 : 7;

    const dueDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    return dueDate.toISOString().split('T')[0]; // YYYY-MM-DD
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a CRM updater
 */
export function createCRMUpdater(config: CRMUpdaterConfig): CRMUpdater {
  return new CRMUpdater(config);
}

// ===========================================
// Status Utilities
// ===========================================

/**
 * Get Airtable status for an intent
 */
export function getAirtableStatus(intent: string): string {
  return INTENT_TO_AIRTABLE_STATUS[intent] ?? 'Needs Review';
}

/**
 * Get pipeline stage for an intent
 */
export function getPipelineStage(intent: string): string {
  return INTENT_TO_PIPELINE_STAGE[intent] ?? 'Interested';
}
