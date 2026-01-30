#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

N8N_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'n8n' | grep -v 'nginx' | head -1)
WORKFLOW_DIR="workflows/n8n"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          ${YELLOW}🔐 n8n Credential & Environment Setup${CYAN}            ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# STEP 1: Environment Variables Check
# ============================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📋 Step 1: Checking environment variables${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

MISSING_VARS=()
OPTIONAL_MISSING=()

# Load .env if exists
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
    echo -e "${GREEN}✓${NC} Loaded .env file"
else
    echo -e "${YELLOW}⚠${NC} No .env file found - using environment variables only"
fi
echo ""

# Function to check required env var
check_required_env() {
    local var_name="$1"
    local description="$2"
    if [ -z "${!var_name}" ]; then
        MISSING_VARS+=("$var_name")
        echo -e "  ${RED}✗${NC} $var_name - $description"
    else
        echo -e "  ${GREEN}✓${NC} $var_name"
    fi
}

# Function to check optional env var
check_optional_env() {
    local var_name="$1"
    local description="$2"
    if [ -z "${!var_name}" ]; then
        OPTIONAL_MISSING+=("$var_name")
        echo -e "  ${YELLOW}○${NC} $var_name - $description (optional)"
    else
        echo -e "  ${GREEN}✓${NC} $var_name"
    fi
}

echo -e "${CYAN}Webhook Secrets:${NC}"
check_required_env "WEBHOOK_SECRET" "Required for all workflow authentication"

echo ""
echo -e "${CYAN}External API Keys:${NC}"
check_required_env "AIRTABLE_API_KEY" "Required for lead data access"
check_required_env "ATTIO_API_KEY" "Required for CRM integration"
check_optional_env "INSTANTLY_API_KEY" "Email outreach (Instantly.ai)"
check_optional_env "HEYREACH_API_KEY" "LinkedIn automation (HeyReach)"

echo ""
echo -e "${CYAN}Agent URLs:${NC}"
check_optional_env "LEAD_SCORER_URL" "Default: http://localhost:4001"
check_optional_env "REPLY_HANDLER_URL" "Default: http://localhost:4002"
check_optional_env "MEETING_PREP_URL" "Default: http://localhost:4003"
check_optional_env "LEARNING_LOOP_URL" "Default: http://localhost:4004"

echo ""
echo -e "${CYAN}Slack Configuration:${NC}"
check_optional_env "SLACK_REVIEW_CHANNEL" "Default: #lead-reviews"
check_optional_env "SLACK_BRIEFS_CHANNEL" "Default: #sales-briefs"
check_optional_env "SLACK_ALERTS_CHANNEL" "Default: #gtm-alerts"

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo ""
    echo -e "${RED}❌ Missing ${#MISSING_VARS[@]} required environment variables${NC}"
    echo ""
    echo "Add these to your .env file:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  $var=your-value-here"
    done
    echo ""
    read -p "Continue anyway? Workflows may fail without these [y/N]: " CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo ""
    echo -e "${GREEN}✓ All required environment variables configured${NC}"
fi

if [ ${#OPTIONAL_MISSING[@]} -gt 0 ]; then
    echo -e "${YELLOW}ℹ ${#OPTIONAL_MISSING[@]} optional variables not set (defaults will be used)${NC}"
fi

# ============================================
# STEP 2: n8n Container Check
# ============================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📋 Step 2: Checking n8n container${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ -z "$N8N_CONTAINER" ]; then
    echo -e "${RED}❌ n8n container not running${NC}"
    echo ""
    echo "Start n8n with:"
    echo "  bun run dev:all     # Full stack"
    echo "  bun run docker:up   # Docker only"
    exit 1
fi
echo -e "${GREEN}✓${NC} n8n container running: $N8N_CONTAINER"

# Wait for n8n to be healthy
echo "Waiting for n8n to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0
until docker exec "$N8N_CONTAINER" wget -q --spider http://localhost:5678/healthz 2>/dev/null; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo -e "${RED}❌ n8n failed to become healthy after $MAX_RETRIES attempts${NC}"
        exit 1
    fi
    echo "  Waiting... (attempt $RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done
echo -e "${GREEN}✓${NC} n8n is healthy"

# ============================================
# STEP 3: n8n UI Credentials Instructions
# ============================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📋 Step 3: Create credentials in n8n UI${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Open ${CYAN}http://localhost:5678${NC} and create these credentials:"
echo ""
echo -e "${YELLOW}1. Slack API (REQUIRED for all workflows)${NC}"
echo "   - Go to: Settings → Credentials → Add Credential"
echo "   - Type: Slack API"
echo -e "   - Name: ${CYAN}Slack API${NC} (exact name required)"
echo "   - Get token from: https://api.slack.com/apps"
echo "   - Required scopes: chat:write, channels:read, users:read"
echo ""
echo -e "${YELLOW}2. Google Calendar (optional, for meeting prep calendar polling)${NC}"
echo "   - Type: Google Calendar OAuth2"
echo -e "   - Name: ${CYAN}Google Calendar${NC} (exact name required)"
echo "   - Follow OAuth2 flow in n8n"
echo ""
echo -e "${CYAN}Note:${NC} HTTP Header Auth for Airtable, Attio, Instantly, HeyReach"
echo "      is handled via \$env.VARIABLE - no n8n credentials needed."
echo ""
read -p "Press Enter when credentials are created in n8n UI..."

# ============================================
# STEP 4: Fetch credential IDs from n8n
# ============================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📋 Step 4: Fetching credential IDs from n8n${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Export credentials to temp file inside container
docker exec -u node "$N8N_CONTAINER" n8n export:credentials --all --output=/tmp/creds.json 2>/dev/null || true

# Parse credential IDs using Node.js (available in n8n container)
SLACK_CRED_ID=$(docker exec "$N8N_CONTAINER" node -e "
const fs = require('fs');
try {
  const data = JSON.parse(fs.readFileSync('/tmp/creds.json', 'utf8'));
  const cred = data.find(c => c.type === 'slackApi');
  if (cred) console.log(cred.id);
} catch (e) {}
" 2>/dev/null || echo "")

GCAL_CRED_ID=$(docker exec "$N8N_CONTAINER" node -e "
const fs = require('fs');
try {
  const data = JSON.parse(fs.readFileSync('/tmp/creds.json', 'utf8'));
  const cred = data.find(c => c.type === 'googleCalendarOAuth2Api');
  if (cred) console.log(cred.id);
} catch (e) {}
" 2>/dev/null || echo "")

# Report findings
if [ -n "$SLACK_CRED_ID" ]; then
    echo -e "  ${GREEN}✓${NC} Found Slack API credential: ${CYAN}$SLACK_CRED_ID${NC}"
else
    echo -e "  ${RED}✗${NC} Slack API credential not found"
    echo -e "    ${YELLOW}→ Workflows will fail without Slack credentials${NC}"
fi

if [ -n "$GCAL_CRED_ID" ]; then
    echo -e "  ${GREEN}✓${NC} Found Google Calendar credential: ${CYAN}$GCAL_CRED_ID${NC}"
else
    echo -e "  ${YELLOW}○${NC} Google Calendar credential not found (optional)"
    echo -e "    ${YELLOW}→ Calendar polling in meeting-prep-brief will be disabled${NC}"
fi

# Check if we have at least Slack
if [ -z "$SLACK_CRED_ID" ]; then
    echo ""
    echo -e "${YELLOW}⚠️  No Slack credentials found. Options:${NC}"
    echo "  1. Create Slack API credential in n8n UI and re-run this script"
    echo "  2. Continue anyway (you'll need to manually link credentials later)"
    echo ""
    read -p "Continue without Slack credentials? [y/N]: " CONTINUE_NO_SLACK
    if [[ ! "$CONTINUE_NO_SLACK" =~ ^[Yy]$ ]]; then
        echo ""
        echo "Please create Slack credentials in n8n UI:"
        echo "  1. Open http://localhost:5678"
        echo "  2. Go to Settings → Credentials → Add Credential"
        echo "  3. Select 'Slack API'"
        echo "  4. Name it exactly: 'Slack API'"
        echo "  5. Re-run: bun run n8n:credentials"
        exit 1
    fi
fi

# ============================================
# STEP 5: Update workflow files with credential IDs
# ============================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📋 Step 5: Updating workflow files${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

cd "$PROJECT_DIR"
UPDATED_COUNT=0

if [ -n "$SLACK_CRED_ID" ]; then
    # Update Slack credential IDs in all workflow files
    for f in $WORKFLOW_DIR/*.json; do
        if grep -q "SLACK_CREDENTIALS_ID" "$f" 2>/dev/null; then
            # Use sed with backup, then remove backup
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s/SLACK_CREDENTIALS_ID/$SLACK_CRED_ID/g" "$f"
            else
                sed -i "s/SLACK_CREDENTIALS_ID/$SLACK_CRED_ID/g" "$f"
            fi
            echo -e "  ${GREEN}✓${NC} Updated Slack credential in $(basename "$f")"
            UPDATED_COUNT=$((UPDATED_COUNT + 1))
        fi
    done
fi

if [ -n "$GCAL_CRED_ID" ]; then
    # Update Google Calendar credential IDs
    for f in $WORKFLOW_DIR/*.json; do
        if grep -q "GOOGLE_CALENDAR_CREDENTIALS_ID" "$f" 2>/dev/null; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s/GOOGLE_CALENDAR_CREDENTIALS_ID/$GCAL_CRED_ID/g" "$f"
            else
                sed -i "s/GOOGLE_CALENDAR_CREDENTIALS_ID/$GCAL_CRED_ID/g" "$f"
            fi
            echo -e "  ${GREEN}✓${NC} Updated Google Calendar credential in $(basename "$f")"
            UPDATED_COUNT=$((UPDATED_COUNT + 1))
        fi
    done
fi

if [ $UPDATED_COUNT -eq 0 ]; then
    echo -e "  ${YELLOW}○${NC} No placeholder credential IDs found to update"
    echo -e "    (workflows may already be configured)"
fi

# ============================================
# STEP 6: Re-import workflows
# ============================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📋 Step 6: Re-importing workflows${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Run the import script
bash "$SCRIPT_DIR/n8n-import.sh"

# ============================================
# STEP 7: Activate workflows (optional)
# ============================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📋 Step 7: Activate workflows${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
read -p "Activate all workflows now? [Y/n]: " ACTIVATE
if [[ ! "$ACTIVATE" =~ ^[Nn]$ ]]; then
    bash "$SCRIPT_DIR/n8n-activate.sh"
fi

# ============================================
# Summary
# ============================================
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                    ${GREEN}✅ Setup Complete!${CYAN}                      ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Summary:${NC}"
echo -e "  • Environment variables: ${GREEN}checked${NC}"
if [ -n "$SLACK_CRED_ID" ]; then
    echo -e "  • Slack credentials: ${GREEN}configured${NC}"
else
    echo -e "  • Slack credentials: ${RED}not found${NC}"
fi
if [ -n "$GCAL_CRED_ID" ]; then
    echo -e "  • Google Calendar credentials: ${GREEN}configured${NC}"
else
    echo -e "  • Google Calendar credentials: ${YELLOW}skipped${NC}"
fi
echo -e "  • Workflows: ${GREEN}imported${NC}"
echo ""
echo -e "${YELLOW}Verify at:${NC} ${CYAN}http://localhost:5678/home/workflows${NC}"
echo ""
echo -e "${YELLOW}Test a workflow:${NC}"
echo -e "  curl -X POST http://localhost:5678/webhook/lead-scorer/batch \\"
echo -e "    -H 'Content-Type: application/json' \\"
echo -e "    -H 'X-Webhook-Secret: \$WEBHOOK_SECRET' \\"
echo -e "    -d '{\"leads\": [{\"lead_id\": \"test_001\", \"email\": \"test@example.com\"}]}'"
echo ""
