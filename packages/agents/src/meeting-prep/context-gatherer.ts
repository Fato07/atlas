/**
 * Context Gatherer Orchestrator
 *
 * Orchestrates parallel context gathering from multiple sub-agents.
 * Implements FR-003 (parallel execution) and SC-007 (30s timeout).
 * Handles partial failures gracefully and respects research cache TTL.
 *
 * @module meeting-prep/context-gatherer
 */

import type { BrainId } from '@atlas-gtm/lib';
import type { GatheredContext, ResearchCache, MeetingPrepConfig } from './types';
import type { MeetingPrepLogger } from './logger';
import type { ParsedMeeting } from './contracts/meeting-input';

import {
  InstantlyFetcher,
  AirtableFetcher,
  AttioFetcher,
  KBResearcher,
  type InstantlyFetchResult,
  type AirtableFetchResult,
  type AttioFetchResult,
  type KBResearchResult,
  type ConversationEntry,
} from './sub-agents';

// ===========================================
// Types
// ===========================================

export interface ContextGathererConfig {
  /** Timeout for each sub-agent in milliseconds (SC-007: 30 seconds) */
  subAgentTimeoutMs: number;

  /** Research cache TTL in hours */
  researchCacheTtlHours: number;

  /** Maximum conversation entries to include */
  maxConversationEntries: number;
}

export const DEFAULT_CONTEXT_GATHERER_CONFIG: ContextGathererConfig = {
  subAgentTimeoutMs: 30000, // SC-007
  researchCacheTtlHours: 24, // FR-003
  maxConversationEntries: 5,
};

export interface ContextGathererDependencies {
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;
  embedder: (text: string) => Promise<number[]>;
  logger: MeetingPrepLogger;
  getResearchCache: (key: string) => Promise<ResearchCache | null>;
  setResearchCache: (cache: ResearchCache) => Promise<void>;
}

export interface GatherContextRequest {
  brainId: BrainId;
  briefId: string;
  meeting: ParsedMeeting;
}

export interface GatherContextResult {
  success: true;
  context: GatheredContext;
  sources_used: string[];
  cache_hit: boolean;
}

export interface GatherContextError {
  success: false;
  error: string;
  partial_context: Partial<GatheredContext> | null;
  failed_sources: string[];
}

export type GatherContextOutput = GatherContextResult | GatherContextError;

// ===========================================
// Sub-Agent Result Types
// ===========================================

/** Reason why a source failed (T039) */
type SourceFailureReason = 'timeout' | 'error' | 'not_found' | 'unavailable';

/** Information about a missing/failed source (T039) */
interface MissingSourceInfo {
  source: 'instantly' | 'airtable' | 'attio' | 'kb';
  reason: SourceFailureReason;
  message?: string;
}

/** Result from a sub-agent with failure tracking (T039) */
interface SubAgentResultWithError<T> {
  result: T | null;
  failureInfo: MissingSourceInfo | null;
}

interface SubAgentResults {
  instantly: InstantlyFetchResult | null;
  airtable: AirtableFetchResult | null;
  attio: AttioFetchResult | null;
  kb: KBResearchResult | null;
}

/** Enhanced results with failure tracking (T039) */
interface SubAgentResultsWithFailures {
  results: SubAgentResults;
  failures: MissingSourceInfo[];
}

// ===========================================
// Context Gatherer Class
// ===========================================

export class ContextGatherer {
  private readonly config: ContextGathererConfig;
  private readonly deps: ContextGathererDependencies;
  private readonly instantlyFetcher: InstantlyFetcher;
  private readonly airtableFetcher: AirtableFetcher;
  private readonly attioFetcher: AttioFetcher;
  private readonly kbResearcher: KBResearcher;

  constructor(
    deps: ContextGathererDependencies,
    config?: Partial<ContextGathererConfig>
  ) {
    this.config = { ...DEFAULT_CONTEXT_GATHERER_CONFIG, ...config };
    this.deps = deps;

    // Initialize sub-agents
    this.instantlyFetcher = new InstantlyFetcher(deps.callMcpTool);
    this.airtableFetcher = new AirtableFetcher(deps.callMcpTool);
    this.attioFetcher = new AttioFetcher(deps.callMcpTool);
    this.kbResearcher = new KBResearcher(deps.callMcpTool, deps.embedder);
  }

  /**
   * Gather context from all sources in parallel.
   * Implements FR-003 (parallel execution) and SC-007 (30s timeout).
   */
  async gather(request: GatherContextRequest): Promise<GatherContextOutput> {
    const startTime = performance.now();
    const { brainId, briefId, meeting } = request;
    const attendeeEmail = meeting.primary_attendee.email;

    this.deps.logger.debug('Starting context gathering', {
      meeting_id: meeting.meeting_id,
      attendee_email: attendeeEmail,
    });

    // Check if we have cached research for this company
    const cacheKey = this.buildCacheKey(attendeeEmail);
    const cachedResearch = await this.deps.getResearchCache(cacheKey);
    const cacheHit = cachedResearch !== null && !this.isCacheExpired(cachedResearch);

    // Run all sub-agents in parallel with timeout (FR-003)
    const { results, failures } = await this.executeSubAgentsInParallel(
      brainId,
      attendeeEmail,
      cachedResearch
    );

    // Collect which sources were used and which failed
    const sourcesUsed: string[] = [];
    const failedSources: string[] = [];

    // Process Instantly results with detailed logging (T039)
    if (results.instantly?.success) {
      sourcesUsed.push('instantly');
      this.deps.logger.debug('Sub-agent succeeded', {
        source: 'instantly',
        entries_count: results.instantly.entries.length,
      });
    } else {
      failedSources.push('instantly');
    }

    // Process Airtable results with detailed logging (T039)
    if (results.airtable?.success) {
      sourcesUsed.push('airtable');
      this.deps.logger.debug('Sub-agent succeeded', {
        source: 'airtable',
        lead_found: !!results.airtable.lead,
      });
    } else {
      failedSources.push('airtable');
    }

    // Process Attio results with detailed logging (T039)
    if (results.attio?.success) {
      sourcesUsed.push('attio');
      this.deps.logger.debug('Sub-agent succeeded', {
        source: 'attio',
        person_found: !!results.attio.data.person,
        activities_count: results.attio.data.recent_activities.length,
      });
    } else {
      failedSources.push('attio');
    }

    // Process KB results with detailed logging (T039)
    if (results.kb?.success) {
      sourcesUsed.push('kb');
      this.deps.logger.debug('Sub-agent succeeded', {
        source: 'kb',
        handlers_count: results.kb.data.objection_handlers.length,
        deals_count: results.kb.data.similar_deals.length,
      });
    } else {
      failedSources.push('kb');
    }

    // If research cache was used, note it
    if (cacheHit) {
      sourcesUsed.push('cache');
    }

    // Log summary of all failures (T039)
    if (failures.length > 0) {
      this.deps.logger.warn('Some context sources failed', {
        failed_count: failures.length,
        failures: failures.map((f) => ({
          source: f.source,
          reason: f.reason,
          message: f.message,
        })),
      });
    }

    // Build gathered context from results with missing sources (T039)
    const context = this.buildGatheredContext(
      meeting,
      results,
      cachedResearch,
      startTime,
      failures
    );

    const durationMs = Math.round(performance.now() - startTime);

    // Log context_gathered event (FR-015)
    this.deps.logger.contextGathered({
      meeting_id: meeting.meeting_id,
      brain_id: brainId,
      brief_id: briefId,
      sources_used: sourcesUsed,
      duration_ms: durationMs,
      cache_hit: cacheHit,
    });

    // If all sources failed, return error with partial context
    if (sourcesUsed.length === 0 && failedSources.length > 0) {
      return {
        success: false,
        error: `All context sources failed: ${failedSources.join(', ')}`,
        partial_context: context,
        failed_sources: failedSources,
      };
    }

    // Cache company research if we fetched new data from Attio
    if (results.attio?.success && !cacheHit) {
      await this.cacheCompanyResearch(attendeeEmail, results.attio);
    }

    return {
      success: true,
      context,
      sources_used: sourcesUsed,
      cache_hit: cacheHit,
    };
  }

  /**
   * Execute all sub-agents in parallel with timeout.
   * Uses Promise.allSettled for resilience (FR-003).
   * Returns both results and failure information (T039).
   */
  private async executeSubAgentsInParallel(
    brainId: BrainId,
    attendeeEmail: string,
    cachedResearch: ResearchCache | null
  ): Promise<SubAgentResultsWithFailures> {
    // Get company and industry from cached research if available
    const company = cachedResearch?.company_name ?? null;
    const industry = cachedResearch?.research_data.industry ?? null;

    // Create promises with timeout for each sub-agent
    const [instantlyResult, airtableResult, attioResult, kbResult] =
      await Promise.allSettled([
        this.withTimeout(
          this.instantlyFetcher.fetch(attendeeEmail),
          'instantly'
        ),
        this.withTimeout(
          this.airtableFetcher.fetch(attendeeEmail),
          'airtable'
        ),
        this.withTimeout(
          this.attioFetcher.fetch(attendeeEmail),
          'attio'
        ),
        this.withTimeout(
          this.kbResearcher.research(brainId, attendeeEmail, company, industry),
          'kb'
        ),
      ]);

    // Extract results and track failures (T039)
    const failures: MissingSourceInfo[] = [];

    const instantly = this.extractResultWithFailure(instantlyResult, 'instantly', failures);
    const airtable = this.extractResultWithFailure(airtableResult, 'airtable', failures);
    const attio = this.extractResultWithFailure(attioResult, 'attio', failures);
    const kb = this.extractResultWithFailure(kbResult, 'kb', failures);

    return {
      results: { instantly, airtable, attio, kb },
      failures,
    };
  }

  /**
   * Wrap a promise with a timeout.
   * Returns error result if timeout is exceeded (SC-007).
   */
  private async withTimeout<T extends { success: boolean }>(
    promise: Promise<T>,
    sourceName: string
  ): Promise<T> {
    const timeoutPromise = new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${sourceName} timeout after ${this.config.subAgentTimeoutMs}ms`));
      }, this.config.subAgentTimeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Extract result from PromiseSettledResult and track failure info (T039).
   */
  private extractResultWithFailure<T extends { success: boolean }>(
    result: PromiseSettledResult<T>,
    source: MissingSourceInfo['source'],
    failures: MissingSourceInfo[]
  ): T | null {
    if (result.status === 'fulfilled') {
      const value = result.value;
      // If the sub-agent returned success: false, track as not_found
      if (!value.success) {
        failures.push({
          source,
          reason: 'not_found',
          message: 'Sub-agent returned no data',
        });
        this.deps.logger.debug('Sub-agent returned no data', { source });
      }
      return value;
    }

    // Promise was rejected - determine reason
    const errorMessage = result.reason?.message ?? String(result.reason);
    const isTimeout = errorMessage.includes('timeout');

    const failureInfo: MissingSourceInfo = {
      source,
      reason: isTimeout ? 'timeout' : 'error',
      message: errorMessage,
    };

    failures.push(failureInfo);
    this.deps.logger.warn('Sub-agent failed', {
      source,
      reason: failureInfo.reason,
      message: errorMessage,
    });

    return null;
  }

  /**
   * Build the GatheredContext from sub-agent results.
   * Includes missing sources information for brief generation (T039).
   */
  private buildGatheredContext(
    meeting: ParsedMeeting,
    results: SubAgentResults,
    cachedResearch: ResearchCache | null,
    startTime: number,
    failures: MissingSourceInfo[] = []
  ): GatheredContext {
    // Build lead info from Airtable and Attio results
    const lead = this.buildLeadInfo(meeting, results);

    // Build conversation history from Instantly results
    const conversationHistory = this.buildConversationHistory(
      results.instantly,
      results.attio
    );

    // Build company intel from Attio and cached research
    const companyIntel = this.buildCompanyIntel(results.attio, cachedResearch);

    // Build KB context from KB researcher results
    const kbContext = this.buildKBContext(results.kb);

    return {
      lead,
      conversation_history: conversationHistory,
      company_intel: companyIntel,
      kb_context: kbContext,
      gathered_at: new Date().toISOString(),
      gathering_duration_ms: Math.round(performance.now() - startTime),
      // T039: Track which sources were missing/failed
      missing_sources: failures.map((f) => ({
        source: f.source,
        reason: f.reason,
        message: f.message,
      })),
    };
  }

  /**
   * Build lead info from Airtable and Attio results.
   */
  private buildLeadInfo(
    meeting: ParsedMeeting,
    results: SubAgentResults
  ): GatheredContext['lead'] {
    const attendee = meeting.primary_attendee;
    const airtableLead = results.airtable?.success ? results.airtable.lead : null;
    const attioPerson = results.attio?.success ? results.attio.data.person : null;

    // Get industry from Attio if available
    const attioIndustry = results.attio?.success ? results.attio.data.company_industry : null;

    return {
      email: attendee.email,
      name: airtableLead?.name ?? attioPerson?.name ?? attendee.name ?? null,
      company: airtableLead?.company ?? attioPerson?.company_name ?? null,
      title: airtableLead?.title ?? attioPerson?.title ?? null,
      industry: airtableLead?.industry ?? attioIndustry ?? null,
      icp_score: airtableLead?.icp_score ?? null,
      vertical: airtableLead?.vertical ?? null,
    };
  }

  /**
   * Build conversation history from Instantly and Attio results.
   */
  private buildConversationHistory(
    instantlyResult: InstantlyFetchResult | null,
    attioResult: AttioFetchResult | null
  ): GatheredContext['conversation_history'] {
    const history: GatheredContext['conversation_history'] = [];

    // Add Instantly email threads
    if (instantlyResult?.success) {
      for (const entry of instantlyResult.entries) {
        history.push({
          date: entry.date,
          channel: entry.channel,
          summary: entry.summary,
          sentiment: entry.sentiment,
        });
      }
    }

    // Add Attio activities
    if (attioResult?.success) {
      for (const activity of attioResult.data.recent_activities) {
        history.push({
          date: activity.date,
          channel: this.mapAttioActivityToChannel(activity.type),
          summary: activity.summary,
          sentiment: 'unknown',
        });
      }
    }

    // Sort by date (newest first) and limit
    return history
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, this.config.maxConversationEntries);
  }

  /**
   * Map Attio activity type to GatheredContext channel type.
   */
  private mapAttioActivityToChannel(
    activityType: 'note' | 'email' | 'call' | 'meeting' | 'task'
  ): GatheredContext['conversation_history'][0]['channel'] {
    // Map Attio types to valid channel types
    // 'note' and 'task' are not valid channels, so we map them to 'email' as default
    const channelMap: Record<string, GatheredContext['conversation_history'][0]['channel']> = {
      email: 'email',
      call: 'call',
      meeting: 'meeting',
      note: 'email', // Notes are often email follow-ups
      task: 'email', // Tasks are often related to email threads
    };

    return channelMap[activityType] ?? 'email';
  }

  /**
   * Build company intel from Attio and cached research.
   */
  private buildCompanyIntel(
    attioResult: AttioFetchResult | null,
    cachedResearch: ResearchCache | null
  ): GatheredContext['company_intel'] {
    // Use cached research if available
    if (cachedResearch && !this.isCacheExpired(cachedResearch)) {
      return {
        industry: cachedResearch.research_data.industry,
        size: cachedResearch.research_data.size_estimate,
        funding_stage: cachedResearch.research_data.funding_info,
        recent_news: cachedResearch.research_data.recent_news,
        tech_stack: cachedResearch.research_data.tech_stack,
        key_people: cachedResearch.research_data.key_people.map((p) => ({
          name: p.name,
          title: p.title,
          relevance: 'key_contact',
        })),
      };
    }

    // Build from Attio if no cache
    if (attioResult?.success) {
      const data = attioResult.data;
      return {
        industry: data.company_industry ?? 'Unknown',
        size: data.company_size ?? 'Unknown',
        funding_stage: null,
        recent_news: [],
        tech_stack: [],
        key_people: [],
      };
    }

    return null;
  }

  /**
   * Build KB context from KB researcher results.
   */
  private buildKBContext(kbResult: KBResearchResult | null): GatheredContext['kb_context'] {
    if (!kbResult?.success) {
      return {
        objection_handlers: [],
        similar_deals: [],
        icp_rules: [],
      };
    }

    const data = kbResult.data;

    return {
      objection_handlers: data.objection_handlers.map((h) => ({
        id: h.id,
        objection: h.objection,
        response: h.response,
        confidence: h.confidence,
      })),
      similar_deals: data.similar_deals.map((d) => ({
        company: d.company,
        industry: d.industry,
        why_won: d.why_won,
        relevance_score: d.relevance_score,
      })),
      icp_rules: data.icp_rules.map((r) => ({
        dimension: r.dimension,
        rule: r.rule,
      })),
    };
  }

  /**
   * Build cache key for company research.
   */
  private buildCacheKey(email: string): string {
    const domain = email.split('@')[1];
    return `company:${domain}`;
  }

  /**
   * Check if cached research is expired.
   */
  private isCacheExpired(cache: ResearchCache): boolean {
    const expiresAt = new Date(cache.expires_at);
    return expiresAt <= new Date();
  }

  /**
   * Cache company research from Attio results.
   */
  private async cacheCompanyResearch(
    email: string,
    attioResult: AttioFetchResult
  ): Promise<void> {
    if (!attioResult.success) return;

    const data = attioResult.data;
    const companyName = data.person.company_name ?? 'Unknown';
    const cacheKey = this.buildCacheKey(email);
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setHours(expiresAt.getHours() + this.config.researchCacheTtlHours);

    const cache: ResearchCache = {
      cache_key: cacheKey,
      company_name: companyName,
      research_data: {
        company_overview: '',
        industry: data.company_industry ?? 'Unknown',
        size_estimate: data.company_size ?? 'Unknown',
        funding_info: null,
        recent_news: [],
        tech_stack: [],
        key_people: [],
        social_presence: {
          linkedin_url: null,
          twitter_url: null,
        },
      },
      fetched_at: now.toISOString(),
      ttl_hours: this.config.researchCacheTtlHours,
      expires_at: expiresAt.toISOString(),
      sources_used: ['attio'],
    };

    try {
      await this.deps.setResearchCache(cache);
    } catch (error) {
      this.deps.logger.warn('Failed to cache company research', {
        cache_key: cacheKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a context gatherer instance.
 */
export function createContextGatherer(
  deps: ContextGathererDependencies,
  config?: Partial<ContextGathererConfig>
): ContextGatherer {
  return new ContextGatherer(deps, config);
}
