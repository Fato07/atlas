# AGENTS.md

> Following the [AGENTS.md open standard](https://agents.md/) - a vendor-neutral format for guiding AI coding agents. Supported by Google, OpenAI, Sourcegraph, Cursor, and others.

## Project Overview

Atlas GTM - AI-first GTM Operations System for CodesDevs. Same agents, different brains for rapid market validation across verticals (defense, healthcare, fintech, etc.).

Atlas GTM is a go-to-market automation platform using Claude, Qdrant, n8n, and custom MCP servers. Validates new markets with 80% less manual work through AI automation.

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
docker-compose up -d

# View logs
docker-compose logs -f qdrant  # Specific service
docker-compose logs -f         # All services

# Stop services
docker-compose down
```

## Architecture

### Three-System Architecture

| System | Role | Analogy |
|--------|------|---------|
| **KB (Qdrant)** | System-level intelligence | **"Brain"** - ICP definitions, objection patterns, response templates |
| **Airtable** | Lead data hub | **"Hands"** - Per-lead scoring, enrichment, status, routing |
| **Attio CRM** | Pipeline visibility | **"Eyes"** - Engaged leads only (Category A) |

**KB is NOT for lead-level operations** (scoring, enrichment, routing). It's for system-level intelligence that agents query for context.

### Directory Structure

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
│           ├── lead-scorer/     # Lead scoring agent (80k budget)
│           ├── reply-handler/   # Reply handling agent (60k budget)
│           │   ├── contracts/   # Zod schemas: reply-input, classification, workflows
│           │   ├── classifier.ts      # A/B/C category classification
│           │   ├── category-a.ts      # Interested lead workflow
│           │   ├── category-b.ts      # Not interested workflow
│           │   ├── category-c.ts      # Manual review workflow
│           │   ├── state.ts           # Session state management
│           │   ├── logger.ts          # Structured JSON logging (FR-029)
│           │   └── webhook.ts         # HTTP endpoints
│           ├── meeting-prep/    # Meeting prep agent (100k budget)
│           └── learning-loop/   # Learning loop agent (40k budget)
├── mcp-servers/                # Python MCP servers
│   └── atlas_gtm_mcp/
│       ├── qdrant/             # Knowledge base tools
│       ├── attio/              # CRM tools
│       ├── instantly/          # Email outreach tools (38 tools, v2 API)
│       └── heyreach/           # LinkedIn automation tools (35 tools)
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
docker-compose up -d qdrant
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


## Key Specs

Read these before working on specific components:

| Component | Spec File | Priority |
|-----------|-----------|----------|
| Context Engineering | `specs/context-engineering.md` | **Read First** |
| Knowledge Base | `specs/knowledge-base.md` | High |
| Lead Scorer Agent | `specs/agent-lead-scorer.md` | High |
| Reply Handler Agent | `specs/agent-reply-handler.md` | High |
| Meeting Prep Agent | `specs/agent-meeting-prep.md` | Medium |
| MCP Servers | `specs/mcp-servers.md` | High |
| Brain Swapping | `specs/brain-swapping.md` | Medium |
| Frontend UI | `specs/frontend-ui.md` | Low (Phase 2) |

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
- `docker-compose up/down`
- `git push`
- Delete any files
- Modify `.env` or credentials
- Run production deployments
- Modify n8n workflows

## Active Technologies

**Core Stack**:
- TypeScript 5.4+ (Bun runtime) for agents
- Python 3.11+ for MCP servers
- n8n for workflow orchestration

**Agent Dependencies**: @anthropic-ai/sdk, @qdrant/js-client-rest, @slack/web-api, Zod

**MCP Dependencies**: FastMCP ≥0.4.0, httpx, tenacity, pydantic ≥2.7.0, structlog

**Data Stores**:
- Qdrant (vector collections: brains, icp_rules, response_templates, objection_handlers, market_research, insights, bucket_c_patterns)
- Airtable (lead database with scoring columns)
- Attio CRM (engaged leads pipeline)
- Upstash Redis (caching)

## Recent Changes

- **015-gtm-ops-workflows**: GTM Operations Workflows for Reply Handler agent
  - A/B/C category classification system with 0.70 confidence threshold
  - Category A (Interested): Attio CRM record creation, calendar link sending, LinkedIn campaign addition
  - Category B (Not Interested): Instantly/HeyReach campaign stopping via MCP tools, DNC processing
  - Category C (Manual Review): Slack notification with lead context, pattern storage to KB
  - 6 n8n workflows: reply-classification, category-a/b/c handlers, learning-loop, meeting-prep
  - Structured JSON logging (FR-029): reply_received, reply_classified, channels_stopped, workflow_complete, workflow_failed events
  - State management with Zod-validated checkpointing
  - 232 tests passing
