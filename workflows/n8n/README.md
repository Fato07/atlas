# n8n Workflows

This directory contains n8n workflow JSON files for the Atlas GTM system.

## Workflow Registry

| Workflow | Purpose | Trigger | Agent |
|----------|---------|---------|-------|
| `learning-loop-daily.json` | Daily insight extraction | Cron (6 AM UTC) / Webhook | Learning Loop (4004) |
| `learning-loop-weekly.json` | Weekly synthesis reports | Cron (Mon 8 AM UTC) / Webhook | Learning Loop (4004) |
| `meeting-prep-brief.json` | Pre-call brief generation | Calendar poll (5 min) / Webhook | Meeting Prep (4003) |
| `meeting-prep-analysis.json` | Post-call transcript analysis | Fireflies webhook | Meeting Prep (4003) |
| `reply-handler-instantly.json` | Email reply processing | Instantly webhook | Reply Handler (4002) |
| `reply-handler-linkedin.json` | LinkedIn reply processing | HeyReach webhook | Reply Handler (4002) |
| `lead-scorer-workflow.json` | Lead scoring workflow | n8n internal | Lead Scorer (4001) |
| `classification-workflow.json` | Lead classification | n8n internal | Reply Handler (4002) |
| `category-a-workflow.json` | Interested leads routing | n8n internal | - |
| `category-b-workflow.json` | Not interested routing | n8n internal | - |
| `category-c-workflow.json` | Manual review routing | n8n internal | - |

## Environment Variables

### Required for All Workflows

```bash
WEBHOOK_SECRET=your-32-character-webhook-secret
```

### Agent URLs (with defaults)

```bash
LEAD_SCORER_URL=http://localhost:4001
REPLY_HANDLER_URL=http://localhost:4002
MEETING_PREP_URL=http://localhost:4003
LEARNING_LOOP_URL=http://localhost:4004
```

### Slack Channels

```bash
SLACK_BOT_TOKEN=xoxb-xxx
SLACK_REVIEW_CHANNEL=#lead-reviews
SLACK_ALERTS_CHANNEL=#gtm-alerts
SLACK_BRIEFS_CHANNEL=#sales-briefs
SLACK_REPORTS_CHANNEL=#gtm-reports
SLACK_INTERESTED_LEADS_CHANNEL=#interested-leads
SLACK_DNC_CHANNEL=#dnc-list
SLACK_MANUAL_REVIEW_CHANNEL=#manual-review
SLACK_QUALIFIED_CHANNEL=#qualified-leads
SLACK_PIPELINE_CHANNEL=#sales-pipeline
SLACK_NURTURE_CHANNEL=#nurture-queue
```

### Platform-Specific Secrets

```bash
# For reply-handler-instantly.json
INSTANTLY_WEBHOOK_SECRET=xxx

# For reply-handler-linkedin.json
HEYREACH_WEBHOOK_SECRET=xxx
```

## Agent Endpoint Reference

| Agent | Port | Health | Webhook Endpoints |
|-------|------|--------|-------------------|
| Lead Scorer | 4001 | `/health` | `/webhook/score-lead` |
| Reply Handler | 4002 | `/health` | `/webhook/reply` |
| Meeting Prep | 4003 | `/webhook/meeting-prep/health` | `/webhook/meeting-prep/brief`, `/webhook/meeting-prep/analyze` |
| Learning Loop | 4004 | `/webhook/learning-loop/health` | `/webhook/learning-loop/insight`, `/webhook/learning-loop/synthesis`, `/webhook/learning-loop/validate` |

## Testing

### Health Checks

```bash
# All agents should return 200
curl http://localhost:4001/health
curl http://localhost:4002/health
curl http://localhost:4003/webhook/meeting-prep/health
curl http://localhost:4004/webhook/learning-loop/health
```

### Auth Rejection Test

```bash
# Should return 401 without secret
curl -X POST http://localhost:4001/webhook/score-lead \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### Learning Loop Daily Test

```bash
curl -X POST http://localhost:4004/webhook/learning-loop/insight \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -d '{
    "source_type": "email_reply",
    "source_id": "test_001",
    "content": "We have budget approved for Q2",
    "context": {"lead_email": "test@example.com"},
    "brain_id": "brain_fintech"
  }'
```

### Learning Loop Weekly Test

```bash
curl -X POST http://localhost:4004/webhook/learning-loop/synthesis \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -d '{
    "week_start": "2026-01-20",
    "week_end": "2026-01-26",
    "brain_id": "brain_fintech"
  }'
```

### Meeting Prep Brief Test

```bash
curl -X POST http://localhost:5678/webhook/meeting-prep-brief \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -d '{
    "meeting": {
      "title": "Discovery Call - Acme Corp",
      "attendees": [{"email": "john@acme.com", "name": "John Doe"}]
    }
  }'
```

## Importing Workflows

### Via n8n UI

1. Open n8n dashboard at `http://localhost:5678`
2. Go to Workflows > Import
3. Select JSON file from this directory

### Via n8n API

```bash
# Import all workflows
for file in workflows/n8n/*.json; do
  curl -X POST http://localhost:5678/api/v1/workflows \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d @"$file"
done
```

## Deployment Checklist

- [ ] Set all required environment variables
- [ ] Configure Slack credentials in n8n
- [ ] Configure Google Calendar credentials (for meeting-prep-brief)
- [ ] Start all 4 agents (`bun run dev:agents`)
- [ ] Import workflows to n8n
- [ ] Activate workflows in n8n
- [ ] Test health endpoints
- [ ] Test webhook authentication

## Troubleshooting

### Workflow returns 404

Check that the agent URL and port are correct:
- Learning Loop: `http://localhost:4004` (not 3001)
- Meeting Prep: `http://localhost:4003` (not 3001)
- Reply Handler: `http://localhost:4002` (not 3002)
- Lead Scorer: `http://localhost:4001`

### Workflow returns 401

- Verify `X-Webhook-Secret` header matches agent's expected secret
- Check that the correct secret env var is being used (e.g., `INSTANTLY_WEBHOOK_SECRET` for Instantly)

### Workflow times out

- Check that the agent is running (`bun run dev:agents`)
- Verify agent health endpoint responds
- Check Docker containers are healthy (`docker ps`)
