/**
 * Vertical Registry Tests
 *
 * Tests for the data-driven vertical registry service.
 *
 * @module __tests__/vertical-registry
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import {
  VerticalRegistry,
  matchKeyword,
  matchCampaignPattern,
} from '../vertical-registry';
import type { VerticalPayload, VerticalDetectionIndex } from '../types';

// ===========================================
// Test Fixtures
// ===========================================

const mockVerticals: VerticalPayload[] = [
  {
    slug: 'defense',
    name: 'Defense & Aerospace',
    description: 'Military and aerospace companies',
    level: 0,
    industry_keywords: ['defense', 'aerospace', 'military', 'government contractor'],
    title_keywords: ['program manager', 'contracting officer'],
    campaign_patterns: ['defense_*', 'aero_*', 'gov_*'],
    detection_weights: { industry: 0.9, title: 0.5, campaign: 0.7 },
    aliases: ['aero', 'aerospace'],
    exclusion_keywords: ['real estate defense', 'legal defense'],
    ai_fallback_threshold: 0.5,
    example_companies: ['Lockheed Martin', 'Northrop Grumman'],
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    version: 1,
  },
  {
    slug: 'fintech',
    name: 'Financial Technology',
    description: 'Technology for financial services',
    level: 0,
    industry_keywords: ['fintech', 'financial technology', 'payments', 'banking technology'],
    title_keywords: ['chief financial', 'finance director', 'treasury'],
    campaign_patterns: ['fintech_*', 'finance_*', 'banking_*'],
    detection_weights: { industry: 0.9, title: 0.5, campaign: 0.7 },
    aliases: ['financial-technology', 'paytech'],
    exclusion_keywords: ['financial advisor', 'accounting firm'],
    ai_fallback_threshold: 0.5,
    example_companies: ['Stripe', 'Square', 'Plaid'],
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    version: 1,
  },
  {
    slug: 'saas',
    name: 'Software as a Service',
    description: 'Cloud-based software companies',
    level: 0,
    industry_keywords: ['saas', 'software as a service', 'cloud software'],
    title_keywords: ['software', 'engineering', 'product'],
    campaign_patterns: ['saas_*', 'software_*'],
    detection_weights: { industry: 0.9, title: 0.5, campaign: 0.7 },
    aliases: ['software', 'cloud'],
    exclusion_keywords: [],
    ai_fallback_threshold: 0.5,
    example_companies: ['Salesforce', 'HubSpot'],
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    version: 1,
  },
  {
    slug: 'inactive-vertical',
    name: 'Inactive Vertical',
    description: 'This vertical is inactive',
    level: 0,
    industry_keywords: ['inactive'],
    title_keywords: [],
    campaign_patterns: [],
    detection_weights: { industry: 0.9, title: 0.5, campaign: 0.7 },
    aliases: [],
    exclusion_keywords: [],
    ai_fallback_threshold: 0.5,
    example_companies: [],
    is_active: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    version: 1,
  },
];

// Build test detection index
function buildTestIndex(): VerticalDetectionIndex {
  const industryToVertical = new Map<string, string>();
  const titleToVertical = new Map<string, string>();
  const campaignToVertical = new Map<string, string>();
  const aliasToVertical = new Map<string, string>();
  const exclusions = new Map<string, Set<string>>();

  for (const vertical of mockVerticals.filter((v) => v.is_active)) {
    for (const keyword of vertical.industry_keywords) {
      industryToVertical.set(keyword.toLowerCase(), vertical.slug);
    }
    for (const keyword of vertical.title_keywords) {
      titleToVertical.set(keyword.toLowerCase(), vertical.slug);
    }
    for (const pattern of vertical.campaign_patterns) {
      campaignToVertical.set(pattern.toLowerCase(), vertical.slug);
    }
    for (const alias of vertical.aliases) {
      aliasToVertical.set(alias.toLowerCase(), vertical.slug);
    }
    if (vertical.exclusion_keywords.length > 0) {
      exclusions.set(
        vertical.slug,
        new Set(vertical.exclusion_keywords.map((k) => k.toLowerCase()))
      );
    }
  }

  return {
    industryToVertical,
    titleToVertical,
    campaignToVertical,
    aliasToVertical,
    exclusions,
    builtAt: new Date(),
  };
}

// ===========================================
// matchKeyword Tests
// ===========================================

describe('matchKeyword', () => {
  const index = buildTestIndex();

  test('should match exact keyword', () => {
    const result = matchKeyword('defense', index.industryToVertical);
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('defense');
    expect(result?.matchedKeyword).toBe('defense');
  });

  test('should match case-insensitively', () => {
    const result = matchKeyword('DEFENSE', index.industryToVertical);
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('defense');
  });

  test('should match partial keyword (value contains keyword)', () => {
    const result = matchKeyword('aerospace manufacturing', index.industryToVertical);
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('defense');
    expect(result?.matchedKeyword).toBe('aerospace');
  });

  test('should return null for no match', () => {
    const result = matchKeyword('healthcare', index.industryToVertical);
    expect(result).toBeNull();
  });

  test('should exclude matches based on exclusion keywords', () => {
    // "real estate defense" should be excluded from defense vertical
    const result = matchKeyword(
      'real estate defense',
      index.industryToVertical,
      index.exclusions
    );
    expect(result).toBeNull();
  });

  test('should exclude "legal defense" from defense vertical', () => {
    const result = matchKeyword(
      'legal defense attorney',
      index.industryToVertical,
      index.exclusions
    );
    expect(result).toBeNull();
  });

  test('should match fintech keywords', () => {
    const result = matchKeyword('fintech startup', index.industryToVertical);
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('fintech');
  });

  test('should exclude "financial advisor" from fintech', () => {
    const result = matchKeyword(
      'financial advisor services',
      index.industryToVertical,
      index.exclusions
    );
    expect(result).toBeNull();
  });

  test('should match title keywords', () => {
    const result = matchKeyword('Program Manager', index.titleToVertical);
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('defense');
  });

  test('should match aliases', () => {
    const result = matchKeyword('aero', index.aliasToVertical);
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('defense');
  });
});

// ===========================================
// matchCampaignPattern Tests
// ===========================================

describe('matchCampaignPattern', () => {
  const index = buildTestIndex();

  test('should match campaign pattern with wildcard', () => {
    const result = matchCampaignPattern(
      'defense_campaign_001',
      index.campaignToVertical
    );
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('defense');
    expect(result?.matchedPattern).toBe('defense_*');
  });

  test('should match campaign pattern case-insensitively', () => {
    const result = matchCampaignPattern(
      'DEFENSE_Campaign_002',
      index.campaignToVertical
    );
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('defense');
  });

  test('should match fintech campaign pattern', () => {
    const result = matchCampaignPattern(
      'fintech_q1_2024',
      index.campaignToVertical
    );
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('fintech');
    expect(result?.matchedPattern).toBe('fintech_*');
  });

  test('should return null for non-matching pattern', () => {
    const result = matchCampaignPattern(
      'healthcare_campaign',
      index.campaignToVertical
    );
    expect(result).toBeNull();
  });

  test('should match pattern at start only', () => {
    // "my_defense_campaign" should NOT match "defense_*" pattern
    const result = matchCampaignPattern(
      'my_defense_campaign',
      index.campaignToVertical
    );
    expect(result).toBeNull();
  });

  test('should match gov_ pattern', () => {
    const result = matchCampaignPattern('gov_contract_q2', index.campaignToVertical);
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('defense');
  });

  test('should match saas campaign pattern', () => {
    const result = matchCampaignPattern('saas_enterprise', index.campaignToVertical);
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('saas');
  });
});

// ===========================================
// VerticalRegistry Class Tests
// ===========================================

describe('VerticalRegistry', () => {
  describe('constructor', () => {
    test('should create instance with default config', () => {
      const registry = new VerticalRegistry();
      expect(registry).toBeDefined();
    });

    test('should create instance with custom config', () => {
      const registry = new VerticalRegistry({
        qdrantUrl: 'http://custom:6333',
        cacheTtlMs: 60000,
      });
      expect(registry).toBeDefined();
    });
  });

  describe('invalidateCaches', () => {
    test('should clear all caches', () => {
      const registry = new VerticalRegistry();
      registry.invalidateCaches();
      // Should not throw
      expect(true).toBe(true);
    });
  });
});

// ===========================================
// Detection Index Building Tests
// ===========================================

describe('Detection Index', () => {
  test('should build index with all keywords', () => {
    const index = buildTestIndex();

    expect(index.industryToVertical.size).toBeGreaterThan(0);
    expect(index.titleToVertical.size).toBeGreaterThan(0);
    expect(index.campaignToVertical.size).toBeGreaterThan(0);
    expect(index.aliasToVertical.size).toBeGreaterThan(0);
    expect(index.exclusions.size).toBeGreaterThan(0);
  });

  test('should not include inactive verticals in index', () => {
    const index = buildTestIndex();

    // 'inactive' keyword should not be in the index
    expect(index.industryToVertical.has('inactive')).toBe(false);
  });

  test('should have lowercase keys', () => {
    const index = buildTestIndex();

    for (const key of index.industryToVertical.keys()) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  test('should map keywords to correct verticals', () => {
    const index = buildTestIndex();

    expect(index.industryToVertical.get('defense')).toBe('defense');
    expect(index.industryToVertical.get('fintech')).toBe('fintech');
    expect(index.industryToVertical.get('saas')).toBe('saas');
    expect(index.industryToVertical.get('aerospace')).toBe('defense');
    expect(index.industryToVertical.get('payments')).toBe('fintech');
  });

  test('should have exclusions for defense vertical', () => {
    const index = buildTestIndex();

    const defenseExclusions = index.exclusions.get('defense');
    expect(defenseExclusions).toBeDefined();
    expect(defenseExclusions?.has('real estate defense')).toBe(true);
    expect(defenseExclusions?.has('legal defense')).toBe(true);
  });

  test('should have exclusions for fintech vertical', () => {
    const index = buildTestIndex();

    const fintechExclusions = index.exclusions.get('fintech');
    expect(fintechExclusions).toBeDefined();
    expect(fintechExclusions?.has('financial advisor')).toBe(true);
    expect(fintechExclusions?.has('accounting firm')).toBe(true);
  });
});

// ===========================================
// Edge Cases
// ===========================================

describe('Edge Cases', () => {
  const index = buildTestIndex();

  test('should handle empty string input', () => {
    const result = matchKeyword('', index.industryToVertical);
    expect(result).toBeNull();
  });

  test('should handle whitespace-only input', () => {
    const result = matchKeyword('   ', index.industryToVertical);
    expect(result).toBeNull();
  });

  test('should handle special characters in campaign', () => {
    const result = matchCampaignPattern(
      'defense_campaign-001_v2.0',
      index.campaignToVertical
    );
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('defense');
  });

  test('should handle very long input strings', () => {
    const longInput = 'defense '.repeat(1000);
    const result = matchKeyword(longInput, index.industryToVertical);
    expect(result).not.toBeNull();
    expect(result?.vertical).toBe('defense');
  });

  test('should handle unicode characters', () => {
    const result = matchKeyword('défense', index.industryToVertical);
    // Should not match 'defense' due to different characters
    expect(result).toBeNull();
  });
});

// ===========================================
// Performance Tests
// ===========================================

describe('Performance', () => {
  const index = buildTestIndex();

  test('should match keywords quickly (< 1ms per lookup)', () => {
    const iterations = 1000;
    const keywords = ['defense', 'fintech', 'aerospace', 'payments', 'saas'];

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      for (const keyword of keywords) {
        matchKeyword(keyword, index.industryToVertical, index.exclusions);
      }
    }
    const elapsed = performance.now() - start;

    const totalLookups = iterations * keywords.length;
    const avgMs = elapsed / totalLookups;

    // Should average less than 1ms per lookup
    expect(avgMs).toBeLessThan(1);
  });

  test('should match campaign patterns quickly', () => {
    const iterations = 1000;
    const campaigns = ['defense_001', 'fintech_q1', 'saas_enterprise'];

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      for (const campaign of campaigns) {
        matchCampaignPattern(campaign, index.campaignToVertical);
      }
    }
    const elapsed = performance.now() - start;

    const totalLookups = iterations * campaigns.length;
    const avgMs = elapsed / totalLookups;

    // Should average less than 1ms per lookup
    expect(avgMs).toBeLessThan(1);
  });
});
