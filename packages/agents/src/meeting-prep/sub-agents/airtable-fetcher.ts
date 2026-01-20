/**
 * Airtable Lead Fetcher Sub-Agent
 *
 * Queries Airtable for lead information by email.
 * Returns distilled lead profile including ICP score, status, and vertical.
 * Handles "New Lead" case when no record exists.
 *
 * @module meeting-prep/sub-agents/airtable-fetcher
 */

// ===========================================
// Types
// ===========================================

export interface LeadProfile {
  email: string;
  name: string | null;
  company: string | null;
  title: string | null;
  industry: string | null;
  icp_score: number | null;
  vertical: string | null;
  status: LeadStatus;
  source: string | null;
  airtable_record_id: string | null;
}

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal'
  | 'negotiation'
  | 'closed_won'
  | 'closed_lost'
  | 'nurture';

export interface AirtableFetcherResult {
  success: true;
  lead: LeadProfile;
  is_new_lead: boolean;
}

export interface AirtableFetcherError {
  success: false;
  error: string;
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_EMAIL' | 'RATE_LIMITED';
}

export type AirtableFetchResult = AirtableFetcherResult | AirtableFetcherError;

// ===========================================
// Airtable Record Type (from Airtable MCP)
// ===========================================

interface AirtableLeadRecord {
  id: string;
  fields: {
    Email: string;
    Name?: string;
    Company?: string;
    Title?: string;
    Industry?: string;
    'ICP Score'?: number;
    Vertical?: string;
    Status?: string;
    Source?: string;
    'Created Time'?: string;
    'Last Modified'?: string;
  };
}

// ===========================================
// Airtable Fetcher Class
// ===========================================

export class AirtableFetcher {
  private readonly callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;

  constructor(
    callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>
  ) {
    this.callMcpTool = callMcpTool;
  }

  /**
   * Fetch lead profile by email.
   */
  async fetch(email: string): Promise<AirtableFetchResult> {
    // Validate email format
    if (!this.isValidEmail(email)) {
      return {
        success: false,
        error: `Invalid email format: ${email}`,
        code: 'INVALID_EMAIL',
      };
    }

    try {
      // Query Airtable for the lead
      const records = await this.callMcpTool<AirtableLeadRecord[]>(
        'airtable_query_leads',
        {
          filter_by_formula: `{Email} = "${email}"`,
          max_records: 1,
        }
      );

      // Handle no record found - return new lead profile
      if (!records || records.length === 0) {
        return {
          success: true,
          lead: this.createNewLeadProfile(email),
          is_new_lead: true,
        };
      }

      // Parse the record into LeadProfile
      const record = records[0];
      const lead = this.recordToProfile(record);

      return {
        success: true,
        lead,
        is_new_lead: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for specific error types
      if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
        return {
          success: false,
          error: 'Airtable API timeout',
          code: 'TIMEOUT',
        };
      }

      if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        return {
          success: false,
          error: 'Airtable rate limit exceeded',
          code: 'RATE_LIMITED',
        };
      }

      return {
        success: false,
        error: errorMessage,
        code: 'API_ERROR',
      };
    }
  }

  /**
   * Convert an Airtable record to LeadProfile.
   */
  private recordToProfile(record: AirtableLeadRecord): LeadProfile {
    const fields = record.fields;

    return {
      email: fields.Email,
      name: fields.Name ?? null,
      company: fields.Company ?? null,
      title: fields.Title ?? null,
      industry: fields.Industry ?? null,
      icp_score: fields['ICP Score'] ?? null,
      vertical: fields.Vertical ?? null,
      status: this.parseStatus(fields.Status),
      source: fields.Source ?? null,
      airtable_record_id: record.id,
    };
  }

  /**
   * Create a new lead profile for unknown leads.
   */
  private createNewLeadProfile(email: string): LeadProfile {
    // Try to extract company from email domain
    const domain = email.split('@')[1];
    const company = domain ? this.extractCompanyFromDomain(domain) : null;

    return {
      email,
      name: null,
      company,
      title: null,
      industry: null,
      icp_score: null,
      vertical: null,
      status: 'new',
      source: 'meeting_prep_agent',
      airtable_record_id: null,
    };
  }

  /**
   * Parse status string to LeadStatus.
   */
  private parseStatus(status?: string): LeadStatus {
    if (!status) return 'new';

    const normalized = status.toLowerCase().replace(/[^a-z]/g, '_');

    const statusMap: Record<string, LeadStatus> = {
      new: 'new',
      contacted: 'contacted',
      qualified: 'qualified',
      proposal: 'proposal',
      negotiation: 'negotiation',
      closed_won: 'closed_won',
      won: 'closed_won',
      closed_lost: 'closed_lost',
      lost: 'closed_lost',
      nurture: 'nurture',
    };

    return statusMap[normalized] ?? 'new';
  }

  /**
   * Extract a display-friendly company name from domain.
   */
  private extractCompanyFromDomain(domain: string): string | null {
    // Skip common free email providers
    const freeProviders = [
      'gmail.com',
      'yahoo.com',
      'hotmail.com',
      'outlook.com',
      'icloud.com',
      'aol.com',
      'protonmail.com',
      'mail.com',
    ];

    if (freeProviders.includes(domain.toLowerCase())) {
      return null;
    }

    // Extract company name from domain (e.g., "acme.com" -> "Acme")
    const parts = domain.split('.');
    if (parts.length >= 2) {
      const companyPart = parts[parts.length - 2];
      return companyPart.charAt(0).toUpperCase() + companyPart.slice(1);
    }

    return null;
  }

  /**
   * Validate email format.
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create an Airtable fetcher instance.
 */
export function createAirtableFetcher(
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>
): AirtableFetcher {
  return new AirtableFetcher(callMcpTool);
}
