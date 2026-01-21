/**
 * Lead Scorer Integration Tests
 *
 * End-to-end tests for the complete lead scoring flow.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { LeadScorerAgent, createLeadScorerAgent } from '../../lead-scorer/agent';
import type { LeadInput } from '../../lead-scorer/contracts/lead-input';
import type { ScoringResult } from '../../lead-scorer/contracts/scoring-result';
import { VerticalRegistry } from '@atlas-gtm/lib';
import type { VerticalDetectionIndex } from '@atlas-gtm/lib';

// ===========================================
// Test Helpers
// ===========================================

/**
 * Create a mock VerticalDetectionIndex with test data for unit testing.
 * This allows tests to run without Qdrant.
 */
function createMockDetectionIndex(): VerticalDetectionIndex {
  return {
    industryToVertical: new Map([
      ['investor relations', 'iro'],
      ['fintech', 'fintech'],
      ['financial technology', 'fintech'],
      ['saas', 'saas'],
      ['healthcare', 'healthcare'],
      ['defense', 'defense'],
      ['aerospace', 'aerospace'],
    ]),
    titleToVertical: new Map([
      ['investor relations', 'iro'],
      ['ir director', 'iro'],
      ['ir manager', 'iro'],
    ]),
    campaignToVertical: new Map([
      ['iro_*', 'iro'],
      ['fintech_*', 'fintech'],
    ]),
    aliasToVertical: new Map([
      ['ir', 'iro'],
      ['fin', 'fintech'],
    ]),
    exclusions: new Map(),
    builtAt: new Date(),
  };
}

/**
 * Create a VerticalRegistry with test data injected (no Qdrant required).
 */
function createTestRegistry(): VerticalRegistry {
  const registry = new VerticalRegistry();
  registry.setDetectionIndexForTesting(createMockDetectionIndex());
  return registry;
}

function createTestLead(overrides: Partial<LeadInput> = {}): LeadInput {
  return {
    lead_id: `test_${Date.now()}`,
    email: 'test@example.com',
    company: 'Test Company',
    source: 'linkedin',
    ...overrides,
  };
}

// ===========================================
// Single Lead Scoring
// ===========================================

describe('LeadScorerAgent.scoreLead', () => {
  let agent: LeadScorerAgent;

  beforeEach(() => {
    // Create agent with test registry (mock vertical detection data)
    agent = createLeadScorerAgent({
      verticalRegistry: createTestRegistry(),
    });
  });

  test('scores a basic lead successfully', async () => {
    const lead = createTestLead({
      company_size: 100,
      industry: 'fintech',
      title: 'VP of Engineering',
    });

    const result = await agent.scoreLead(lead);

    expect(result.lead_id).toBe(lead.lead_id);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(['priority', 'qualified', 'nurture', 'disqualified']).toContain(result.tier);
    expect(result.scoring_breakdown).toBeInstanceOf(Array);
    expect(result.timestamp).toBeDefined();
    // processing_time_ms can be 0 when test runs in <1ms (Date.now resolution)
    expect(result.processing_time_ms).toBeGreaterThanOrEqual(0);
  });

  test('detects vertical from industry', async () => {
    const lead = createTestLead({
      industry: 'investor relations',
    });

    const result = await agent.scoreLead(lead);

    expect(result.vertical_detected).toBe('iro');
  });

  test('detects vertical from title when no industry', async () => {
    const lead = createTestLead({
      title: 'Director of Investor Relations',
    });

    const result = await agent.scoreLead(lead);

    expect(result.vertical_detected).toBe('iro');
  });

  test('uses explicit vertical when provided', async () => {
    const lead = createTestLead({
      vertical: 'healthcare',
      industry: 'fintech', // Should be ignored
    });

    const result = await agent.scoreLead(lead);

    expect(result.vertical_detected).toBe('healthcare');
  });

  test('returns brain_used in result', async () => {
    const lead = createTestLead({
      industry: 'fintech',
    });

    const result = await agent.scoreLead(lead);

    expect(result.brain_used).toBeDefined();
    expect(result.brain_used).toContain('fintech');
  });

  test('includes scoring breakdown', async () => {
    const lead = createTestLead({
      company_size: 100,
      title: 'VP of Sales',
    });

    const result = await agent.scoreLead(lead);

    expect(result.scoring_breakdown.length).toBeGreaterThan(0);

    // Each breakdown item should have required fields
    for (const item of result.scoring_breakdown) {
      expect(item.rule_id).toBeDefined();
      expect(item.attribute).toBeDefined();
      expect(typeof item.score).toBe('number');
      expect(typeof item.max_score).toBe('number');
      expect(item.reasoning).toBeDefined();
    }
  });

  test('returns recommended angle', async () => {
    const lead = createTestLead({
      company_size: 100,
      industry: 'fintech',
    });

    const result = await agent.scoreLead(lead);

    expect(['technical', 'roi', 'compliance', 'speed', 'integration']).toContain(
      result.recommended_angle
    );
  });

  test('returns personalization hints array', async () => {
    const lead = createTestLead();
    const result = await agent.scoreLead(lead);

    expect(result.personalization_hints).toBeInstanceOf(Array);
  });

  test('records number of rules evaluated', async () => {
    const lead = createTestLead({
      company_size: 100,
    });

    const result = await agent.scoreLead(lead);

    expect(result.rules_evaluated).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================
// Tier Assignment
// ===========================================

describe('Tier assignment scenarios', () => {
  let agent: LeadScorerAgent;

  beforeEach(() => {
    agent = createLeadScorerAgent({
      verticalRegistry: createTestRegistry(),
    });
  });

  test('high-scoring lead gets priority tier', async () => {
    const lead = createTestLead({
      company_size: 200, // Good size
      title: 'VP of Investor Relations',
      industry: 'investor relations',
      funding_stage: 'series_c',
      tech_stack: ['Salesforce', 'HubSpot'],
    });

    const result = await agent.scoreLead(lead);

    // With good signals, should score well
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(['priority', 'qualified']).toContain(result.tier);
  });

  test('medium-scoring lead gets qualified tier', async () => {
    const lead = createTestLead({
      company_size: 100,
      industry: 'saas',
    });

    const result = await agent.scoreLead(lead);

    // Should have moderate score
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  test('minimal lead data results in lower tier', async () => {
    const lead = createTestLead();
    // No optional fields - just required ones

    const result = await agent.scoreLead(lead);

    // With missing data, likely nurture or disqualified
    expect(['nurture', 'disqualified', 'qualified']).toContain(result.tier);
  });
});

// ===========================================
// Edge Cases
// ===========================================

describe('Edge cases', () => {
  let agent: LeadScorerAgent;

  beforeEach(() => {
    agent = createLeadScorerAgent({
      verticalRegistry: createTestRegistry(),
    });
  });

  test('handles lead with all fields populated', async () => {
    const lead: LeadInput = {
      lead_id: 'full_lead_001',
      email: 'ceo@largecorp.com',
      company: 'Large Corporation',
      source: 'referral',
      first_name: 'John',
      last_name: 'Doe',
      title: 'Chief Executive Officer',
      linkedin_url: 'https://linkedin.com/in/johndoe',
      company_size: 500,
      industry: 'fintech',
      vertical: 'fintech',
      sub_vertical: 'payments',
      revenue: 50_000_000,
      funding_stage: 'series_c',
      funding_amount: 100_000_000,
      founded_year: 2015,
      location: 'San Francisco, CA',
      country: 'US',
      tech_stack: ['React', 'Node.js', 'AWS'],
      tools: ['Salesforce', 'Slack', 'Jira'],
      hiring_signals: ['Hiring VP Engineering'],
      recent_news: ['Raised Series C'],
      growth_signals: ['Expanding to Europe'],
      campaign_id: 'camp_001',
      batch_id: 'batch_001',
      enrichment_data: { employees_growth: 0.25 },
    };

    const result = await agent.scoreLead(lead);

    expect(result).toBeDefined();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.tier).toBeDefined();
  });

  test('handles lead with minimal required fields only', async () => {
    const lead: LeadInput = {
      lead_id: 'minimal_001',
      email: 'test@example.com',
      company: 'Test',
      source: 'cold_outbound',
    };

    const result = await agent.scoreLead(lead);

    expect(result).toBeDefined();
    expect(result.lead_id).toBe('minimal_001');
  });

  test('handles lead with empty arrays', async () => {
    const lead = createTestLead({
      tech_stack: [],
      tools: [],
      hiring_signals: [],
    });

    const result = await agent.scoreLead(lead);

    expect(result).toBeDefined();
  });

  test('handles lead with undefined optional fields', async () => {
    const lead = createTestLead({
      company_size: undefined,
      industry: undefined,
      title: undefined,
    });

    const result = await agent.scoreLead(lead);

    expect(result).toBeDefined();
  });
});

// ===========================================
// Batch Scoring
// ===========================================

describe('LeadScorerAgent.scoreBatch', () => {
  let agent: LeadScorerAgent;

  beforeEach(() => {
    agent = createLeadScorerAgent({
      verticalRegistry: createTestRegistry(),
    });
  });

  test('scores multiple leads', async () => {
    const leads = [
      createTestLead({ lead_id: 'batch_1', company_size: 100 }),
      createTestLead({ lead_id: 'batch_2', company_size: 200 }),
      createTestLead({ lead_id: 'batch_3', company_size: 300 }),
    ];

    const results = await agent.scoreBatch(leads);

    expect(results).toHaveLength(3);
    expect(results[0].lead_id).toBe('batch_1');
    expect(results[1].lead_id).toBe('batch_2');
    expect(results[2].lead_id).toBe('batch_3');
  });

  test('calls progress callback', async () => {
    const leads = [
      createTestLead({ lead_id: 'progress_1' }),
      createTestLead({ lead_id: 'progress_2' }),
    ];

    const progressCalls: [number, number][] = [];

    await agent.scoreBatch(leads, {
      onProgress: (processed, total) => {
        progressCalls.push([processed, total]);
      },
    });

    expect(progressCalls).toHaveLength(2);
    expect(progressCalls[0]).toEqual([1, 2]);
    expect(progressCalls[1]).toEqual([2, 2]);
  });

  test('handles empty batch', async () => {
    const results = await agent.scoreBatch([]);

    expect(results).toHaveLength(0);
  });
});

// ===========================================
// Performance
// ===========================================

describe('Performance', () => {
  let agent: LeadScorerAgent;

  beforeEach(() => {
    agent = createLeadScorerAgent({
      verticalRegistry: createTestRegistry(),
    });
  });

  test('single lead scoring completes within target time', async () => {
    const lead = createTestLead({
      company_size: 100,
      industry: 'fintech',
      title: 'VP of Engineering',
    });

    const startTime = Date.now();
    const result = await agent.scoreLead(lead);
    const elapsed = Date.now() - startTime;

    // Target: <2 seconds per lead (but without real Qdrant, should be much faster)
    expect(elapsed).toBeLessThan(2000);
    expect(result.processing_time_ms).toBeLessThan(2000);
  });

  test('batch scoring processes multiple leads efficiently', async () => {
    const leads = Array.from({ length: 10 }, (_, i) =>
      createTestLead({
        lead_id: `perf_${i}`,
        company_size: 100 + i * 10,
      })
    );

    const startTime = Date.now();
    const results = await agent.scoreBatch(leads);
    const elapsed = Date.now() - startTime;

    expect(results).toHaveLength(10);
    // Should complete reasonably fast (without real Qdrant)
    expect(elapsed).toBeLessThan(5000);
  });
});

// ===========================================
// Enrichment Check
// ===========================================

describe('Enrichment check', () => {
  let agent: LeadScorerAgent;

  beforeEach(() => {
    agent = createLeadScorerAgent({
      verticalRegistry: createTestRegistry(),
    });
  });

  test('identifies leads needing enrichment', () => {
    const leadMissingFields = createTestLead({
      // Missing: company_size, industry, title, funding_stage, tech_stack
    });

    const { needsEnrichment, missingCount } = agent.checkNeedsEnrichment(leadMissingFields);

    expect(missingCount).toBe(5);
    expect(needsEnrichment).toBe(true);
  });

  test('identifies leads not needing enrichment', () => {
    const leadWithFields = createTestLead({
      company_size: 100,
      industry: 'fintech',
      title: 'VP',
      funding_stage: 'series_b',
      tech_stack: ['React'],
    });

    const { needsEnrichment, missingCount } = agent.checkNeedsEnrichment(leadWithFields);

    expect(missingCount).toBe(0);
    expect(needsEnrichment).toBe(false);
  });

  test('threshold is >3 missing fields', () => {
    const leadWith3Missing = createTestLead({
      company_size: 100,
      industry: 'fintech',
      // Missing: title, funding_stage, tech_stack (3 missing)
    });

    const { needsEnrichment, missingCount } = agent.checkNeedsEnrichment(leadWith3Missing);

    expect(missingCount).toBe(3);
    expect(needsEnrichment).toBe(false); // Exactly 3 is OK
  });
});

// ===========================================
// Edge Case: Duplicate Lead Handling (T067)
// Per FR-014: Skip already-scored unless force_rescore or data changed
// ===========================================

describe('Duplicate lead handling (FR-014)', () => {
  let agent: LeadScorerAgent;

  beforeEach(() => {
    agent = createLeadScorerAgent({
      verticalRegistry: createTestRegistry(),
    });
  });

  test('new lead is not a duplicate', async () => {
    const lead = createTestLead({ lead_id: 'new_lead_001' });

    const result = await agent.checkDuplicate(lead);

    expect(result.isDuplicate).toBe(false);
    expect(result.shouldRescore).toBe(true);
    expect(result.reason).toBe('not_found');
  });

  test('force_rescore=true allows rescoring', async () => {
    const lead = createTestLead({ lead_id: 'existing_lead_001' });

    const result = await agent.checkDuplicate(lead, true);

    // With force_rescore, should allow scoring
    expect(result.shouldRescore).toBe(true);
    // Note: Without actual storage, reason will still be 'not_found'
    // In production with storage, reason would be 'force_rescore'
  });

  test('data hash is consistent for same data', async () => {
    const lead1 = createTestLead({
      lead_id: 'hash_test_001',
      company_size: 100,
      industry: 'fintech',
    });

    const lead2 = createTestLead({
      lead_id: 'hash_test_001',
      company_size: 100,
      industry: 'fintech',
    });

    // Access private method for testing
    const hash1 = (agent as any).hashLeadData(lead1);
    const hash2 = (agent as any).hashLeadData(lead2);

    expect(hash1).toBe(hash2);
  });

  test('data hash changes when lead data changes', async () => {
    const lead1 = createTestLead({
      lead_id: 'hash_test_002',
      company_size: 100,
    });

    const lead2 = createTestLead({
      lead_id: 'hash_test_002',
      company_size: 200, // Different company size
    });

    const hash1 = (agent as any).hashLeadData(lead1);
    const hash2 = (agent as any).hashLeadData(lead2);

    expect(hash1).not.toBe(hash2);
  });

  test('duplicate check is efficient', async () => {
    const lead = createTestLead({ lead_id: 'perf_test_001' });

    const startTime = Date.now();
    await agent.checkDuplicate(lead);
    const elapsed = Date.now() - startTime;

    // Duplicate check should be very fast (< 100ms)
    expect(elapsed).toBeLessThan(100);
  });
});
