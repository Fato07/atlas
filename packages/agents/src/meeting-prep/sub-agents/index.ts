/**
 * Meeting Prep Sub-Agents
 *
 * Sub-agents for parallel context gathering.
 * Each sub-agent has a 25k token budget and returns distilled results.
 *
 * @module meeting-prep/sub-agents
 */

// Instantly Email Fetcher
export {
  InstantlyFetcher,
  createInstantlyFetcher,
  DEFAULT_INSTANTLY_CONFIG,
  type InstantlyFetcherConfig,
  type InstantlyFetcherResult,
  type InstantlyFetcherError,
  type InstantlyFetchResult,
  type ConversationEntry,
} from './instantly-fetcher';

// Airtable Lead Fetcher
export {
  AirtableFetcher,
  createAirtableFetcher,
  type AirtableFetcherResult,
  type AirtableFetcherError,
  type AirtableFetchResult,
  type LeadProfile,
  type LeadStatus,
} from './airtable-fetcher';

// Attio CRM Fetcher
export {
  AttioFetcher,
  createAttioFetcher,
  DEFAULT_ATTIO_CONFIG,
  type AttioFetcherConfig,
  type AttioFetcherResult,
  type AttioFetcherError,
  type AttioFetchResult,
  type AttioCRMData,
  type AttioPersonSummary,
  type AttioDealSummary,
  type AttioActivity,
} from './attio-fetcher';

// KB Researcher
export {
  KBResearcher,
  createKBResearcher,
  DEFAULT_KB_CONFIG,
  type KBResearcherConfig,
  type KBResearcherResult,
  type KBResearcherError,
  type KBResearchResult,
  type KBResearchData,
  type ObjectionHandler,
  type SimilarDeal,
  type ICPRule,
} from './kb-researcher';
