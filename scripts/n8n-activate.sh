#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${YELLOW}⚡ Activating all n8n workflows...${NC}"

# Find the n8n container name (handles both docker-compose and docker compose naming)
N8N_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'n8n' | grep -v 'nginx' | head -1)

if [ -z "$N8N_CONTAINER" ]; then
    echo -e "${RED}❌ n8n container not running. Start with: bun run dev:all${NC}"
    exit 1
fi

echo -e "${BLUE}📦 Using container: $N8N_CONTAINER${NC}"

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

# Get all workflow IDs
WORKFLOW_IDS=$(docker exec -u node "$N8N_CONTAINER" n8n list:workflow 2>/dev/null | cut -d'|' -f1)

if [ -z "$WORKFLOW_IDS" ]; then
    echo -e "${YELLOW}⚠️  No workflows found. Run 'bun run n8n:import' first.${NC}"
    exit 0
fi

echo -e "${YELLOW}📦 Activating workflows...${NC}"
ACTIVATED=0
FAILED=0

for workflow_id in $WORKFLOW_IDS; do
    workflow_name=$(docker exec -u node "$N8N_CONTAINER" n8n list:workflow 2>/dev/null | grep "^$workflow_id" | cut -d'|' -f2)
    # Use update:workflow to set active=true (suppress deprecation warning, command still works)
    if docker exec -u node "$N8N_CONTAINER" n8n update:workflow --id="$workflow_id" --active=true > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} $workflow_name"
        ACTIVATED=$((ACTIVATED + 1))
    else
        echo -e "  ${RED}✗${NC} $workflow_name"
        FAILED=$((FAILED + 1))
    fi
done

# Summary
echo ""
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All $ACTIVATED workflows activated!${NC}"
else
    echo -e "${YELLOW}⚠️  Activated $ACTIVATED workflows, $FAILED failed${NC}"
fi

echo ""
echo "View at: http://localhost:5678/home/workflows"
