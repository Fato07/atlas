/**
 * Vertical Detection Unit Tests
 *
 * Tests for database-driven vertical detection using VerticalRegistry.
 * Implements waterfall detection strategy:
 * 1. Explicit vertical (confidence: 1.0)
 * 2. Industry keyword match (confidence: 0.9)
 * 3. Campaign pattern match (confidence: 0.7)
 * 4. Title keyword match (confidence: 0.5)
 * 5. AI classification fallback (confidence: 0.6+)
 * 6. Default fallback (confidence: 0.1)
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  detectVertical,
  detectVerticalFromLead,
  getDetectionMethod,
  DEFAULT_VERTICAL,
} from '../../lead-scorer/vertical-detector';
import type { LeadInput } from '../../lead-scorer/contracts/lead-input';
import { VerticalRegistry } from '@atlas-gtm/lib';
import type { VerticalDetectionIndex, VerticalDetectionInput } from '@atlas-gtm/lib';

// ===========================================
// Test Helpers
// ===========================================

/**
 * Create a mock VerticalDetectionIndex with test data.
 */
function createMockDetectionIndex(): VerticalDetectionIndex {
  return {
    industryToVertical: new Map([
      ['fintech', 'fintech'],
      ['financial technology', 'fintech'],
      ['payments', 'fintech'],
      ['healthcare', 'healthcare'],
      ['clinical', 'healthcare'],
      ['defense', 'defense'],
      ['aerospace', 'defense'],
      ['investor relations', 'iro'],
      ['saas', 'saas'],
      ['software', 'saas'],
    ]),
    titleToVertical: new Map([
      ['investor relations', 'iro'],
      ['ir director', 'iro'],
      ['ir manager', 'iro'],
      ['cfo', 'iro'],
      ['chief financial officer', 'iro'],
      ['payments', 'fintech'],
      ['clinical', 'healthcare'],
      ['clinical director', 'healthcare'],
      ['vp of engineering', 'saas'],
      ['engineering', 'saas'],
    ]),
    campaignToVertical: new Map([
      ['iro_*', 'iro'],
      ['fintech_*', 'fintech'],
      ['health_*', 'healthcare'],
      ['def_*', 'defense'],
    ]),
    aliasToVertical: new Map([
      ['ir', 'iro'],
      ['fin', 'fintech'],
      ['health', 'healthcare'],
      ['aero', 'defense'],
    ]),
    exclusions: new Map(),
    builtAt: new Date(),
  };
}

/**
 * Create a test VerticalRegistry with mock data injected.
 */
function createTestRegistry(): VerticalRegistry {
  const registry = new VerticalRegistry();
  registry.setDetectionIndexForTesting(createMockDetectionIndex());
  return registry;
}

/**
 * Create a lead input for testing.
 */
function createLead(overrides: Partial<LeadInput> = {}): LeadInput {
  return {
    lead_id: 'test_lead_001',
    email: 'test@example.com',
    company: 'Test Company',
    source: 'linkedin',
    ...overrides,
  };
}

/**
 * Create a detection input for testing.
 */
function createDetectionInput(
  overrides: Partial<VerticalDetectionInput> = {}
): VerticalDetectionInput {
  return {
    vertical: undefined,
    industry: undefined,
    title: undefined,
    campaign_id: undefined,
    company_name: 'Test Company',
    ...overrides,
  };
}

// ===========================================
// Test Setup
// ===========================================

let index: VerticalDetectionIndex;
let registry: VerticalRegistry;

beforeEach(() => {
  index = createMockDetectionIndex();
  registry = createTestRegistry();
});

// ===========================================
// Explicit Vertical Detection
// ===========================================

describe('detectVertical - Explicit vertical', () => {
  test('uses explicit vertical when provided', async () => {
    const input = createDetectionInput({ vertical: 'fintech' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('fintech');
    expect(result.confidence).toBe(1.0);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].attribute).toBe('vertical');
    expect(result.method).toBe('explicit');
  });

  test('normalizes explicit vertical to lowercase', async () => {
    const input = createDetectionInput({ vertical: 'FinTech' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('fintech');
  });

  test('ignores empty explicit vertical', async () => {
    const input = createDetectionInput({ vertical: '' });
    const result = await detectVertical(input, index);

    // Should fall through to other detection methods
    expect(result.confidence).toBeLessThan(1.0);
  });

  test('ignores whitespace-only explicit vertical', async () => {
    const input = createDetectionInput({ vertical: '   ' });
    const result = await detectVertical(input, index);

    expect(result.confidence).toBeLessThan(1.0);
  });
});

// ===========================================
// Industry-Based Detection
// ===========================================

describe('detectVertical - Industry mapping', () => {
  test('maps fintech industry correctly', async () => {
    const input = createDetectionInput({ industry: 'fintech' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('fintech');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.signals[0].attribute).toBe('industry');
    expect(result.method).toBe('industry');
  });

  test('maps healthcare industry correctly', async () => {
    const input = createDetectionInput({ industry: 'healthcare' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('healthcare');
  });

  test('maps defense industry correctly', async () => {
    const input = createDetectionInput({ industry: 'defense' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('defense');
  });

  test('maps investor relations industry to iro', async () => {
    const input = createDetectionInput({ industry: 'investor relations' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('iro');
  });

  test('handles case-insensitive industry matching', async () => {
    const input = createDetectionInput({ industry: 'FINTECH' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('fintech');
  });

  test('matches partial industry names', async () => {
    const input = createDetectionInput({ industry: 'financial technology company' });
    const result = await detectVertical(input, index);

    // Should match 'fintech' or 'financial technology'
    expect(result.vertical).toBe('fintech');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  test('falls through when industry not recognized', async () => {
    const input = createDetectionInput({ industry: 'unknown_industry_xyz' });
    const result = await detectVertical(input, index);

    // Should fall through to default
    expect(result.confidence).toBeLessThan(0.7);
  });
});

// ===========================================
// Campaign Pattern Detection
// ===========================================

describe('detectVertical - Campaign patterns', () => {
  test('matches campaign pattern for iro', async () => {
    const input = createDetectionInput({ campaign_id: 'iro_q1_2024' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('iro');
    expect(result.confidence).toBe(0.7);
    expect(result.method).toBe('campaign');
  });

  test('matches campaign pattern for fintech', async () => {
    const input = createDetectionInput({ campaign_id: 'fintech_campaign_001' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('fintech');
    expect(result.confidence).toBe(0.7);
  });
});

// ===========================================
// Title Keyword Detection
// ===========================================

describe('detectVertical - Title keywords', () => {
  test('detects iro from IR title', async () => {
    const input = createDetectionInput({ title: 'Director of Investor Relations' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('iro');
    expect(result.confidence).toBe(0.5);
    expect(result.signals[0].attribute).toBe('title');
    expect(result.method).toBe('title');
  });

  test('detects iro from CFO title', async () => {
    const input = createDetectionInput({ title: 'Chief Financial Officer' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('iro');
  });

  test('detects fintech from payments title', async () => {
    const input = createDetectionInput({ title: 'Head of Payments' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('fintech');
  });

  test('detects healthcare from clinical title', async () => {
    const input = createDetectionInput({ title: 'Clinical Director' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('healthcare');
  });

  test('detects saas from engineering title', async () => {
    const input = createDetectionInput({ title: 'VP of Engineering' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('saas');
  });

  test('handles case-insensitive title matching', async () => {
    const input = createDetectionInput({ title: 'INVESTOR RELATIONS MANAGER' });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('iro');
  });
});

// ===========================================
// Default Fallback
// ===========================================

describe('detectVertical - Default fallback', () => {
  test('returns default vertical when no signals match', async () => {
    const input = createDetectionInput({
      industry: undefined,
      title: undefined,
      vertical: undefined,
    });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe(DEFAULT_VERTICAL);
    expect(result.confidence).toBe(0.1);
    expect(result.signals[0].attribute).toBe('default');
    expect(result.method).toBe('default');
  });

  test('returns default for unrecognized industry and title', async () => {
    const input = createDetectionInput({
      industry: 'xyz_unrecognized',
      title: 'Unknown Position',
    });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe(DEFAULT_VERTICAL);
    expect(result.confidence).toBe(0.1);
  });
});

// ===========================================
// Detection Priority
// ===========================================

describe('detectVertical - Priority order', () => {
  test('explicit vertical takes precedence over industry', async () => {
    const input = createDetectionInput({
      vertical: 'healthcare',
      industry: 'fintech',
      title: 'CFO', // Would normally map to iro
    });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('healthcare');
    expect(result.confidence).toBe(1.0);
    expect(result.method).toBe('explicit');
  });

  test('industry takes precedence over title', async () => {
    const input = createDetectionInput({
      industry: 'fintech',
      title: 'Clinical Director', // Would normally map to healthcare
    });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('fintech');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.method).toBe('industry');
  });

  test('campaign takes precedence over title', async () => {
    const input = createDetectionInput({
      campaign_id: 'fintech_campaign_001',
      title: 'Clinical Director', // Would normally map to healthcare
    });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('fintech');
    expect(result.confidence).toBe(0.7);
    expect(result.method).toBe('campaign');
  });

  test('title takes precedence over default', async () => {
    const input = createDetectionInput({
      industry: 'unknown',
      title: 'VP of Engineering',
    });
    const result = await detectVertical(input, index);

    expect(result.vertical).toBe('saas');
    expect(result.confidence).toBe(0.5);
    expect(result.method).toBe('title');
  });
});

// ===========================================
// Utility Functions
// ===========================================

describe('getDetectionMethod', () => {
  test('returns correct method for confidence levels', () => {
    expect(getDetectionMethod(1.0)).toBe('explicit');
    expect(getDetectionMethod(0.9)).toBe('industry');
    expect(getDetectionMethod(0.7)).toBe('campaign');
    expect(getDetectionMethod(0.5)).toBe('title');
    expect(getDetectionMethod(0.3)).toBe('ai');
    expect(getDetectionMethod(0.1)).toBe('default');
    expect(getDetectionMethod(0.0)).toBe('default');
  });
});

describe('DEFAULT_VERTICAL', () => {
  test('default vertical is saas', () => {
    expect(DEFAULT_VERTICAL).toBe('saas');
  });
});

// ===========================================
// Edge Cases
// ===========================================

describe('Edge case: no matching vertical fallback', () => {
  test('unknown industry returns default vertical as fallback', async () => {
    const input = createDetectionInput({
      industry: 'completely_unknown_industry',
      title: 'Random Position',
    });

    const result = await detectVertical(input, index);

    // Should fall back to default vertical (saas)
    expect(result.vertical).toBe('saas');
    expect(result.confidence).toBeLessThan(0.5);
  });

  test('lead with no industry or title falls back to default', async () => {
    const input = createDetectionInput({});

    const result = await detectVertical(input, index);

    // Falls back to DEFAULT_VERTICAL (saas)
    expect(result.vertical).toBe('saas');
    expect(result.confidence).toBeLessThan(0.5);
  });

  test('aerospace maps to defense vertical', async () => {
    const input = createDetectionInput({
      industry: 'aerospace',
    });

    const result = await detectVertical(input, index);

    // aerospace is in the defense vertical keywords
    expect(result.vertical).toBe('defense');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test('fallback detection method is "default"', async () => {
    const input = createDetectionInput({});
    const result = await detectVertical(input, index);

    if (result.confidence < 0.3) {
      expect(getDetectionMethod(result.confidence)).toBe('default');
    }
  });
});

// ===========================================
// Convenience Wrapper Tests
// ===========================================

describe('detectVerticalFromLead', () => {
  test('detects vertical from lead using registry', async () => {
    const lead = createLead({ industry: 'fintech' });
    const result = await detectVerticalFromLead(lead, registry);

    expect(result.vertical).toBe('fintech');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  test('uses explicit vertical from lead', async () => {
    const lead = createLead({ vertical: 'healthcare' });
    const result = await detectVerticalFromLead(lead, registry);

    expect(result.vertical).toBe('healthcare');
    expect(result.confidence).toBe(1.0);
  });

  test('falls back to default when no signals match', async () => {
    const lead = createLead({});
    const result = await detectVerticalFromLead(lead, registry);

    expect(result.vertical).toBe(DEFAULT_VERTICAL);
  });
});

// ===========================================
// Detection Options Tests
// ===========================================

describe('detectVertical - Options', () => {
  test('forceMethod=explicit only checks explicit', async () => {
    const input = createDetectionInput({
      industry: 'fintech', // Would normally match
      vertical: 'healthcare',
    });
    const result = await detectVertical(input, index, { forceMethod: 'explicit' });

    expect(result.vertical).toBe('healthcare');
    expect(result.method).toBe('explicit');
  });

  test('forceMethod=industry skips explicit check', async () => {
    const input = createDetectionInput({
      vertical: 'healthcare', // Would normally match first
      industry: 'fintech',
    });
    const result = await detectVertical(input, index, { forceMethod: 'industry' });

    expect(result.vertical).toBe('fintech');
    expect(result.method).toBe('industry');
  });
});
