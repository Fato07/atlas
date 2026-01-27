# GTM Operations System Architecture
## AI-First Go-To-Market System for CodesDevs

---

## System Philosophy

> "The knowledge base is our own playbook - our angle, our glasses with which we evaluate whatever information comes in."

This system implements a **two-layer architecture** where AI agents make decisions by applying strategic context (Knowledge Base) to operational data (Lead Data). The same agents can operate across multiple verticals by "swapping brains" - loading different KB contexts.

**Core Value Proposition**: Validate new markets with 80% less manual work. Test IRO, Defense, Healthcare by swapping brains, running lead generation, and learning from every interaction.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL WORLD                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  Leads        Replies         Meetings       Research        Your Input         │
│  (Clay)      (Instantly)     (Calendar)     (Web/Docs)      (Slack/Chat)        │
└──────┬────────────┬──────────────┬──────────────┬──────────────┬────────────────┘
       │            │              │              │              │
       ▼            ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        ★ SECURITY LAYER (Lakera Guard)                          │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐               │
│  │   Prompt Injection Defense  │  │      PII Detection          │               │
│  │   (Block malicious inputs)  │  │   (Mask before LLM calls)   │               │
│  └─────────────────────────────┘  └─────────────────────────────┘               │
└─────────────────────────────────────┬───────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MCP GATEWAY LAYER                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │Airtable │ │ Attio   │ │Instantly│ │LinkedIn │ │ Slack   │ │ GCal    │        │
│  │  MCP    │ │  MCP    │ │  MCP    │ │Tool MCP │ │  MCP    │ │  MCP    │        │
│  │(Compos.)│ │(Custom) │ │(Custom) │ │(Custom) │ │(Compos.)│ │(Compos.)│        │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘        │
│       └───────────┴───────────┴─────┬─────┴───────────┴───────────┘             │
└─────────────────────────────────────┼───────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼───────────────────────────────────────────┐
│                           ORCHESTRATION LAYER                                    │
│                              (n8n Self-Hosted)                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│   │   WEBHOOK   │    │  SCHEDULED  │    │   SLACK     │    │   MANUAL    │      │
│   │  TRIGGERS   │    │   TRIGGERS  │    │  COMMANDS   │    │  TRIGGERS   │      │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘      │
│          └──────────────────┴────────┬─────────┴──────────────────┘              │
│                           ┌──────────▼──────────┐                               │
│                           │   WORKFLOW ROUTER   │                               │
│                           └──────────┬──────────┘                               │
│          ┌───────────────────────────┼───────────────────────────┐              │
│          ▼                           ▼                           ▼              │
│   ┌─────────────┐           ┌─────────────┐           ┌─────────────┐          │
│   │    LEAD     │           │    REPLY    │           │   MEETING   │          │
│   │  PROCESSOR  │           │   HANDLER   │           │    PREP     │          │
│   │  WORKFLOW   │           │  WORKFLOW   │           │  WORKFLOW   │          │
│   └──────┬──────┘           └──────┬──────┘           └──────┬──────┘          │
└──────────┼─────────────────────────┼─────────────────────────┼──────────────────┘
           └─────────────────────────┼─────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────────────┐
│                       ★ OBSERVABILITY LAYER (Langfuse)                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                 │
│   │  Agent Traces   │  │  LLM Tracking   │  │ Quality Scores  │                 │
│   │  (All calls)    │  │ (Tokens/Costs)  │  │  (Accuracy)     │                 │
│   └─────────────────┘  └─────────────────┘  └─────────────────┘                 │
└─────────────────────────────────────┬───────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼───────────────────────────────────────────┐
│                            INTELLIGENCE LAYER                                    │
│                              (Claude API)                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│   ┌──────────────────────────────────────────────────────────────────────┐      │
│   │                         AI AGENT ENGINE                              │      │
│   │                                                                      │      │
│   │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │      │
│   │   │   LEAD      │  │   REPLY     │  │  MEETING    │  │ LEARNING  │  │      │
│   │   │  SCORER     │  │  HANDLER    │  │   PREP      │  │   AGENT   │  │      │
│   │   │   AGENT     │  │   AGENT     │  │   AGENT     │  │           │  │      │
│   │   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘  │      │
│   │          │                │                │              │         │      │
│   │          └────────────────┴────────┬───────┴──────────────┘         │      │
│   │                                    │                                │      │
│   │                           ┌────────▼────────┐                       │      │
│   │                           │   KB CONTEXT    │                       │      │
│   │                           │    MANAGER      │                       │      │
│   │                           │ (Brain Swapper) │                       │      │
│   │                           └────────┬────────┘                       │      │
│   └────────────────────────────────────┼────────────────────────────────┘      │
└────────────────────────────────────────┼────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────▼────────────────────────────────────────┐
│                           KNOWLEDGE LAYER                                        │
│                         (Qdrant Self-Hosted)                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    ★ EVALUATION LAYER (Ragas)                           │    │
│  │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │    │
│  │   │ Context Precision│  │ Context Recall │  │   Faithfulness  │        │    │
│  │   │     >= 0.80     │  │    >= 0.75     │  │     >= 0.85     │        │    │
│  │   └─────────────────┘  └─────────────────┘  └─────────────────┘        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         BRAIN MANAGER                                   │    │
│  │                                                                         │    │
│  │   Active Brain: IRO_v1              Available Brains:                  │    │
│  │   ├─ icp_rules (47 rules)           ├─ IRO_v1 (active)                 │    │
│  │   ├─ response_templates (52)         ├─ Defense_v1 (ready)             │    │
│  │   ├─ objection_handlers (23)         └─ Healthcare_v1 (seeding)        │    │
│  │   ├─ market_research (156 docs)                                        │    │
│  │   └─ insights (0 → growing)                                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐     │
│  │   BRAINS   │ │ ICP_RULES  │ │ TEMPLATES  │ │ OBJECTIONS │ │  RESEARCH  │     │
│  │ Collection │ │ Collection │ │ Collection │ │ Collection │ │ Collection │     │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘     │
│                                                                                  │
│  ┌────────────┐ ┌────────────┐                                                  │
│  │  INSIGHTS  │ │ VERTICALS  │   ← All collections are graph-ready:            │
│  │ Collection │ │ Collection │     brain_id, parent_vertical, source_id        │
│  └────────────┘ └────────────┘                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────┐          ┌──────────────────────────┐            │
│  │      AIRTABLE            │          │        ATTIO             │            │
│  │    (All Lead Data)       │   ───►   │   (Engaged Leads Only)   │            │
│  │                          │  moves   │                          │            │
│  │  • Raw leads             │  when    │  • Qualified leads       │            │
│  │  • Enrichment data       │ engaged  │  • Pipeline stages       │            │
│  │  • Campaign tracking     │          │  • Deal values           │            │
│  │  • Sequence status       │          │  • Conversation history  │            │
│  │  • Source attribution    │          │  • Tasks & follow-ups    │            │
│  │  • ICP scores            │          │                          │            │
│  └──────────────────────────┘          └──────────────────────────┘            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## The Two-Layer Data Model

### Layer 1: Knowledge Base (Static Brain)

The KB is **your strategic playbook** - not lead data. It's the context through which agents evaluate incoming information.

| Collection | Purpose | Update Frequency |
|------------|---------|------------------|
| `brains` | Top-level container per vertical | Rarely (version changes) |
| `icp_rules` | Lead scoring criteria | Monthly refinement |
| `response_templates` | Pre-written replies by type | Weekly A/B updates |
| `objection_handlers` | How to handle pushback | As new objections emerge |
| `market_research` | Vertical-specific intelligence | Initial seed + refresh |
| `insights` | Learnings from conversations | Continuous (with quality gates) |
| `verticals` | Hierarchy structure | Setup only |

**Key Principle**: This data is stable. Agents query it for context, not raw lead info.

### Layer 2: Lead Data (Dynamic)

Operational data flows through Airtable → Attio as leads progress.

| System | Contains | When Updated |
|--------|----------|--------------|
| **Airtable** | All leads, enrichment, campaign data, ICP scores | Every lead action |
| **Attio** | Engaged leads only, pipeline, conversations | When lead engages |

**Key Principle**: This data is transient. High-volume, constantly changing.

### The Convergence Point

When a lead engages:
1. Agent fetches lead data from Airtable
2. Agent loads brain context from Qdrant KB
3. Agent applies KB rules to lead data → Decision
4. Agent executes action + extracts insights back to KB

```
Lead Data (Dynamic)     Knowledge Base (Static)
       │                        │
       └────────┬───────────────┘
                │
                ▼
         ┌─────────────┐
         │   AGENT     │
         │  DECISION   │
         └──────┬──────┘
                │
    ┌───────────┴───────────┐
    │                       │
    ▼                       ▼
 ACTION                  INSIGHT
(Response, CRM)      (Back to KB)
```

---

## Agent Tiering System

### Tier 1: Auto-Execute (No Approval)
- Lead scoring (score > 70 or < 50)
- Simple positive replies ("Yes, interested")
- FAQ responses (pricing, timeline)
- Meeting confirmations
- CRM status updates
- Pre-call brief generation

### Tier 2: Draft + Quick Approve (Slack, <5 min)
- Borderline leads (ICP score 50-70)
- Common objections (needs slight customization)
- Non-standard pricing questions

### Tier 3: Flag for Human (Full Control)
- Custom pricing negotiation
- Angry/negative replies
- Complex technical questions
- High-value enterprise deals (>$50k)

---

## Context Engineering

> Based on research from [Manus AI](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus), [Anthropic's Agent Harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), and [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview).

### Why This Matters

**KV-cache hit rate is the single most important metric** for our agents. With Claude:
- Cached input: $0.30/MTok
- Uncached input: $3.00/MTok
- **10x cost difference**

For a system processing 500+ leads/month, this is the difference between $10/mo and $100/mo.

### Core Principles

1. **Append-Only Context** - Never modify earlier context (invalidates cache)
2. **Sub-Agent Isolation** - Spawn sub-agents for data gathering, return only distilled results
3. **Progress Files** - Maintain state files for session handoff
4. **Smart Compaction** - Trigger at task boundaries, preserve decisions

### Agent Context Budgets

| Agent | Max Tokens | Compaction Trigger | Priority Preserve |
|-------|------------|--------------------|--------------------|
| Lead Scorer | 80,000 | 60,000 (75%) | Scoring decisions, ICP matches |
| Reply Handler | 60,000 | 42,000 (70%) | Active threads, pending drafts |
| Meeting Prep | 100,000 | 80,000 (80%) | Briefs, attendee context |

### Sub-Agent Pattern

Sub-agents exist to **isolate context**, not to mimic human roles:

```
Master Agent (80k budget)
    │
    ├── CRM Lookup Sub-Agent (20k)
    │   └── Returns: 5-10 key fields per lead
    │
    ├── Email Parser Sub-Agent (20k)
    │   └── Returns: Summary + intent + sentiment
    │
    └── KB Query Sub-Agent (20k)
        └── Returns: Top 3 matches with scores
```

**Spawn a sub-agent when:**
- Operation produces >10KB raw output
- External API returns rich/nested data
- Task is parallelizable and read-only

### Memory Management

| Keep | Summarize | Discard |
|------|-----------|---------|
| ICP rules, scoring criteria | Historical patterns | Raw CRM API responses |
| Active threads, pending drafts | Closed conversations | Full email history after extraction |
| Current batch metadata | Completed work phases | Previous draft iterations |
| Decisions made this session | Research conclusions | Intermediate reasoning |

### Session Handoff

Each agent maintains a state file:

```json
{
  "session_id": "uuid",
  "brain_id": "iro-vertical-v1",
  "batch": {"total": 50, "processed": 32},
  "decisions": [...],
  "learnings": ["Pattern: LinkedIn leads 2x conversion"],
  "resume_from": {"batch_index": 32, "last_completed": "lead_32"}
}
```

See `specs/context-engineering.md` for full implementation details.

---

## Core Agent Specifications

### 1. Lead Scorer Agent

**Purpose**: Evaluate new leads against KB rules, assign tier and messaging angle

**Input**:
```json
{
  "lead_id": "lead_123",
  "name": "John Smith",
  "email": "john@acme.com",
  "company": "Acme Corp",
  "title": "VP of IR",
  "company_size": 150,
  "industry": "fintech",
  "funding_stage": "series_b",
  "tech_stack": ["salesforce", "slack"],
  "source": "clay_fintech_batch_001"
}
```

**Process**:
1. Determine vertical from lead data
2. Load appropriate brain from KB
3. Query ICP rules for this brain
4. Score each attribute against rules
5. Calculate total score + tier
6. Select best messaging angle
7. Write to audit log

**Output**:
```json
{
  "lead_id": "lead_123",
  "score": 82,
  "tier": "priority",
  "angle": "technical_automation",
  "top_signals": [
    {"attribute": "title", "score": 25, "reason": "VP-level IR role"},
    {"attribute": "company_size", "score": 30, "reason": "Sweet spot 50-500"},
    {"attribute": "funding", "score": 15, "reason": "Series B = budget available"}
  ],
  "recommended_sequence": "iro_technical_v2",
  "reasoning": "Strong ICP fit - mid-market fintech with IR leadership. Lead with automation angle given tech stack signals."
}
```

**Decision Flow**:
- Score > 70 → Auto-queue for outbound
- Score 50-70 → Slack notification for review
- Score < 50 → Auto-reject with reason

---

### 2. Reply Handler Agent

**Purpose**: Classify replies, route to appropriate tier, auto-respond or escalate

**Input**:
```json
{
  "reply_id": "reply_456",
  "source": "instantly",
  "lead_id": "lead_123",
  "reply_text": "This sounds interesting but we're not looking to make changes until Q2.",
  "thread_context": ["Email 1: Intro", "Email 2: Value prop"]
}
```

**Classification Output**:
```json
{
  "intent": "objection",
  "objection_type": "timing",
  "sentiment": 0.2,
  "complexity": "medium",
  "urgency": "low",
  "tier": 2,
  "kb_match": {
    "handler_id": "obj_timing_001",
    "confidence": 0.87,
    "template": "I completely understand. Many of our clients..."
  }
}
```

**Routing Logic**:
- Simple + KB match (>85% confidence) → Tier 1 auto-respond
- Medium + KB match (>70% confidence) → Tier 2 draft for approval
- Complex or low confidence → Tier 3 human

---

### 3. Meeting Prep Agent

**Purpose**: Generate pre-call briefs 30 minutes before meetings

**Trigger**: Calendar event starting in 30 minutes

**Data Gathered**:
- Full email thread (Instantly)
- LinkedIn messages (LinkedIn tool)
- Company enrichment (Airtable)
- Past similar deals (Attio)
- Relevant objections/research (KB)

**Brief Output Format**:
```markdown
# CALL BRIEF: Acme Corp
## 30-min Discovery | John Smith, VP IR

### Quick Context
- **Source**: Clay fintech batch → Email outreach
- **First contact**: Jan 5, 2025
- **Their response**: "Interested, let's talk"

### Conversation Summary
1. Email 1 (Jan 5): Opened, no reply
2. Email 2 (Jan 8): Replied "Interesting, tell me more"
3. Your reply (Jan 8): Sent case study
4. Their reply (Jan 9): "Let's schedule a call"

### Company Intel
- **Industry**: Fintech (payments)
- **Size**: 150 employees
- **Funding**: Series B ($25M)
- **Growth signals**: Hiring 3 IR roles

### Likely Discussion Points
- Pain: Manual investor reporting (from similar companies)
- Question: "What's implementation timeline?"
- Objection risk: Budget timing (Q2 planning)

### Suggested Questions
1. "What's driving the need to improve IR operations now?"
2. "How are you currently handling quarterly reports?"
3. "Who else would be involved in evaluating a solution?"

### Similar Won Deal
- **Fintech Co X** - Closed $45k, 3-week cycle
- **What worked**: Led with time savings, CFO champion

---
📞 [Join Call Link] | 📋 [Full Attio Record]
```

---

### 4. Learning Agent

**Purpose**: Extract insights from conversations, add to KB with quality gates

**Trigger**: After meeting analysis OR flagged high-value reply

**Quality Gates**:
1. Confidence score > 0.7
2. Not duplicate of existing insight
3. Source credibility check (not "lead may tell bullshit")
4. Human validation for high-impact insights

**Insight Categories**:
- `buying_process` - How they make decisions
- `pain_point` - What problems they have
- `objection` - New objection patterns
- `competitive_intel` - Competitor mentions
- `messaging_effectiveness` - What resonated
- `icp_signal` - Qualification signals

---

## MCP Integration Topology

> **Decision**: Custom MCP servers over Composio - see [ADR-002](docs/adr/002-composio-mcp-decision.md)

```
CUSTOM BUILD (Your VPS - Python FastMCP):
├─ qdrant-mcp ────── Knowledge Base queries
├─ attio-mcp ─────── CRM operations
├─ instantly-mcp ─── Email campaign data
├─ slack-mcp ─────── Notifications, approvals (custom + direct SDK for modals)
└─ linkedin-mcp ──── LinkedIn automation (Aimfox)

n8n INTEGRATIONS (via n8n nodes, not MCP):
├─ Airtable ──────── Lead database CRUD
├─ Google Calendar ─ Meeting triggers
└─ Gmail ─────────── Email context (if needed)

n8n AS MCP SERVER:
└─ Expose complex workflows as MCP tools
   (e.g., "score_and_enrich_lead" as single tool call)
```

---

## Infrastructure Deployment

### Single VPS Setup (~$50/month, 4 vCPU, 8GB RAM)

```yaml
# docker-compose.yml structure

services:
  n8n:
    image: n8nio/n8n
    ports: ["5678:5678"]
    volumes: ["./n8n-data:/home/node/.n8n"]
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true

  qdrant:
    image: qdrant/qdrant
    ports: ["6333:6333"]
    volumes: ["./qdrant-data:/qdrant/storage"]

  postgres:
    image: postgres:15
    volumes: ["./postgres-data:/var/lib/postgresql/data"]
    environment:
      - POSTGRES_DB=n8n

  mcp-servers:
    build: ./mcp-servers
    ports: ["8080:8080"]
    environment:
      - ATTIO_API_KEY=${ATTIO_API_KEY}
      - INSTANTLY_API_KEY=${INSTANTLY_API_KEY}
      - QDRANT_URL=http://qdrant:6333
      - UPSTASH_REDIS_URL=${UPSTASH_REDIS_URL}
      - UPSTASH_REDIS_TOKEN=${UPSTASH_REDIS_TOKEN}

  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes: ["./nginx.conf:/etc/nginx/nginx.conf"]

# Note: Redis removed - using Upstash serverless Redis instead
# Benefits: Pay-per-request (~$0-5/mo at our scale), no maintenance, 99.99% SLA
```

### External Services

| Service | Purpose | Est. Cost |
|---------|---------|-----------|
| Claude API | Reasoning, generation | $30-50/mo |
| Voyage AI | Embeddings | ~$5/mo |
| **Upstash Redis** | State caching, rate limiting, queues | ~$0-5/mo |
| Composio | Managed MCPs | Free/$20 |
| Airtable | Lead database | Free/$20 |
| Attio | CRM | $29/user |
| Instantly | Email outbound | $37-97 |
| LinkedIn tool | LinkedIn outbound | $50-100 |

**Total: ~$250-400/month**

### Why Upstash over Self-Hosted Redis

- **Pay-per-request** - Our workload is bursty (lead batches), not constant
- **Zero maintenance** - One less service to manage alongside Qdrant, n8n, MCP servers
- **Latency is fine** - 10-20ms regional latency is acceptable for state/queues
- **Free tier covers us** - 10k requests/day free, we're well under that

---

## Data Flow Diagrams

### Flow 1: Lead Scoring

```
Clay Export (CSV)
       │
       ▼
┌─────────────────────────┐
│ n8n: CSV Import Workflow │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────────────────────────────┐
│ n8n: Lead Scorer Workflow                        │
│                                                  │
│ 1. Parse lead data                               │
│ 2. Infer vertical → Load brain                   │
│ 3. Query Qdrant: ICP rules for brain            │
│ 4. Call Claude: Score against rules             │
│ 5. Determine tier (1/2/3)                       │
│ 6. Update Airtable: score, tier, angle          │
│ 7. If Tier 1: Queue for outbound                │
│ 8. If Tier 2: Slack notification                │
└───────────┬─────────────────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│ Airtable (scored leads)  │
└─────────────────────────┘
```

### Flow 2: Reply Handling

```
Instantly Webhook: "Reply received"
       │
       ▼
┌────────────────────────────────────────────────────────────┐
│ n8n: Reply Handler Workflow                                 │
│                                                             │
│ 1. Receive webhook payload                                  │
│ 2. Fetch full thread (Instantly MCP)                       │
│ 3. Fetch lead data (Airtable MCP)                          │
│ 4. Load brain for lead's vertical                          │
│                                                             │
│ 5. Claude: Classify reply                                   │
│    ├─ Intent: positive | objection | question | referral   │
│    ├─ Sentiment: -1 to 1                                    │
│    ├─ Complexity: simple | medium | complex                 │
│    └─ Urgency: low | medium | high                          │
│                                                             │
│ 6. Query KB: Find matching template/handler                 │
│                                                             │
│ 7. Route by tier:                                           │
│    ├─ Tier 1: Generate → Send → Update CRM                 │
│    ├─ Tier 2: Generate draft → Slack approval              │
│    └─ Tier 3: Notify → Human handles                       │
│                                                             │
│ 8. Update Airtable status                                   │
│ 9. Create/update Attio record                               │
│ 10. Extract insights → Quality gate → Add to KB            │
└─────────────────────────────────────────────────────────────┘
```

### Flow 3: Weekly Learning Loop

```
Monday 9am (Scheduled)
       │
       ▼
┌────────────────────────────────────────────────────────────┐
│ n8n: Weekly Synthesis Workflow                              │
│                                                             │
│ 1. Query Attio: All activities this week                   │
│ 2. Query Airtable: Campaign performance                    │
│ 3. Query KB: New insights added                            │
│                                                             │
│ 4. Claude: Generate weekly report                          │
│    ├─ Top 3 objections + frequencies                       │
│    ├─ Best performing messaging angles                     │
│    ├─ ICP signals observed                                 │
│    ├─ Pipeline movement                                    │
│    └─ Recommendations for next week                        │
│                                                             │
│ 5. Update KB: Boost successful templates                   │
│ 6. Flag: Underperforming rules for review                  │
│ 7. Send report to Slack                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Brain Swapping Mechanism

The same agents work across verticals by loading different "brains":

```python
def get_active_brain(vertical: str = None) -> Brain:
    """
    Get the appropriate brain for the current context.
    If vertical specified, get that brain.
    Otherwise, get the default active brain.
    """
    if vertical:
        brain = qdrant.scroll(
            collection="brains",
            filter={"vertical": vertical, "status": "active"},
            limit=1
        )[0]
    else:
        brain = qdrant.scroll(
            collection="brains",
            filter={"status": "active"},
            order_by="updated_at",
            limit=1
        )[0]

    return brain

def query_with_brain(query: str, brain_id: str, collection: str) -> list:
    """Query any KB collection scoped to a specific brain."""
    query_vector = voyage_embed(query)

    results = qdrant.search(
        collection=collection,
        query_vector=query_vector,
        filter={"brain_id": brain_id},
        limit=5
    )

    return results
```

**Usage**:
```python
# Lead comes in from IRO campaign
lead = get_lead(lead_id)
brain = get_active_brain(vertical="iro")

# All KB queries scoped to IRO brain
icp_rules = query_with_brain(
    query="scoring rules for VP-level IR role at fintech",
    brain_id=brain.id,
    collection="icp_rules"
)
```

**Multi-vertical testing flow**:
1. Seed IRO brain → Run 5,000 leads → Analyze weekly
2. Seed Defense brain → Run 5,000 leads → Analyze weekly
3. Compare performance → Double down on winner

---

## Success Metrics

### Week 1
- [ ] Qdrant running with IRO brain seeded
- [ ] Can query KB and get relevant results
- [ ] Composio connected (Airtable, Slack)
- [ ] n8n deployed with test workflow
- [ ] Simple "query KB" flow working E2E

### Week 3
- [ ] Lead Scorer agent working (>90% accuracy)
- [ ] Reply Handler classifying correctly
- [ ] Slack approval flow functional
- [ ] 100% of replies captured, 70% auto-handled

### Week 5
- [ ] Meeting Prep agent generating briefs
- [ ] Learning agent extracting insights
- [ ] KB growing with validated insights
- [ ] Weekly report generating

### Week 8
- [ ] Full pipeline running autonomously
- [ ] 80% of work AI-handled
- [ ] Dashboard showing metrics
- [ ] Ready to test second vertical

### Observability Metrics (Langfuse)
- [ ] 100% agent traces captured
- [ ] Token usage tracked per agent
- [ ] Quality scores for all outputs
- [ ] Cost tracking per vertical

### Evaluation Metrics (Ragas)
- [ ] Context Precision >= 0.80
- [ ] Context Recall >= 0.75
- [ ] CI/CD quality gates passing
- [ ] Golden datasets for all collections

### Security Metrics (Lakera Guard)
- [ ] 100% prompt injection detection
- [ ] 100% PII masking before LLM
- [ ] Security audit trail complete
- [ ] <50ms security screening latency

---

## Operational Layers

The system includes three critical operational layers for production reliability:

### Security Layer (Lakera Guard)

| Capability | Purpose | Behavior |
|------------|---------|----------|
| Prompt Injection Defense | Detect manipulation attempts | Block malicious inputs |
| PII Detection | Identify sensitive data | Mask before LLM calls |
| Content Moderation | Flag inappropriate content | Warn and log |
| Malicious Links | Detect suspicious URLs | Block and alert |

**Integration Point**: All inputs are screened before reaching the Intelligence Layer.

**Agent Coverage** (all 4 agents implemented):

| Agent | Webhook Screening | LLM Call Screening |
|-------|-------------------|-------------------|
| Lead Scorer | `/webhook/score-lead` | Angle generation calls |
| Reply Handler | `/webhook/handle-reply` (Instantly, HeyReach webhooks) | Classification, response generation |
| Meeting Prep | `/webhook/meeting-prep/brief`, `/analyze` | Brief generation, transcript analysis |
| Learning Loop | `/webhook/learning-loop/extract`, `/validate` | Insight extraction calls |

**Configuration**:
```bash
LAKERA_GUARD_API_KEY=your-api-key    # Required to enable
LAKERA_PROJECT_ID=atlas-gtm          # Optional
```

**Graceful Degradation**: When `LAKERA_GUARD_API_KEY` is not set, agents operate normally without security screening. When API errors occur, requests are allowed with warning logged (fail-open).

### Observability Layer (Langfuse)

| Capability | Purpose | Metrics |
|------------|---------|---------|
| Agent Traces | Track all operations | Latency, success rate |
| LLM Tracking | Monitor Claude API usage | Tokens, costs, latency |
| Quality Scores | Evaluate output quality | Accuracy, tier correctness |
| Session Tracking | Group related operations | Brain context, vertical |

**Integration Point**: Wraps all agent operations and LLM calls.

**Agent Coverage** (all 4 agents implemented):

| Agent | Trace Name | Key Scores |
|-------|------------|------------|
| Lead Scorer | `lead_scorer` | `lead_scoring_accuracy`, `tier_correctness`, `vertical_confidence` |
| Reply Handler | `reply_handler` | `classification_accuracy`, `response_relevance`, `category_confidence` |
| Meeting Prep | `meeting_prep` | `brief_quality`, `bant_confidence`, `context_completeness` |
| Learning Loop | `learning_loop` | `insight_quality`, `insight_validation_rate`, `kb_write_success_rate` |

**Configuration**:
```bash
LANGFUSE_PUBLIC_KEY=pk-xxx           # Required to enable
LANGFUSE_SECRET_KEY=sk-xxx           # Required to enable
LANGFUSE_HOST=https://cloud.langfuse.com  # Default
```

**Graceful Degradation**: When Langfuse keys are not set, tracing functions return `null` and agents operate normally. All agents register SIGTERM handlers to flush traces before shutdown.

### Evaluation Layer (Ragas)

| Metric | Purpose | Threshold |
|--------|---------|-----------|
| Context Precision | Are retrieved results relevant? | >= 0.80 |
| Context Recall | Are all relevant docs retrieved? | >= 0.75 |
| Context Relevance | How relevant is context to question? | >= 0.80 |
| Faithfulness | Is response faithful to retrieved context? | >= 0.85 |

**Integration Point**: Evaluates Qdrant retrieval quality via CI/CD pipeline.

---

## Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Knowledge Base | Qdrant | 4x faster than Weaviate, great metadata filtering, self-hosted |
| Embeddings | Voyage AI voyage-3.5-lite | Best accuracy-to-cost ($0.02/1M), RAG-optimized |
| Orchestration | n8n (self-hosted) | Visual workflows, MCP-compatible, low cost |
| LLM | Claude API | Best reasoning, tool use, long context |
| Graph DB | Not now (graph-ready) | Start simple, add Neo4j if needed in Phase 2 |
| Managed MCPs | Composio | Pre-built Airtable/Slack, auth handled |
| Custom MCPs | Python (FastMCP) | Attio, Instantly, Qdrant, LinkedIn |
| **Observability** | **Langfuse** | LLM-native tracing, quality scoring, free tier sufficient |
| **RAG Evaluation** | **Ragas** | Industry standard metrics, Langfuse integration |
| **Security** | **Lakera Guard** | Prompt injection + PII detection, low latency |

---