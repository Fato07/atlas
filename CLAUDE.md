# CLAUDE.md

> Instructions for Claude Code when working on atlas-gtm

## Project Overview

Atlas GTM is an AI-first GTM Operations System for CodesDevs. It uses swappable "brains" (vertical-specific knowledge bases) to enable rapid market validation with 80% less manual work.

**Tech Stack:**
- Runtime: Bun (not npm/node)
- Agents: TypeScript with @anthropic-ai/sdk
- MCP Servers: Python with FastMCP
- Vector DB: Qdrant
- Caching: Upstash Redis (serverless)
- Workflows: n8n

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
