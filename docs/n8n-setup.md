# n8n Workflow Setup Guide

This guide covers setting up n8n workflows for Atlas GTM, including credential configuration and environment variables.

## Quick Start

```bash
# 1. Add API keys to .env file
cp .env.example .env
# Edit .env with your actual API keys

# 2. Start services
bun run dev:all

# 3. Run the interactive setup
bun run n8n:credentials
```

The `n8n:credentials` command will:
1. Check environment variables
2. Guide you to create n8n credentials
3. Update workflow files with credential IDs
4. Import and activate workflows

---

## Environment Variables

### Required Variables

These must be set in your `.env` file for workflows to function:

| Variable | Description | Example |
|----------|-------------|---------|
| `WEBHOOK_SECRET` | Authentication for internal webhooks | `your-secure-32-char-secret` |
| `AIRTABLE_API_KEY` | Airtable API key | `pat...` |
| `ATTIO_API_KEY` | Attio CRM API key | `sk_...` |

### Optional Variables

These have defaults but can be customized:

| Variable | Default | Description |
|----------|---------|-------------|
| `LEAD_SCORER_URL` | `http://localhost:4001` | Lead Scorer agent URL |
| `REPLY_HANDLER_URL` | `http://localhost:4002` | Reply Handler agent URL |
| `MEETING_PREP_URL` | `http://localhost:4003` | Meeting Prep agent URL |
| `LEARNING_LOOP_URL` | `http://localhost:4004` | Learning Loop agent URL |
| `SLACK_REVIEW_CHANNEL` | `#lead-reviews` | Channel for lead reviews |
| `SLACK_BRIEFS_CHANNEL` | `#sales-briefs` | Channel for meeting briefs |
| `SLACK_ALERTS_CHANNEL` | `#gtm-alerts` | Channel for error alerts |
| `INSTANTLY_API_KEY` | - | Instantly.ai email API |
| `HEYREACH_API_KEY` | - | HeyReach LinkedIn API |

---

## n8n Credentials

Workflows require these credentials created in n8n UI:

### 1. Slack API (Required)

All 10 workflows use Slack for notifications.

**Setup:**
1. Open http://localhost:5678
2. Go to **Settings → Credentials → Add Credential**
3. Select **Slack API**
4. Name it exactly: `Slack API`
5. Enter your Slack Bot Token

**Getting a Slack Token:**
1. Go to https://api.slack.com/apps
2. Create or select your app
3. Go to **OAuth & Permissions**
4. Add scopes: `chat:write`, `channels:read`, `users:read`
5. Install to workspace
6. Copy the **Bot User OAuth Token** (`xoxb-...`)

### 2. Google Calendar OAuth2 (Optional)

Only needed for meeting-prep-brief workflow's calendar polling feature.

**Setup:**
1. In n8n: **Settings → Credentials → Add Credential**
2. Select **Google Calendar OAuth2 API**
3. Name it exactly: `Google Calendar`
4. Follow the OAuth2 authorization flow

**Note:** If not configured, the calendar polling trigger won't work, but manual brief requests via webhook still function.

---

## Workflows Overview

| Workflow | Credentials | Purpose |
|----------|-------------|---------|
| `lead-scorer-workflow` | Slack API | Batch lead scoring with review notifications |
| `category-a-workflow` | Slack API | High-priority lead routing |
| `category-b-workflow` | Slack API | Medium-priority lead routing |
| `category-c-workflow` | Slack API | Lower-priority lead routing |
| `classification-workflow` | Slack API | Lead classification |
| `reply-handler-instantly` | Slack API | Email reply processing |
| `reply-handler-linkedin` | Slack API | LinkedIn reply processing |
| `meeting-prep-brief` | Slack API, Google Calendar | Pre-call brief generation |
| `meeting-prep-analysis` | Slack API | Post-meeting transcript analysis |
| `learning-loop-daily` | Slack API | Daily insight processing |
| `learning-loop-weekly` | Slack API | Weekly synthesis reports |

---

## Slack Channel Mapping

Workflows send notifications to these channels. **All use hardcoded defaults** - no env vars needed if you create channels with these exact names:

### Required Channels (12 total)

| Channel | Purpose | Used By |
|---------|---------|---------|
| `#interested-leads` | Hot/interested lead notifications | category-a, reply-handler-* |
| `#lead-reviews` | Leads needing human review | lead-scorer, learning-loop-daily |
| `#gtm-alerts` | Error alerts and system notifications | All workflows (error handling) |
| `#sales-briefs` | Pre-meeting brief delivery | meeting-prep-brief |
| `#gtm-reports` | Weekly synthesis reports | learning-loop-weekly |
| `#dnc-list` | Do-not-contact notifications | category-b, reply-handler-* |
| `#manual-review` | Leads requiring manual review | category-c, reply-handler-* |
| `#qualified-leads` | Post-meeting qualified leads | meeting-prep-analysis |
| `#sales-pipeline` | Pipeline stage updates | meeting-prep-analysis |
| `#nurture-queue` | Leads moved to nurture | meeting-prep-analysis |
| `#referrals` | Referral notifications | category-b |
| `#urgent-reviews` | Urgent review requests | category-c |

### Workflow → Channel Mapping

| Workflow | Slack Node | Default Channel |
|----------|------------|-----------------|
| `lead-scorer-workflow` | Send Slack Notification | `#lead-reviews` |
| `category-a-workflow` | Interested notification | `#interested-leads` |
| `category-b-workflow` | Referral notification | `#referrals` |
| `category-b-workflow` | DNC notification | `#dnc-list` |
| `category-c-workflow` | Manual review | `#manual-review` |
| `category-c-workflow` | Urgent reviews | `#urgent-reviews` |
| `reply-handler-instantly` | Interested | `#interested-leads` |
| `reply-handler-instantly` | DNC | `#dnc-list` |
| `reply-handler-instantly` | Manual review | `#manual-review` |
| `reply-handler-instantly` | Alerts | `#gtm-alerts` |
| `reply-handler-linkedin` | Interested | `#interested-leads` |
| `reply-handler-linkedin` | DNC | `#dnc-list` |
| `reply-handler-linkedin` | Manual review | `#manual-review` |
| `reply-handler-linkedin` | Alerts | `#gtm-alerts` |
| `meeting-prep-brief` | Brief delivery | `#sales-briefs` |
| `meeting-prep-brief` | Errors | `#gtm-alerts` |
| `meeting-prep-analysis` | Qualified | `#qualified-leads` |
| `meeting-prep-analysis` | Pipeline | `#sales-pipeline` |
| `meeting-prep-analysis` | Nurture | `#nurture-queue` |
| `meeting-prep-analysis` | Errors | `#gtm-alerts` |
| `learning-loop-daily` | Review | `#lead-reviews` |
| `learning-loop-daily` | Alerts | `#gtm-alerts` |
| `learning-loop-weekly` | Reports | `#gtm-reports` |
| `learning-loop-weekly` | Alerts | `#gtm-alerts` |

### Customizing Channels (Optional)

To override defaults, set these env vars in `.env`:

```bash
SLACK_INTERESTED_LEADS_CHANNEL=#your-custom-channel
SLACK_REVIEW_CHANNEL=#your-custom-channel
SLACK_ALERTS_CHANNEL=#your-custom-channel
SLACK_BRIEFS_CHANNEL=#your-custom-channel
SLACK_REPORTS_CHANNEL=#your-custom-channel
SLACK_DNC_CHANNEL=#your-custom-channel
SLACK_MANUAL_REVIEW_CHANNEL=#your-custom-channel
SLACK_QUALIFIED_CHANNEL=#your-custom-channel
SLACK_PIPELINE_CHANNEL=#your-custom-channel
SLACK_NURTURE_CHANNEL=#your-custom-channel
SLACK_REFERRALS_CHANNEL=#your-custom-channel
SLACK_URGENT_CHANNEL=#your-custom-channel
```

---

## Manual Setup

If the automated script doesn't work, you can manually configure credentials:

### Step 1: Create Credentials in n8n

1. Open http://localhost:5678
2. Go to Settings → Credentials → Add Credential
3. Create "Slack API" and "Google Calendar" (optional)

### Step 2: Note the Credential IDs

After creating credentials, export them to see IDs:

```bash
# Inside the n8n container
docker exec -u node $(docker ps --format '{{.Names}}' | grep -E 'n8n' | grep -v 'nginx' | head -1) \
  n8n export:credentials --all --output=/tmp/creds.json

# View the credentials
docker exec $(docker ps --format '{{.Names}}' | grep -E 'n8n' | grep -v 'nginx' | head -1) \
  cat /tmp/creds.json | jq '.[].id'
```

### Step 3: Update Workflow Files

Replace placeholder IDs in `workflows/n8n/*.json`:

```bash
# Replace Slack credential placeholder
sed -i 's/SLACK_CREDENTIALS_ID/actual-credential-id/g' workflows/n8n/*.json

# Replace Google Calendar credential placeholder
sed -i 's/GOOGLE_CALENDAR_CREDENTIALS_ID/actual-credential-id/g' workflows/n8n/*.json
```

### Step 4: Import Workflows

```bash
bun run n8n:import
```

### Step 5: Activate Workflows

```bash
bun run n8n:activate
```

---

## Troubleshooting

### "Credential not found" Error

This means the workflow references a credential ID that doesn't exist.

**Solution:**
1. Create the credential in n8n UI with the exact name shown
2. Re-run `bun run n8n:credentials` to update workflow files
3. Or manually link the credential in the workflow editor

### Slack Messages Not Sending

1. Verify Slack Bot Token is correct
2. Check bot is invited to target channels
3. Verify bot has `chat:write` scope
4. Check channel names in environment variables

### Calendar Polling Not Working

1. Verify Google Calendar credential is properly authorized
2. Check the calendar has meetings with external attendees
3. Verify `INTERNAL_DOMAINS` environment variable is set correctly

### Webhook Authentication Failing

1. Verify `WEBHOOK_SECRET` is set in `.env`
2. Ensure the same secret is used in workflow triggers
3. Check the `X-Webhook-Secret` header in requests

---

## Testing Workflows

### Test Lead Scorer

```bash
curl -X POST http://localhost:5678/webhook/lead-scorer/batch \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -d '{
    "leads": [{
      "lead_id": "test_001",
      "email": "john@acme.com",
      "company": "Acme Corp",
      "title": "VP Engineering"
    }]
  }'
```

### Test Meeting Prep Brief

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

---

## Related Commands

| Command | Description |
|---------|-------------|
| `bun run n8n:credentials` | Interactive credential setup |
| `bun run n8n:import` | Import workflow JSON files |
| `bun run n8n:activate` | Activate all workflows |
| `bun run n8n:setup` | Import + activate (no credentials) |
| `bun run n8n:list` | List all workflows |
