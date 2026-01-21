/**
 * Audit Trail Tests
 *
 * Tests for FR-010: Complete scoring breakdown and audit trail
 * Tests for US4: Scoring transparency and traceability
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  validateScoringResult,
  safeValidateScoringResult,
  toAirtableUpdate,
  shouldNotifySlack,
  getTopSignals,
  formatSlackMessage,
  type ScoringResult,
  type RuleResult,
} from '../../lead-scorer/contracts/scoring-result';
import { LeadScorerAgent, createLeadScorerAgent } from '../../lead-scorer/agent';
import type { LeadInput } from '../../lead-scorer/contracts/lead-input';
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
      ['gambling', 'gambling'], // For knockout tests
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

function createTestScoringResult(overrides: Partial<ScoringResult> = {}): ScoringResult {
  return {
    lead_id: 'test_lead_001',
    score: 75,
    tier: 'priority',
    scoring_breakdown: [
      {
        rule_id: 'rule_001',
        attribute: 'company_size',
        value: 150,
        score: 25,
        max_score: 30,
        reasoning: 'Company size in target range',
      },
      {
        rule_id: 'rule_002',
        attribute: 'title',
        value: 'VP of Engineering',
        score: 20,
        max_score: 25,
        reasoning: 'Decision maker title matched',
      },
    ],
    recommended_angle: 'technical',
    personalization_hints: ['Mention their Series B', 'Reference their tech stack'],
    vertical_detected: 'fintech',
    brain_used: 'brain_fintech_v1',
    processing_time_ms: 45,
    rules_evaluated: 4,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ===========================================
// RuleResult Completeness Tests
// ===========================================

describe('RuleResult completeness', () => {
  test('contains all required audit fields', () => {
    const ruleResult: RuleResult = {
      rule_id: 'rule_test_001',
      attribute: 'company_size',
      value: 200,
      score: 28,
      max_score: 30,
      reasoning: 'Company size 200 is in ideal range (50-500)',
    };

    expect(ruleResult.rule_id).toBeDefined();
    expect(ruleResult.attribute).toBeDefined();
    expect(ruleResult.value).toBeDefined();
    expect(ruleResult.score).toBeDefined();
    expect(ruleResult.max_score).toBeDefined();
    expect(ruleResult.reasoning).toBeDefined();
  });

  test('includes is_knockout when applicable', () => {
    const knockoutResult: RuleResult = {
      rule_id: 'rule_knockout_001',
      attribute: 'industry',
      value: 'gambling',
      score: 0,
      max_score: 0,
      reasoning: 'KNOCKOUT: Industry is in excluded list',
      is_knockout: true,
    };

    expect(knockoutResult.is_knockout).toBe(true);
  });

  test('reasoning explains the score decision', () => {
    const result: RuleResult = {
      rule_id: 'rule_001',
      attribute: 'funding_stage',
      value: 'series_b',
      score: 20,
      max_score: 20,
      reasoning: 'Series B funding matches target criteria (+20)',
    };

    expect(result.reasoning).toContain('Series B');
    expect(result.reasoning.length).toBeGreaterThan(10);
  });
});

// ===========================================
// ScoringResult Metadata Tests
// ===========================================

describe('ScoringResult metadata', () => {
  test('includes vertical_detected', () => {
    const result = createTestScoringResult({ vertical_detected: 'iro' });
    expect(result.vertical_detected).toBe('iro');
  });

  test('includes brain_used', () => {
    const result = createTestScoringResult({ brain_used: 'brain_iro_v1' });
    expect(result.brain_used).toBe('brain_iro_v1');
  });

  test('includes processing_time_ms', () => {
    const result = createTestScoringResult({ processing_time_ms: 123 });
    expect(result.processing_time_ms).toBe(123);
  });

  test('includes rules_evaluated count', () => {
    const result = createTestScoringResult({ rules_evaluated: 10 });
    expect(result.rules_evaluated).toBe(10);
  });

  test('includes ISO 8601 timestamp', () => {
    const result = createTestScoringResult();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('includes knockout_failed when applicable', () => {
    const result = createTestScoringResult({
      tier: 'disqualified',
      knockout_failed: 'rule_industry_knockout',
    });
    expect(result.knockout_failed).toBe('rule_industry_knockout');
  });
});

// ===========================================
// Validation Tests
// ===========================================

describe('validateScoringResult', () => {
  test('validates a complete scoring result', () => {
    const result = createTestScoringResult();
    const validated = validateScoringResult(result);

    expect(validated.lead_id).toBe(result.lead_id);
    expect(validated.score).toBe(result.score);
  });

  test('rejects invalid score (out of range)', () => {
    const result = createTestScoringResult({ score: 150 });

    expect(() => validateScoringResult(result)).toThrow();
  });

  test('rejects invalid tier', () => {
    const result = { ...createTestScoringResult(), tier: 'invalid_tier' };

    expect(() => validateScoringResult(result)).toThrow();
  });

  test('rejects missing required fields', () => {
    const result = { lead_id: 'test' }; // Missing required fields

    expect(() => validateScoringResult(result)).toThrow();
  });
});

describe('safeValidateScoringResult', () => {
  test('returns result for valid data', () => {
    const result = createTestScoringResult();
    const validated = safeValidateScoringResult(result);

    expect(validated).not.toBeNull();
    expect(validated?.lead_id).toBe(result.lead_id);
  });

  test('returns null for invalid data', () => {
    const result = { lead_id: 'test' }; // Missing required fields
    const validated = safeValidateScoringResult(result);

    expect(validated).toBeNull();
  });
});

// ===========================================
// Airtable Update Tests
// ===========================================

describe('toAirtableUpdate', () => {
  test('maps all required fields', () => {
    const result = createTestScoringResult();
    const update = toAirtableUpdate(result);

    expect(update.icp_score).toBe(result.score);
    expect(update.icp_tier).toBe(result.tier);
    expect(update.icp_angle).toBe(result.recommended_angle);
    expect(update.icp_scored_at).toBe(result.timestamp);
    expect(update.icp_brain_used).toBe(result.brain_used);
  });

  test('stringifies scoring_breakdown as JSON', () => {
    const result = createTestScoringResult();
    const update = toAirtableUpdate(result);

    expect(typeof update.icp_breakdown).toBe('string');
    const parsed = JSON.parse(update.icp_breakdown);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(result.scoring_breakdown.length);
  });

  test('sets outbound_ready for priority tier', () => {
    const result = createTestScoringResult({ tier: 'priority' });
    const update = toAirtableUpdate(result);

    expect(update.outbound_ready).toBe(true);
  });

  test('sets outbound_ready for qualified tier', () => {
    const result = createTestScoringResult({ tier: 'qualified', score: 55 });
    const update = toAirtableUpdate(result);

    expect(update.outbound_ready).toBe(true);
  });

  test('sets outbound_ready false for nurture tier', () => {
    const result = createTestScoringResult({ tier: 'nurture', score: 35 });
    const update = toAirtableUpdate(result);

    expect(update.outbound_ready).toBe(false);
  });

  test('sets outbound_ready false for disqualified tier', () => {
    const result = createTestScoringResult({ tier: 'disqualified', score: 10 });
    const update = toAirtableUpdate(result);

    expect(update.outbound_ready).toBe(false);
  });

  test('breakdown JSON includes all rule details', () => {
    const result = createTestScoringResult({
      scoring_breakdown: [
        {
          rule_id: 'rule_size',
          attribute: 'company_size',
          value: 250,
          score: 30,
          max_score: 30,
          reasoning: 'Perfect match',
        },
      ],
    });

    const update = toAirtableUpdate(result);
    const parsed = JSON.parse(update.icp_breakdown);

    expect(parsed[0].rule_id).toBe('rule_size');
    expect(parsed[0].attribute).toBe('company_size');
    expect(parsed[0].value).toBe(250);
    expect(parsed[0].score).toBe(30);
    expect(parsed[0].max_score).toBe(30);
    expect(parsed[0].reasoning).toBe('Perfect match');
  });
});

// ===========================================
// Slack Notification Tests
// ===========================================

describe('shouldNotifySlack', () => {
  test('returns true for qualified tier', () => {
    const result = createTestScoringResult({ tier: 'qualified', score: 55 });
    expect(shouldNotifySlack(result)).toBe(true);
  });

  test('returns false for priority tier', () => {
    const result = createTestScoringResult({ tier: 'priority' });
    expect(shouldNotifySlack(result)).toBe(false);
  });

  test('returns false for nurture tier', () => {
    const result = createTestScoringResult({ tier: 'nurture', score: 35 });
    expect(shouldNotifySlack(result)).toBe(false);
  });

  test('returns false for disqualified tier', () => {
    const result = createTestScoringResult({ tier: 'disqualified', score: 10 });
    expect(shouldNotifySlack(result)).toBe(false);
  });
});

describe('getTopSignals', () => {
  test('returns top N signals sorted by score', () => {
    const result = createTestScoringResult({
      scoring_breakdown: [
        { rule_id: 'r1', attribute: 'a1', value: 'v1', score: 10, max_score: 20, reasoning: 'r' },
        { rule_id: 'r2', attribute: 'a2', value: 'v2', score: 30, max_score: 30, reasoning: 'r' },
        { rule_id: 'r3', attribute: 'a3', value: 'v3', score: 20, max_score: 25, reasoning: 'r' },
      ],
    });

    const topSignals = getTopSignals(result, 2);

    expect(topSignals).toHaveLength(2);
    expect(topSignals[0].score).toBe(30);
    expect(topSignals[1].score).toBe(20);
  });

  test('defaults to 3 signals', () => {
    const result = createTestScoringResult({
      scoring_breakdown: [
        { rule_id: 'r1', attribute: 'a1', value: 'v1', score: 10, max_score: 20, reasoning: 'r' },
        { rule_id: 'r2', attribute: 'a2', value: 'v2', score: 30, max_score: 30, reasoning: 'r' },
        { rule_id: 'r3', attribute: 'a3', value: 'v3', score: 20, max_score: 25, reasoning: 'r' },
        { rule_id: 'r4', attribute: 'a4', value: 'v4', score: 25, max_score: 30, reasoning: 'r' },
      ],
    });

    const topSignals = getTopSignals(result);

    expect(topSignals).toHaveLength(3);
  });

  test('returns all if fewer than N signals', () => {
    const result = createTestScoringResult({
      scoring_breakdown: [
        { rule_id: 'r1', attribute: 'a1', value: 'v1', score: 10, max_score: 20, reasoning: 'r' },
      ],
    });

    const topSignals = getTopSignals(result, 5);

    expect(topSignals).toHaveLength(1);
  });
});

describe('formatSlackMessage', () => {
  test('includes lead ID and score', () => {
    const result = createTestScoringResult({
      lead_id: 'lead_123',
      score: 65,
      tier: 'qualified',
    });

    const message = formatSlackMessage(result);

    expect(message).toContain('lead_123');
    expect(message).toContain('65');
    expect(message).toContain('qualified');
  });

  test('includes top signals', () => {
    const result = createTestScoringResult({
      scoring_breakdown: [
        { rule_id: 'r1', attribute: 'company_size', value: 200, score: 25, max_score: 30, reasoning: 'Match' },
      ],
    });

    const message = formatSlackMessage(result);

    expect(message).toContain('company_size');
    expect(message).toContain('25');
    expect(message).toContain('30');
  });

  test('includes recommended angle', () => {
    const result = createTestScoringResult({ recommended_angle: 'compliance' });
    const message = formatSlackMessage(result);

    expect(message).toContain('compliance');
  });

  test('includes personalization hints', () => {
    const result = createTestScoringResult({
      personalization_hints: ['Mention their funding'],
    });

    const message = formatSlackMessage(result);

    expect(message).toContain('Mention their funding');
  });

  test('includes action buttons', () => {
    const result = createTestScoringResult();
    const message = formatSlackMessage(result);

    expect(message).toContain('[Approve]');
    expect(message).toContain('[Reject]');
    expect(message).toContain('[Adjust Score]');
  });
});

// ===========================================
// Integration: Agent produces complete audit trail
// ===========================================

describe('Agent audit trail integration', () => {
  let agent: LeadScorerAgent;

  beforeEach(() => {
    // Create agent with test registry (mock vertical detection data)
    agent = createLeadScorerAgent({
      verticalRegistry: createTestRegistry(),
    });
  });

  test('scoring result includes complete RuleResult breakdown', async () => {
    const lead = createTestLead({
      company_size: 150,
      title: 'VP of Engineering',
      industry: 'fintech',
    });

    const result = await agent.scoreLead(lead);

    // Verify each rule result has complete context
    for (const ruleResult of result.scoring_breakdown) {
      expect(ruleResult.rule_id).toBeDefined();
      expect(typeof ruleResult.rule_id).toBe('string');

      expect(ruleResult.attribute).toBeDefined();
      expect(typeof ruleResult.attribute).toBe('string');

      // value can be any type
      expect('value' in ruleResult).toBe(true);

      expect(typeof ruleResult.score).toBe('number');
      expect(ruleResult.score).toBeGreaterThanOrEqual(0);

      expect(typeof ruleResult.max_score).toBe('number');
      expect(ruleResult.max_score).toBeGreaterThanOrEqual(0);

      expect(ruleResult.reasoning).toBeDefined();
      expect(typeof ruleResult.reasoning).toBe('string');
      expect(ruleResult.reasoning.length).toBeGreaterThan(0);
    }
  });

  test('scoring result includes all metadata fields', async () => {
    const lead = createTestLead({ industry: 'fintech' });

    const result = await agent.scoreLead(lead);

    // Verify all metadata fields are present
    expect(result.vertical_detected).toBe('fintech');
    expect(result.brain_used).toContain('fintech');
    expect(typeof result.processing_time_ms).toBe('number');
    expect(result.processing_time_ms).toBeGreaterThanOrEqual(0);
    expect(typeof result.rules_evaluated).toBe('number');
    expect(result.rules_evaluated).toBeGreaterThan(0);
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('knockout failure is recorded in result', async () => {
    const lead = createTestLead({
      industry: 'gambling', // Excluded industry
    });

    const result = await agent.scoreLead(lead);

    // Should be disqualified due to knockout
    expect(result.tier).toBe('disqualified');
    expect(result.knockout_failed).toBeDefined();
  });

  test('scoring result can be converted to Airtable format', async () => {
    const lead = createTestLead({
      company_size: 200,
      industry: 'fintech',
    });

    const result = await agent.scoreLead(lead);
    const airtableUpdate = toAirtableUpdate(result);

    // Verify Airtable format is complete
    expect(airtableUpdate.icp_score).toBe(result.score);
    expect(airtableUpdate.icp_tier).toBe(result.tier);
    expect(airtableUpdate.icp_angle).toBe(result.recommended_angle);
    expect(typeof airtableUpdate.icp_breakdown).toBe('string');

    // Breakdown can be parsed back to array
    const breakdown = JSON.parse(airtableUpdate.icp_breakdown);
    expect(Array.isArray(breakdown)).toBe(true);
    expect(breakdown.length).toBe(result.scoring_breakdown.length);
  });

  test('scoring result passes Zod validation', async () => {
    const lead = createTestLead({
      company_size: 100,
      title: 'CTO',
      industry: 'saas',
    });

    const result = await agent.scoreLead(lead);

    // Should not throw
    const validated = validateScoringResult(result);
    expect(validated.lead_id).toBe(result.lead_id);
  });

  test('qualified leads can generate Slack notification', async () => {
    const lead = createTestLead({
      company_size: 200,
      industry: 'iro',
      title: 'VP of Investor Relations',
      funding_stage: 'series_c',
      tech_stack: ['Salesforce', 'HubSpot'],
    });

    const result = await agent.scoreLead(lead);

    // If qualified, can generate Slack message
    if (result.tier === 'qualified') {
      expect(shouldNotifySlack(result)).toBe(true);

      const message = formatSlackMessage(result);
      expect(message).toContain(result.lead_id);
      expect(message).toContain(result.recommended_angle);
    }
  });
});

// ===========================================
// Edge Cases
// ===========================================

describe('Audit trail edge cases', () => {
  test('handles empty scoring breakdown', () => {
    const result = createTestScoringResult({
      scoring_breakdown: [],
      score: 0,
      tier: 'disqualified',
    });

    const update = toAirtableUpdate(result);
    const breakdown = JSON.parse(update.icp_breakdown);

    expect(breakdown).toEqual([]);
  });

  test('handles complex values in rule results', () => {
    const result = createTestScoringResult({
      scoring_breakdown: [
        {
          rule_id: 'r1',
          attribute: 'tech_stack',
          value: ['React', 'Node.js', 'AWS'],
          score: 20,
          max_score: 25,
          reasoning: 'Modern tech stack detected',
        },
      ],
    });

    const update = toAirtableUpdate(result);
    const breakdown = JSON.parse(update.icp_breakdown);

    expect(Array.isArray(breakdown[0].value)).toBe(true);
    expect(breakdown[0].value).toContain('React');
  });

  test('handles null/undefined optional values gracefully', () => {
    const result = createTestScoringResult({
      knockout_failed: undefined,
      recommended_sequence: undefined,
    });

    // Should not throw
    const validated = validateScoringResult(result);
    expect(validated.knockout_failed).toBeUndefined();
    expect(validated.recommended_sequence).toBeUndefined();
  });

  test('preserves special characters in reasoning', () => {
    const result = createTestScoringResult({
      scoring_breakdown: [
        {
          rule_id: 'r1',
          attribute: 'company',
          value: 'Test & Co. (Inc.)',
          score: 10,
          max_score: 10,
          reasoning: 'Company name: "Test & Co. (Inc.)" matched pattern',
        },
      ],
    });

    const update = toAirtableUpdate(result);
    const breakdown = JSON.parse(update.icp_breakdown);

    expect(breakdown[0].reasoning).toContain('&');
    expect(breakdown[0].reasoning).toContain('"');
  });
});
