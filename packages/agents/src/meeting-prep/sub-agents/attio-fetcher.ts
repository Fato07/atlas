/**
 * Attio CRM Fetcher Sub-Agent
 *
 * Queries Attio CRM for person and company history by email.
 * Returns distilled activity summary including deal stage and value.
 *
 * @module meeting-prep/sub-agents/attio-fetcher
 */

// ===========================================
// Types
// ===========================================

export interface AttioPersonSummary {
  person_id: string | null;
  email: string;
  name: string | null;
  title: string | null;
  company_name: string | null;
  company_id: string | null;
}

export interface AttioDealSummary {
  deal_id: string;
  name: string;
  stage: string;
  value: number | null;
  currency: string | null;
  expected_close_date: string | null;
  owner: string | null;
}

export interface AttioActivity {
  type: 'note' | 'email' | 'call' | 'meeting' | 'task';
  date: string;
  summary: string;
}

export interface AttioCRMData {
  person: AttioPersonSummary;
  deals: AttioDealSummary[];
  recent_activities: AttioActivity[];
  company_industry: string | null;
  company_size: string | null;
  last_interaction_date: string | null;
}

export interface AttioFetcherConfig {
  /** Maximum number of activities to return */
  maxActivities: number;

  /** Maximum number of deals to return */
  maxDeals: number;
}

export const DEFAULT_ATTIO_CONFIG: AttioFetcherConfig = {
  maxActivities: 5,
  maxDeals: 3,
};

export interface AttioFetcherResult {
  success: true;
  data: AttioCRMData;
  has_crm_record: boolean;
}

export interface AttioFetcherError {
  success: false;
  error: string;
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_EMAIL' | 'NOT_FOUND' | 'RATE_LIMITED';
}

export type AttioFetchResult = AttioFetcherResult | AttioFetcherError;

// ===========================================
// Attio API Response Types (from Attio MCP)
// ===========================================

interface AttioPersonRecord {
  id: { person_id: string };
  values: {
    email_addresses?: Array<{ email_address: string }>;
    name?: Array<{ full_name: string }>;
    job_title?: Array<{ title: string }>;
    company?: Array<{ target_record_id: string }>;
  };
}

interface AttioCompanyRecord {
  id: { workspace_id: string; object_id: string; record_id: string };
  values: {
    name?: Array<{ value: string }>;
    industry?: Array<{ option: { title: string } }>;
    team_size?: Array<{ option: { title: string } }>;
  };
}

interface AttioDealRecord {
  id: { deal_id: string };
  values: {
    name?: Array<{ value: string }>;
    stage?: Array<{ status: { title: string } }>;
    value?: Array<{ value: number; currency_code: string }>;
    expected_close?: Array<{ value: string }>;
    owner?: Array<{ referenced_actor_id: string }>;
  };
}

interface AttioActivityRecord {
  type: string;
  created_at: string;
  content?: string;
  title?: string;
}

// ===========================================
// Attio Fetcher Class
// ===========================================

export class AttioFetcher {
  private readonly config: AttioFetcherConfig;
  private readonly callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;

  constructor(
    callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>,
    config?: Partial<AttioFetcherConfig>
  ) {
    this.config = { ...DEFAULT_ATTIO_CONFIG, ...config };
    this.callMcpTool = callMcpTool;
  }

  /**
   * Fetch CRM data for an attendee by email.
   */
  async fetch(email: string): Promise<AttioFetchResult> {
    // Validate email format
    if (!this.isValidEmail(email)) {
      return {
        success: false,
        error: `Invalid email format: ${email}`,
        code: 'INVALID_EMAIL',
      };
    }

    try {
      // Step 1: Find person by email
      const personResult = await this.findPerson(email);

      if (!personResult.success) {
        // Return empty data structure for new contacts
        return {
          success: true,
          data: this.createEmptyData(email),
          has_crm_record: false,
        };
      }

      const person = personResult.person;

      // Step 2: Fetch related data in parallel
      const [companyData, deals, activities] = await Promise.all([
        person.company_id ? this.fetchCompany(person.company_id) : null,
        this.fetchDeals(person.person_id!),
        this.fetchActivities(person.person_id!),
      ]);

      // Step 3: Compile CRM data
      const data: AttioCRMData = {
        person,
        deals: deals.slice(0, this.config.maxDeals),
        recent_activities: activities.slice(0, this.config.maxActivities),
        company_industry: companyData?.industry ?? null,
        company_size: companyData?.size ?? null,
        last_interaction_date: activities[0]?.date ?? null,
      };

      return {
        success: true,
        data,
        has_crm_record: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
        return {
          success: false,
          error: 'Attio API timeout',
          code: 'TIMEOUT',
        };
      }

      if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        return {
          success: false,
          error: 'Attio rate limit exceeded',
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
   * Find a person by email.
   */
  private async findPerson(
    email: string
  ): Promise<{ success: true; person: AttioPersonSummary } | { success: false }> {
    try {
      const persons = await this.callMcpTool<AttioPersonRecord[]>(
        'attio_search_people',
        {
          email,
          limit: 1,
        }
      );

      if (!persons || persons.length === 0) {
        return { success: false };
      }

      const person = persons[0];
      const companyId = person.values.company?.[0]?.target_record_id ?? null;

      return {
        success: true,
        person: {
          person_id: person.id.person_id,
          email,
          name: person.values.name?.[0]?.full_name ?? null,
          title: person.values.job_title?.[0]?.title ?? null,
          company_name: null, // Will be enriched from company lookup
          company_id: companyId,
        },
      };
    } catch {
      return { success: false };
    }
  }

  /**
   * Fetch company details.
   */
  private async fetchCompany(
    companyId: string
  ): Promise<{ name: string | null; industry: string | null; size: string | null } | null> {
    try {
      const company = await this.callMcpTool<AttioCompanyRecord>(
        'attio_get_company',
        { record_id: companyId }
      );

      return {
        name: company.values.name?.[0]?.value ?? null,
        industry: company.values.industry?.[0]?.option?.title ?? null,
        size: company.values.team_size?.[0]?.option?.title ?? null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch deals associated with a person.
   */
  private async fetchDeals(personId: string): Promise<AttioDealSummary[]> {
    try {
      const deals = await this.callMcpTool<AttioDealRecord[]>(
        'attio_list_deals',
        {
          person_id: personId,
          limit: this.config.maxDeals,
        }
      );

      return (deals ?? []).map((deal) => ({
        deal_id: deal.id.deal_id,
        name: deal.values.name?.[0]?.value ?? 'Unnamed Deal',
        stage: deal.values.stage?.[0]?.status?.title ?? 'Unknown',
        value: deal.values.value?.[0]?.value ?? null,
        currency: deal.values.value?.[0]?.currency_code ?? null,
        expected_close_date: deal.values.expected_close?.[0]?.value ?? null,
        owner: null, // Would need additional lookup
      }));
    } catch {
      return [];
    }
  }

  /**
   * Fetch recent activities for a person.
   */
  private async fetchActivities(personId: string): Promise<AttioActivity[]> {
    try {
      const activities = await this.callMcpTool<AttioActivityRecord[]>(
        'attio_list_activities',
        {
          person_id: personId,
          limit: this.config.maxActivities,
        }
      );

      return (activities ?? []).map((activity) => ({
        type: this.mapActivityType(activity.type),
        date: activity.created_at,
        summary: activity.title ?? activity.content ?? 'Activity recorded',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Map Attio activity type to our standard types.
   */
  private mapActivityType(type: string): AttioActivity['type'] {
    const typeMap: Record<string, AttioActivity['type']> = {
      note: 'note',
      email: 'email',
      call: 'call',
      meeting: 'meeting',
      task: 'task',
    };

    return typeMap[type.toLowerCase()] ?? 'note';
  }

  /**
   * Create empty data structure for new contacts.
   */
  private createEmptyData(email: string): AttioCRMData {
    return {
      person: {
        person_id: null,
        email,
        name: null,
        title: null,
        company_name: null,
        company_id: null,
      },
      deals: [],
      recent_activities: [],
      company_industry: null,
      company_size: null,
      last_interaction_date: null,
    };
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
 * Create an Attio fetcher instance.
 */
export function createAttioFetcher(
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>,
  config?: Partial<AttioFetcherConfig>
): AttioFetcher {
  return new AttioFetcher(callMcpTool, config);
}
