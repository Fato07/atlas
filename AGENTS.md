# AGENTS.md

> Following the [AGENTS.md open standard](https://agents.md/) - a vendor-neutral format for guiding AI coding agents. Supported by Google, OpenAI, Sourcegraph, Cursor, and others.

## Project Overview

Atlas GTM - AI-first GTM Operations System for CodesDevs. Same agents, different brains for rapid market validation across verticals (defense, healthcare, fintech, etc.).

## Build & Test

```bash
# Install dependencies
bun install
cd mcp-servers && uv sync && cd ..

# Development
bun run dev                    # Start all packages in watch mode
bun run dev:agents             # Agents only
bun run mcp:dev                # MCP servers (Python)

# Testing
bun test                       # All tests
bun test:unit                  # Unit tests only
bun test:integration           # Integration tests (requires Docker)
bun test packages/agents       # Single package

# Type checking & linting
bun run typecheck              # TypeScript validation
bun run lint                   # ESLint
bun run lint:fix               # Auto-fix lint issues
bun run format                 # Prettier formatting

# Build
bun run build                  # Production build

# Database
bun run db:init                # Initialize Qdrant collections
bun run seed:brain             # Seed a new brain
```

### Docker / Infrastructure

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f qdrant  # Specific service
docker compose logs -f         # All services

# Stop services
docker compose down
```

## Architecture

```
atlas-gtm/
├── packages/
│   ├── lib/                    # Shared utilities
│   │   └── src/
│   │       ├── types.ts        # Branded types, Zod schemas
│   │       ├── qdrant.ts       # Qdrant client wrapper
│   │       ├── embeddings.ts   # Voyage AI embeddings
│   │       └── state.ts        # Agent state management
│   └── agents/                 # Production agents
│       └── src/
│           ├── base-agent.ts   # Base class with context tracking
│           ├── sub-agent.ts    # Sub-agent framework
│           ├── lead-scorer.ts  # Lead scoring (80k budget)
│           ├── reply-handler.ts # Reply handling (60k budget)
│           └── meeting-prep.ts # Meeting prep (100k budget)
├── mcp-servers/                # Python MCP servers
│   └── atlas_gtm_mcp/
│       ├── qdrant/             # Knowledge base tools
│       ├── attio/              # CRM tools
│       └── instantly/          # Email tools
├── scripts/
│   └── init-qdrant.ts          # Database initialization
└── state/                      # Agent state files (gitignored)
```

## Code Conventions

### TypeScript

- Explicit return types on all functions
- Use branded types for IDs: `type LeadId = string & { __brand: 'LeadId' }`
- Prefer `async/await` over raw Promises
- Use Zod for runtime validation

### Naming

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- State files: `{agent-name}-state.json`

### Critical Pattern: Brain-Scoped Queries

**ALL Qdrant queries MUST be scoped to a brain:**

```typescript
// CORRECT - Always filter by brain_id
const results = await qdrant.search({
  collection: 'icp_rules',
  filter: { brain_id: currentBrain.id },  // REQUIRED
  vector: queryVector,
  limit: 5
});

// WRONG - Will mix data across verticals
const results = await qdrant.search({
  collection: 'icp_rules',
  vector: queryVector,
  limit: 5
});
```

### Context Engineering Rules

Production agent patterns:

1. **Append-only context** - Never modify earlier messages (breaks KV-cache)
2. **No timestamps in system prompts** - Put timestamps at END, not beginning
3. **Sub-agents for data gathering** - Return distilled data only, not raw API responses
4. **Checkpoint at task boundaries** - After each lead scored, not mid-processing
5. **Context budgets** - Lead scorer: 80k, Reply handler: 60k, Meeting prep: 100k

## Testing

### Running Tests

```bash
# Unit tests (fast, no Docker needed)
bun test:unit

# Integration tests (need Docker running)
docker compose up -d qdrant
bun test:integration

# Single file
bun test packages/agents/src/__tests__/lead-scorer.test.ts

# With coverage
bun test --coverage
```

### Test Patterns

```typescript
describe('LeadScorerAgent', () => {
  it('scores leads against ICP rules', async () => {
    const agent = new LeadScorerAgent(testBrainId);
    const results = await agent.run([testLead]);

    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].tier).toMatch(/priority|qualified|nurture|disqualified/);
  });
});
```

## Git Workflow

```bash
# Branch naming
feature/add-scoring-weights
fix/context-budget-tracking
chore/update-dependencies

# Commit messages (conventional commits)
feat(agents): add context compaction to lead scorer
fix(mcp): handle Attio rate limiting gracefully
docs: update context engineering notes
test: add integration tests for reply handler
```

## Security

- API keys in `.env` only - never commit
- Brain data contains competitive intelligence - treat as confidential
- State files contain lead PII - gitignored
- Never log full lead records, only IDs

## Allowed Without Prompt

These operations are safe to run automatically:

- Read any file
- `bun run typecheck`
- `bun run lint`
- `bun test {single file}`
- `bun run format`
- `bun run dev`
- View Docker logs

## Ask First

These require confirmation:

- `bun test` (full suite - can be slow)
- `docker compose up/down`
- `git push`
- Delete any files
- Modify `.env` or credentials
- Run production deployments
- Modify n8n workflows
