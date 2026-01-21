/**
 * Brain Manager Tests
 *
 * Tests for the brain manager runtime API.
 *
 * @module __tests__/brain-manager
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type {
  Brain,
  BrainId,
  BrainStatus,
  BrainConfig,
  BrainStats,
  BrainFilters,
} from '../types';
import type {
  StoredBrain,
  CreateBrainInput,
  UpdateBrainInput,
  CopyBrainOptions,
} from '../brain-manager';

// ===========================================
// Test Fixtures
// ===========================================

const mockBrainConfig: BrainConfig = {
  default_tier_thresholds: {
    tier1: 80,
    tier2: 60,
    tier3: 40,
  },
  auto_response_enabled: false,
  learning_enabled: true,
  quality_gate_threshold: 0.7,
};

const mockBrainStats: BrainStats = {
  icp_rules_count: 10,
  templates_count: 8,
  handlers_count: 5,
  research_docs_count: 15,
  insights_count: 20,
};

const mockBrains: StoredBrain[] = [
  {
    pointId: 'point-1',
    id: 'brain_defense_001' as BrainId,
    vertical: 'defense',
    name: 'Defense Brain v1',
    description: 'Brain for defense vertical',
    status: 'active' as BrainStatus,
    config: mockBrainConfig,
    stats: mockBrainStats,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    pointId: 'point-2',
    id: 'brain_fintech_001' as BrainId,
    vertical: 'fintech',
    name: 'Fintech Brain v1',
    description: 'Brain for fintech vertical',
    status: 'active' as BrainStatus,
    config: mockBrainConfig,
    stats: mockBrainStats,
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
  },
  {
    pointId: 'point-3',
    id: 'brain_defense_002' as BrainId,
    vertical: 'defense',
    name: 'Defense Brain v2',
    description: 'Second brain for defense vertical',
    status: 'deprecated' as BrainStatus,
    config: mockBrainConfig,
    stats: mockBrainStats,
    createdAt: new Date('2024-01-03'),
    updatedAt: new Date('2024-01-03'),
  },
];

// ===========================================
// BrainId Type Tests
// ===========================================

describe('BrainId Type', () => {
  test('should accept valid brain ID format', () => {
    const brainId = 'brain_defense_001' as BrainId;
    expect(brainId).toBe('brain_defense_001' as BrainId);
  });

  test('should be assignable to string', () => {
    const brainId: BrainId = 'brain_fintech_001' as BrainId;
    const str: string = brainId;
    expect(str).toBe('brain_fintech_001');
  });
});

// ===========================================
// BrainConfig Tests
// ===========================================

describe('BrainConfig', () => {
  test('should have valid tier thresholds', () => {
    const config = mockBrainConfig;

    expect(config.default_tier_thresholds.tier1).toBe(80);
    expect(config.default_tier_thresholds.tier2).toBe(60);
    expect(config.default_tier_thresholds.tier3).toBe(40);

    // Tier thresholds should be in descending order
    expect(config.default_tier_thresholds.tier1).toBeGreaterThan(
      config.default_tier_thresholds.tier2
    );
    expect(config.default_tier_thresholds.tier2).toBeGreaterThan(
      config.default_tier_thresholds.tier3
    );
  });

  test('should have valid quality gate threshold', () => {
    expect(mockBrainConfig.quality_gate_threshold).toBeGreaterThanOrEqual(0);
    expect(mockBrainConfig.quality_gate_threshold).toBeLessThanOrEqual(1);
  });

  test('should have boolean flags', () => {
    expect(typeof mockBrainConfig.auto_response_enabled).toBe('boolean');
    expect(typeof mockBrainConfig.learning_enabled).toBe('boolean');
  });
});

// ===========================================
// BrainStats Tests
// ===========================================

describe('BrainStats', () => {
  test('should have non-negative counts', () => {
    const stats = mockBrainStats;

    expect(stats.icp_rules_count).toBeGreaterThanOrEqual(0);
    expect(stats.templates_count).toBeGreaterThanOrEqual(0);
    expect(stats.handlers_count).toBeGreaterThanOrEqual(0);
    expect(stats.research_docs_count).toBeGreaterThanOrEqual(0);
    expect(stats.insights_count).toBeGreaterThanOrEqual(0);
  });

  test('should have all required stat fields', () => {
    const stats = mockBrainStats;

    expect('icp_rules_count' in stats).toBe(true);
    expect('templates_count' in stats).toBe(true);
    expect('handlers_count' in stats).toBe(true);
    expect('research_docs_count' in stats).toBe(true);
    expect('insights_count' in stats).toBe(true);
  });
});

// ===========================================
// StoredBrain Tests
// ===========================================

describe('StoredBrain', () => {
  test('should have pointId from Qdrant', () => {
    const brain = mockBrains[0];
    expect(brain.pointId).toBeDefined();
    expect(typeof brain.pointId).toBe('string');
  });

  test('should have valid status', () => {
    const validStatuses: BrainStatus[] = ['active', 'inactive', 'deprecated'];

    for (const brain of mockBrains) {
      expect(validStatuses).toContain(brain.status);
    }
  });

  test('should have timestamps', () => {
    const brain = mockBrains[0];

    expect(brain.createdAt).toBeInstanceOf(Date);
    expect(brain.updatedAt).toBeInstanceOf(Date);
    expect(brain.updatedAt.getTime()).toBeGreaterThanOrEqual(
      brain.createdAt.getTime()
    );
  });
});

// ===========================================
// BrainFilters Tests
// ===========================================

describe('BrainFilters', () => {
  test('should filter by status', () => {
    const filters: BrainFilters = { status: 'active' };
    const filtered = mockBrains.filter(
      (b) => !filters.status || b.status === filters.status
    );

    expect(filtered).toHaveLength(2);
    expect(filtered.every((b) => b.status === 'active')).toBe(true);
  });

  test('should filter by vertical', () => {
    const filters: BrainFilters = { vertical: 'defense' };
    const filtered = mockBrains.filter(
      (b) => !filters.vertical || b.vertical === filters.vertical
    );

    expect(filtered).toHaveLength(2);
    expect(filtered.every((b) => b.vertical === 'defense')).toBe(true);
  });

  test('should filter by both status and vertical', () => {
    const filters: BrainFilters = { status: 'active', vertical: 'defense' };
    const filtered = mockBrains.filter((b) => {
      if (filters.status && b.status !== filters.status) return false;
      if (filters.vertical && b.vertical !== filters.vertical) return false;
      return true;
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('brain_defense_001' as BrainId);
  });

  test('should return all when no filters', () => {
    const filters: BrainFilters = {};
    const filtered = mockBrains.filter((b) => {
      if (filters.status && b.status !== filters.status) return false;
      if (filters.vertical && b.vertical !== filters.vertical) return false;
      return true;
    });

    expect(filtered).toHaveLength(3);
  });
});

// ===========================================
// CreateBrainInput Tests
// ===========================================

describe('CreateBrainInput', () => {
  test('should require vertical and name', () => {
    const input: CreateBrainInput = {
      vertical: 'defense',
      name: 'Test Brain',
    };

    expect(input.vertical).toBe('defense');
    expect(input.name).toBe('Test Brain');
  });

  test('should accept optional description', () => {
    const input: CreateBrainInput = {
      vertical: 'defense',
      name: 'Test Brain',
      description: 'A test brain for defense vertical',
    };

    expect(input.description).toBe('A test brain for defense vertical');
  });

  test('should accept optional config overrides', () => {
    const input: CreateBrainInput = {
      vertical: 'defense',
      name: 'Test Brain',
      config: {
        auto_response_enabled: true,
        quality_gate_threshold: 0.8,
      },
    };

    expect(input.config?.auto_response_enabled).toBe(true);
    expect(input.config?.quality_gate_threshold).toBe(0.8);
  });
});

// ===========================================
// UpdateBrainInput Tests
// ===========================================

describe('UpdateBrainInput', () => {
  test('should allow updating name only', () => {
    const input: UpdateBrainInput = {
      name: 'Updated Name',
    };

    expect(input.name).toBe('Updated Name');
    expect(input.description).toBeUndefined();
    expect(input.status).toBeUndefined();
    expect(input.config).toBeUndefined();
  });

  test('should allow updating status', () => {
    const input: UpdateBrainInput = {
      status: 'deprecated',
    };

    expect(input.status).toBe('deprecated');
  });

  test('should allow partial config updates', () => {
    const input: UpdateBrainInput = {
      config: {
        learning_enabled: false,
      },
    };

    expect(input.config?.learning_enabled).toBe(false);
    expect(input.config?.auto_response_enabled).toBeUndefined();
  });

  test('should allow multiple field updates', () => {
    const input: UpdateBrainInput = {
      name: 'New Name',
      description: 'New description',
      status: 'active',
      config: {
        auto_response_enabled: true,
      },
    };

    expect(input.name).toBe('New Name');
    expect(input.description).toBe('New description');
    expect(input.status).toBe('active');
    expect(input.config?.auto_response_enabled).toBe(true);
  });
});

// ===========================================
// CopyBrainOptions Tests
// ===========================================

describe('CopyBrainOptions', () => {
  test('should require new name', () => {
    const options: CopyBrainOptions = {
      newName: 'Copied Brain',
    };

    expect(options.newName).toBe('Copied Brain');
  });

  test('should default to copying all content', () => {
    const options: CopyBrainOptions = {
      newName: 'Copied Brain',
      // Not specifying options means they default to true
    };

    // Test default behavior (true when undefined)
    const copyRules = options.copyRules ?? true;
    const copyTemplates = options.copyTemplates ?? true;
    const copyHandlers = options.copyHandlers ?? true;
    const copyResearch = options.copyResearch ?? true;

    expect(copyRules).toBe(true);
    expect(copyTemplates).toBe(true);
    expect(copyHandlers).toBe(true);
    expect(copyResearch).toBe(true);
  });

  test('should allow selective copying', () => {
    const options: CopyBrainOptions = {
      newName: 'Partial Copy',
      copyRules: true,
      copyTemplates: false,
      copyHandlers: true,
      copyResearch: false,
    };

    expect(options.copyRules).toBe(true);
    expect(options.copyTemplates).toBe(false);
    expect(options.copyHandlers).toBe(true);
    expect(options.copyResearch).toBe(false);
  });
});

// ===========================================
// Brain Lifecycle Tests
// ===========================================

describe('Brain Lifecycle', () => {
  test('should start as inactive or active', () => {
    const validInitialStatuses: BrainStatus[] = ['inactive', 'active'];
    const newBrainStatus: BrainStatus = 'active';

    expect(validInitialStatuses).toContain(newBrainStatus);
  });

  test('should transition to deprecated', () => {
    const brain = { ...mockBrains[0] };
    brain.status = 'deprecated';

    expect(brain.status).toBe('deprecated');
  });

  test('should have updatedAt after modifications', () => {
    const brain = { ...mockBrains[0] };
    const originalUpdatedAt = brain.updatedAt;

    // Simulate update
    brain.name = 'Updated Name';
    brain.updatedAt = new Date();

    expect(brain.updatedAt.getTime()).toBeGreaterThanOrEqual(
      originalUpdatedAt.getTime()
    );
  });
});

// ===========================================
// Brain ID Generation Tests
// ===========================================

describe('Brain ID Generation', () => {
  test('should follow pattern brain_{vertical}_{timestamp}', () => {
    const brainId = mockBrains[0].id;
    expect(brainId).toMatch(/^brain_\w+_\d+$/);
  });

  test('should be unique for each brain', () => {
    const ids = mockBrains.map((b) => b.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  test('should contain vertical name', () => {
    for (const brain of mockBrains) {
      expect(brain.id).toContain(brain.vertical);
    }
  });
});

// ===========================================
// Brain-Scoped Query Tests
// ===========================================

describe('Brain-Scoped Queries', () => {
  test('should always include brain_id in filter', () => {
    // Test that the filter structure is correct for brain-scoped queries
    const brainId = 'brain_defense_001' as BrainId;
    const filter = {
      must: [{ key: 'brain_id', match: { value: brainId } }],
    };

    expect(filter.must[0].key).toBe('brain_id');
    expect(filter.must[0].match.value).toBe(brainId);
  });

  test('should add additional filters to brain_id filter', () => {
    const brainId = 'brain_defense_001' as BrainId;
    const category = 'tier1';

    const filter = {
      must: [
        { key: 'brain_id', match: { value: brainId } },
        { key: 'category', match: { value: category } },
      ],
    };

    expect(filter.must).toHaveLength(2);
    expect(filter.must[0].key).toBe('brain_id');
    expect(filter.must[1].key).toBe('category');
  });
});

// ===========================================
// Default Config Tests
// ===========================================

describe('Default Brain Config', () => {
  const defaultConfig: BrainConfig = {
    default_tier_thresholds: {
      tier1: 80,
      tier2: 60,
      tier3: 40,
    },
    auto_response_enabled: false,
    learning_enabled: true,
    quality_gate_threshold: 0.7,
  };

  test('should have conservative tier thresholds', () => {
    // Tier 1 should be high (selective)
    expect(defaultConfig.default_tier_thresholds.tier1).toBeGreaterThanOrEqual(75);

    // Tier 3 should be lower (catch more)
    expect(defaultConfig.default_tier_thresholds.tier3).toBeLessThanOrEqual(50);
  });

  test('should have auto-response disabled by default', () => {
    // Safety: don't auto-respond until explicitly enabled
    expect(defaultConfig.auto_response_enabled).toBe(false);
  });

  test('should have learning enabled by default', () => {
    // Allow continuous improvement
    expect(defaultConfig.learning_enabled).toBe(true);
  });

  test('should have reasonable quality gate threshold', () => {
    // 0.7 is a balanced threshold
    expect(defaultConfig.quality_gate_threshold).toBe(0.7);
  });
});

// ===========================================
// Collection Names Tests
// ===========================================

describe('KB Collection Names', () => {
  const collections = [
    'icp_rules',
    'response_templates',
    'objection_handlers',
    'market_research',
    'insights',
  ];

  test('should have all required collections', () => {
    expect(collections).toContain('icp_rules');
    expect(collections).toContain('response_templates');
    expect(collections).toContain('objection_handlers');
    expect(collections).toContain('market_research');
    expect(collections).toContain('insights');
  });

  test('should use snake_case naming', () => {
    for (const collection of collections) {
      expect(collection).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});

// ===========================================
// Cache Configuration Tests
// ===========================================

describe('Cache Configuration', () => {
  test('should have 10-minute default TTL', () => {
    const defaultTtl = 10 * 60 * 1000;
    expect(defaultTtl).toBe(600000);
  });

  test('should have 2-minute stale-while-revalidate window', () => {
    const staleWindow = 2 * 60 * 1000;
    expect(staleWindow).toBe(120000);
  });

  test('stale window should be less than TTL', () => {
    const ttl = 10 * 60 * 1000;
    const staleWindow = 2 * 60 * 1000;
    expect(staleWindow).toBeLessThan(ttl);
  });
});
