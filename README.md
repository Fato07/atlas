# Atlas

> AI-first GTM Operations System - Same agents, different brains for rapid market validation.

Atlas enables you to validate new markets with 80% less manual work by using swappable "brains" (vertical-specific knowledge bases) that power AI agents for lead scoring, reply handling, and meeting preparation.

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
- `HEYREACH_API_KEY` - For LinkedIn automation
- `SLACK_BOT_TOKEN` - For notifications
- `UPSTASH_REDIS_REST_URL` - For caching
- `UPSTASH_REDIS_REST_TOKEN` - For caching

### 3. Start Infrastructure

```bash
# Start Qdrant (vector database)
docker-compose up -d qdrant

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
┌─────────────────────────────────────────────────────────────────┐
│                          Atlas                                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐       │
│  │   Lead    │ │   Reply   │ │  Meeting  │ │ Learning  │       │
│  │  Scorer   │ │  Handler  │ │   Prep    │ │   Loop    │       │
│  │  (80k)    │ │  (60k)    │ │  (100k)   │ │  (40k)    │       │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘       │
│        └─────────────┼───────────────┼───────────┘             │
│                      │               │                          │
│                ┌─────▼───────────────▼─────┐                   │
│                │       MCP Servers         │                   │
│                └─────┬───────────────┬─────┘                   │
│     ┌────────────────┼───────────────┼────────────────┐        │
│     │                │               │                │        │
│ ┌───▼───┐      ┌─────▼─────┐   ┌─────▼─────┐   ┌──────▼──────┐ │
│ │Qdrant │      │   Attio   │   │ Instantly │   │  HeyReach   │ │
│ │  (KB) │      │   (CRM)   │   │ (Email)   │   │ (LinkedIn)  │ │
│ └───────┘      └───────────┘   └───────────┘   └─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```
  How Atlas GTM Slack Integration Works

  ┌─────────────────────────────────────────────────────────────────────┐
  │                      YOUR SLACK WORKSPACE                           │
  │                                                                     │
  │  ┌──────────────┐     ┌───────────────┐     ┌──────────────────┐   │
  │  │ #gtm-approvals│     │ #gtm-escalations│    │ #gtm-briefs     │   │
  │  └──────────────┘     └───────────────┘     └──────────────────┘   │
  │           ↑                   ↑                      ↑              │
  │           │                   │                      │              │
  │           └───────────────────┼──────────────────────┘              │
  │                               │                                     │
  │                    ┌──────────┴──────────┐                         │
  │                    │  YOUR SLACK BOT     │  ← You create this      │
  │                    │  (e.g., "GTM Ops")  │                         │
  │                    │  xoxb-xxx token     │                         │
  │                    └─────────────────────┘                         │
  └─────────────────────────────────────────────────────────────────────┘
                                 ↑
                                 │ SLACK_BOT_TOKEN in .env
                                 │
  ┌──────────────────────────────┴──────────────────────────────────────┐
  │                     ATLAS GTM SYSTEM (Your Server)                  │
  │                                                                     │
  │   ┌─────────────┐    ┌───────────────┐    ┌────────────────┐       │
  │   │Reply Handler│    │ Meeting Prep  │    │ Learning Loop  │       │
  │   │   Agent     │    │    Agent      │    │    Agent       │       │
  │   └─────────────┘    └───────────────┘    └────────────────┘       │
  └─────────────────────────────────────────────────────────────────────┘
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
| Lead Scorer | 80,000 tokens | Score leads against ICP, assign tiers, recommend messaging angles |
| Reply Handler | 60,000 tokens | Classify reply intent (A/B/C), execute category workflows, stop campaigns |
| Meeting Prep | 100,000 tokens | Pre-call briefs, post-call transcript analysis, BANT scoring |
| Learning Loop | 40,000 tokens | Extract insights, quality gates, Slack validation, KB learning |

### MCP Servers

Python servers using FastMCP that provide tools to agents:

- **Qdrant MCP** - Knowledge base queries (brain-scoped)
- **Attio MCP** - CRM operations (pipeline, records, notes)
- **Instantly MCP** - Email operations (38 tools, v2 API: campaigns, leads, emails, analytics)
- **HeyReach MCP** - LinkedIn automation (35 tools: campaigns, inbox, lists, leads, stats)

## Key Features

### GTM Ops Workflows (Reply Handler)

The Reply Handler implements a complete A/B/C classification workflow:

- **Category A (Interested)**: Create Attio CRM record, send calendar link via Instantly, add to HeyReach LinkedIn campaign
- **Category B (Not Interested)**: Stop Instantly/HeyReach campaigns, process DNC requests, update lead status
- **Category C (Manual Review)**: Slack notification with full lead context, pattern storage to KB for learning

All classifications use a 0.70 confidence threshold with fallback to manual review.

### Multi-Vertical Brain Swapping

- Switch market contexts instantly without retraining agents
- Data-driven vertical registry with auto-classification
- Brain-scoped queries ensure complete data isolation between verticals
- Support for defense, fintech, healthtech, and custom verticals

### Learning Loop

Automated knowledge capture from conversations:

- Insight extraction from email replies and call transcripts
- Quality gates (confidence, duplicate detection, importance scoring)
- Slack-based human validation queue for review
- KB write with provenance tracking
- Weekly synthesis reports with template A/B performance tracking

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
docker-compose up -d       # Start all services
docker-compose down        # Stop all services
docker-compose logs -f     # View logs
```

## Project Structure

```
atlas-gtm/
├── packages/
│   ├── lib/                    # Shared utilities
│   │   └── src/
│   │       ├── types.ts        # Branded types, Zod schemas
│   │       ├── qdrant.ts       # Qdrant client wrapper
│   │       ├── embeddings.ts   # Voyage AI
│   │       └── state.ts        # State management
│   └── agents/                 # Production agents
│       └── src/
│           ├── lead-scorer/    # Lead scoring (80k budget)
│           ├── reply-handler/  # Reply handling (60k budget)
│           │   ├── contracts/  # Zod schemas
│           │   ├── classifier.ts
│           │   ├── category-a.ts
│           │   ├── category-b.ts
│           │   └── category-c.ts
│           ├── meeting-prep/   # Meeting preparation (100k budget)
│           │   ├── contracts/
│           │   └── sub-agents/
│           └── learning-loop/  # Knowledge learning (40k budget)
│               ├── contracts/
│               └── quality-gates.ts
├── mcp-servers/                # Python MCP servers
│   └── atlas_gtm_mcp/
│       ├── qdrant/             # KB tools
│       ├── attio/              # CRM tools
│       ├── instantly/          # Email (38 tools)
│       └── heyreach/           # LinkedIn (35 tools)
├── workflows/n8n/              # n8n workflow files
├── scripts/                    # Utility scripts
├── data/                       # Brain data files
└── state/                      # Agent state (gitignored)
```

## Contributing

See [AGENTS.md](./AGENTS.md) for coding conventions and AI agent guidance.

## License

UNLICENSED - Proprietary to CodesDevs
