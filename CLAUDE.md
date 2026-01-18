# CLAUDE.md

> Instructions for Claude Code when working on atlas-gtm

> **Important**: Also read `AGENTS.md` - it follows the [AGENTS.md open standard](https://agents.md/) and contains build commands, test commands, and code conventions.

## Project Overview

Atlas GTM is an AI-first GTM Operations System for CodesDevs. It uses swappable "brains" (vertical-specific knowledge bases) to enable rapid market validation with 80% less manual work.

**Key Architecture Concept**: Same agents, different "brains" (KB contexts) for rapid multi-vertical market validation.

## Core Principles

### 1. Spec-Driven Development
- Every component has a spec in `/specs/`
- Read the spec BEFORE implementing
- Specs are contracts - follow them precisely
- Update specs if requirements change (discuss first)

### 2. Tech Stack
- Runtime: Bun (not npm/node)
- Agents: TypeScript with @anthropic-ai/sdk
- MCP Servers: Python with FastMCP
- Vector DB: Qdrant
- Caching: Upstash Redis (serverless)
- Workflows: n8n

### 3. Documentation Lookup (Context7 MCP)

**ALWAYS use Context7 MCP** to fetch up-to-date documentation when implementing features for these stacks:

| Library | Context7 ID | Use For |
|---------|-------------|---------|
| Qdrant (docs) | `/websites/qdrant_tech` | Collection creation, vector search, filtering, payload indexes |
| Qdrant (JS client) | `/qdrant/qdrant-js` | TypeScript/JavaScript client API |
| Upstash Redis | `/upstash/redis-js` | Caching patterns, serverless Redis REST API |
| Voyage AI | `/websites/voyageai` | Embedding API, input types, rate limits |
| n8n | `/n8n-io/n8n-docs` | Workflow nodes, webhook configuration |
| FastMCP | `/websites/gofastmcp` | MCP server patterns, tool decorators, deployment |
| Bun | `/oven-sh/bun` | Runtime APIs, test runner, package management |

**Workflow**:
1. Before implementing: `resolve-library-id` → `get-library-docs` with specific query
2. Extract relevant patterns and code examples
3. Apply with proper error handling and project conventions

Don't rely on stale knowledge - always pull fresh docs for API specifics, especially for:
- Qdrant collection schemas and index configuration
- Upstash Redis REST API patterns
- Voyage AI embedding parameters and limits

## Quick Commands

```bash
# Setup
bun install && cd mcp-servers && uv sync

# Development
bun run dev                    # Start all packages in watch mode
bun run dev:agents             # Start agents only
bun run mcp:dev                # Start MCP servers (Python)

# Testing
bun test                       # All tests
bun test packages/agents       # Agent tests only

# Type checking
bun run typecheck              # All packages
```

## Critical Rules

### 1. Brain-Scoped Queries (ALWAYS)

Every Qdrant query MUST include brain_id filter:

```typescript
// ✅ CORRECT
const results = await qdrant.search({
  collection: 'icp_rules',
  filter: { brain_id: currentBrain.id },
  vector: queryVector,
});

// ❌ WRONG - will mix data across verticals
const results = await qdrant.search({
  collection: 'icp_rules',
  vector: queryVector,
});
```

### 2. Context Engineering

Before implementing any agent, read `specs/context-engineering.md`. Key principles:

1. **KV-Cache Optimization** - 10x cost difference between cached/uncached tokens
2. **Append-Only Context** - Never modify earlier context
3. **Sub-Agent Isolation** - Spawn sub-agents for data gathering, return distilled results only
4. **Context Budgets** - Lead Scorer: 80k, Reply Handler: 60k, Meeting Prep: 100k tokens
5. **Session Handoff** - Maintain state files for long-running tasks

See research sources:
- [Manus AI Context Engineering](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [Anthropic Agent Harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

Production agents follow strict patterns for KV-cache optimization:

- **Append-only context**: Never modify earlier messages
- **Timestamps at END**: Put `<timestamp>` after all static content
- **Sub-agents for data**: External API calls go through sub-agents
- **Checkpoint at task boundaries**: Save state after each item, not mid-processing

Context budgets:
- Lead Scorer: 80,000 tokens
- Reply Handler: 60,000 tokens
- Meeting Prep: 100,000 tokens

### 3. State Files

Agents persist state to `state/{agent}-state.json`:

```typescript
// Load/resume state
const state = await loadState('lead_scorer');

// Save checkpoint (call at task boundaries)
await saveState('lead_scorer', checkpoint(state));
```

State files contain PII - they're gitignored.

### 4. File Naming

- TypeScript: `kebab-case.ts`
- State files: `{agent-name}-state.json`
- Brain files: `brain_{vertical}_{timestamp}`

## Architecture

```
packages/
├── lib/                    # Shared utilities
│   └── src/
│       ├── types.ts        # Branded types, schemas
│       ├── qdrant.ts       # Qdrant client
│       ├── embeddings.ts   # Voyage AI wrapper
│       └── state.ts        # State management
├── agents/                 # Production agents
│   └── src/
│       ├── base-agent.ts   # Base class with context tracking
│       ├── sub-agent.ts    # Sub-agent spawning
│       ├── lead-scorer.ts  # Lead scoring agent
│       ├── reply-handler.ts # Reply handling agent
│       └── meeting-prep.ts # Meeting prep agent
mcp-servers/               # Python MCP servers
└── atlas_gtm_mcp/
    ├── qdrant/            # KB tools
    ├── attio/             # CRM tools
    └── instantly/         # Email tools
```

## MCP Server Development

MCP servers are Python (FastMCP). When adding tools:

```python
from fastmcp import FastMCP

mcp = FastMCP("atlas-gtm")

@mcp.tool()
async def my_tool(param: str) -> dict:
    """Tool description for Claude."""
    return {"result": "value"}
```

Test MCP servers: `bun run mcp:test`

## Common Tasks

### Add a New Agent

1. Create `packages/agents/src/{name}.ts`
2. Extend `BaseAgent`
3. Set context budget in constructor
4. Export from `packages/agents/src/index.ts`
5. Add state file pattern to context budget map

### Add MCP Tool

1. Add to appropriate module in `mcp-servers/atlas_gtm_mcp/`
2. Use `@mcp.tool()` decorator
3. Add Pydantic types for input validation
4. Test with `bun run mcp:test`

### Seed a New Brain

```bash
bun run seed:brain --vertical=fintech --source=./data/fintech-kb.json
```

## What NOT to Do

- Don't use `npm` - use `bun`
- Don't query Qdrant without brain_id filter
- Don't put timestamps at start of system prompts
- Don't return raw API responses from sub-agents
- Don't commit `.env` or state files

## Active Technologies
- TypeScript 5.4+ (Bun runtime), Python 3.11+ (MCP servers) + @qdrant/js-client-rest, voyageai (Python), Docker Compose v2 (001-gtm-infra)
- Qdrant (vector DB), PostgreSQL (n8n metadata), Docker volumes (001-gtm-infra)
- Python 3.11+ + FastMCP ≥0.4.0, qdrant-client ≥1.9.0, voyageai ≥0.2.0, tenacity, pydantic ≥2.7.0, structlog (for JSON logging) (002-qdrant-mcp)
- Qdrant (vector DB at localhost:6333) - 7 collections: brains, icp_rules, response_templates, objection_handlers, market_research, insights, verticals (002-qdrant-mcp)
- Python 3.11+ (MCP servers), TypeScript 5.4+ (seeding script - refactor target) + FastMCP ≥0.4.0, qdrant-client ≥1.9.0, voyageai ≥0.2.0, pydantic ≥2.7.0, tenacity, structlog (003-brain-lifecycle)
- Qdrant (vector DB at localhost:6333) - existing collections: brains, icp_rules, response_templates, objection_handlers, market_research (003-brain-lifecycle)

## Recent Changes
- 001-gtm-infra: Added TypeScript 5.4+ (Bun runtime), Python 3.11+ (MCP servers) + @qdrant/js-client-rest, voyageai (Python), Docker Compose v2
