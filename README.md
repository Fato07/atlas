# Atlas GTM

> AI-first GTM Operations System - Same agents, different brains for rapid market validation.

Atlas GTM enables you to validate new markets with 80% less manual work by using swappable "brains" (vertical-specific knowledge bases) that power AI agents for lead scoring, reply handling, and meeting preparation.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- [Docker](https://docker.com/) (for Qdrant)
- [Python 3.11+](https://python.org/) with [uv](https://github.com/astral-sh/uv)

### 1. Clone and Install

```bash
git clone https://github.com/codesdevs/atlas-gtm.git
cd atlas-gtm

# Install all dependencies
bun run setup
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

Required API keys:
- `ANTHROPIC_API_KEY` - For Claude agents
- `VOYAGE_API_KEY` - For embeddings
- `ATTIO_API_KEY` - For CRM integration
- `INSTANTLY_API_KEY` - For email integration

### 3. Start Infrastructure

```bash
# Start Qdrant (vector database)
docker compose up -d qdrant

# Initialize database collections
bun run db:init
```

### 4. Seed Your First Brain

Create a brain data file (e.g., `data/defense-kb.json`):

```json
{
  "vertical": "defense",
  "description": "Defense & aerospace technology",
  "icp_rules": [
    {
      "name": "Government Contractor",
      "criteria": "Company is a registered government contractor",
      "weight": 5,
      "match_condition": "industry contains 'defense' OR 'aerospace'"
    }
  ],
  "response_templates": [...],
  "objection_handlers": [...],
  "market_research": [...]
}
```

Then seed it:

```bash
bun run seed:brain --vertical=defense --source=./data/defense-kb.json
```

### 5. Start Development

```bash
# Start agents in watch mode
bun run dev:agents

# In another terminal, start MCP servers
bun run mcp:dev
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Atlas GTM                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Lead Scorer │  │   Reply     │  │  Meeting    │         │
│  │   Agent     │  │  Handler    │  │    Prep     │         │
│  │  (80k ctx)  │  │  (60k ctx)  │  │  (100k ctx) │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          │                                  │
│                    ┌─────▼─────┐                            │
│                    │    MCP    │                            │
│                    │  Servers  │                            │
│                    └─────┬─────┘                            │
│         ┌────────────────┼────────────────┐                 │
│         │                │                │                 │
│    ┌────▼────┐    ┌──────▼──────┐   ┌─────▼─────┐          │
│    │ Qdrant  │    │    Attio    │   │ Instantly │          │
│    │  (KB)   │    │   (CRM)     │   │  (Email)  │          │
│    └─────────┘    └─────────────┘   └───────────┘          │
└─────────────────────────────────────────────────────────────┘
```

### Brains

A "brain" is a vertical-specific knowledge base containing:
- **ICP Rules** - Lead scoring criteria
- **Response Templates** - Email templates by intent
- **Objection Handlers** - Prepared responses to objections
- **Market Research** - Industry intelligence

Switch brains to instantly adapt to new markets without retraining.

### Agents

| Agent | Context Budget | Purpose |
|-------|---------------|---------|
| Lead Scorer | 80,000 tokens | Score leads against ICP, assign tiers |
| Reply Handler | 60,000 tokens | Classify email intent, draft responses |
| Meeting Prep | 100,000 tokens | Prepare comprehensive meeting briefings |

### MCP Servers

Python servers using FastMCP that provide tools to agents:

- **Qdrant MCP** - Knowledge base queries (brain-scoped)
- **Attio MCP** - CRM operations
- **Instantly MCP** - Email operations

## Commands Reference

```bash
# Development
bun run dev                # Start all packages
bun run dev:agents         # Start agents only
bun run mcp:dev            # Start MCP servers

# Testing
bun test                   # Run all tests
bun test:unit              # Unit tests only
bun test:integration       # Integration tests

# Database
bun run db:init            # Initialize Qdrant collections
bun run seed:brain         # Seed a brain

# Utilities
bun run debug:context      # Debug agent context usage
bun run typecheck          # TypeScript validation
bun run lint               # ESLint
bun run format             # Prettier

# Docker
docker compose up -d       # Start all services
docker compose down        # Stop all services
docker compose logs -f     # View logs
```

## Project Structure

```
atlas-gtm/
├── packages/
│   ├── lib/               # Shared utilities
│   │   └── src/
│   │       ├── types.ts   # Type definitions
│   │       ├── qdrant.ts  # Qdrant client
│   │       ├── embeddings.ts # Voyage AI
│   │       └── state.ts   # State management
│   └── agents/            # Production agents
│       └── src/
│           ├── base-agent.ts
│           ├── sub-agent.ts
│           ├── lead-scorer.ts
│           ├── reply-handler.ts
│           └── meeting-prep.ts
├── mcp-servers/           # Python MCP servers
│   └── atlas_gtm_mcp/
├── scripts/               # Utility scripts
├── data/                  # Brain data files
└── state/                 # Agent state (gitignored)
```

## Contributing

See [AGENTS.md](./AGENTS.md) for coding conventions and AI agent guidance.

## License

UNLICENSED - Proprietary to CodesDevs
