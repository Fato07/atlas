#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

WORKFLOW_DIR="/home/node/workflows/n8n"

echo -e "${YELLOW}🔄 Importing n8n workflows...${NC}"

# Find the n8n container name (handles both docker-compose and docker compose naming)
N8N_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'n8n' | grep -v 'nginx' | head -1)
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'postgres' | head -1)

if [ -z "$N8N_CONTAINER" ]; then
    echo -e "${RED}❌ n8n container not running. Start with: bun run dev:all${NC}"
    exit 1
fi

if [ -z "$POSTGRES_CONTAINER" ]; then
    echo -e "${RED}❌ PostgreSQL container not running. Start with: bun run dev:all${NC}"
    exit 1
fi

echo -e "${BLUE}📦 Using n8n container: $N8N_CONTAINER${NC}"
echo -e "${BLUE}📦 Using postgres container: $POSTGRES_CONTAINER${NC}"

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

echo -e "${GREEN}✓ n8n is ready${NC}"

# Clear existing workflows and tags to allow re-import
# This is safe because we're syncing from version-controlled JSON files
echo -e "${YELLOW}🗑️  Clearing existing workflows and tags...${NC}"
docker exec "$POSTGRES_CONTAINER" psql -U n8n -d n8n -c "
  -- Delete in order respecting foreign keys
  TRUNCATE TABLE workflows_tags CASCADE;
  TRUNCATE TABLE shared_workflow CASCADE;
  TRUNCATE TABLE workflow_history CASCADE;
  TRUNCATE TABLE workflow_publish_history CASCADE;
  TRUNCATE TABLE workflow_statistics CASCADE;
  TRUNCATE TABLE workflow_dependency CASCADE;
  TRUNCATE TABLE webhook_entity CASCADE;
  TRUNCATE TABLE execution_entity CASCADE;
  TRUNCATE TABLE execution_data CASCADE;
  TRUNCATE TABLE execution_metadata CASCADE;
  TRUNCATE TABLE workflow_entity CASCADE;
  TRUNCATE TABLE folder_tag CASCADE;
  TRUNCATE TABLE tag_entity CASCADE;
" > /dev/null 2>&1 || true

echo -e "${GREEN}✓ Database cleared${NC}"

# List workflows to import
WORKFLOWS=$(docker exec "$N8N_CONTAINER" sh -c "ls -1 $WORKFLOW_DIR/*.json 2>/dev/null")
WORKFLOW_COUNT=$(echo "$WORKFLOWS" | wc -l | tr -d ' ')
echo -e "${BLUE}📁 Found $WORKFLOW_COUNT workflow files to import${NC}"

# Import workflows one at a time to handle shared tags correctly
echo -e "${YELLOW}📦 Importing workflows from $WORKFLOW_DIR...${NC}"
IMPORTED=0
FAILED=0

for workflow in $WORKFLOWS; do
    workflow_name=$(basename "$workflow" .json)
    if docker exec -u node "$N8N_CONTAINER" n8n import:workflow --input="$workflow" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $workflow_name"
        IMPORTED=$((IMPORTED + 1))
    else
        echo -e "  ${RED}✗${NC} $workflow_name"
        FAILED=$((FAILED + 1))
    fi
done

# Summary
echo ""
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All $IMPORTED workflows imported successfully!${NC}"
else
    echo -e "${YELLOW}⚠️  Imported $IMPORTED workflows, $FAILED failed${NC}"
fi

echo ""
echo -e "${BLUE}📋 Imported workflows:${NC}"
docker exec -u node "$N8N_CONTAINER" n8n list:workflow 2>/dev/null || echo "  (run 'bun run n8n:list' to see workflows)"

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Open http://localhost:5678/home/workflows"
echo "  2. Configure Slack credentials in n8n Settings"
echo "  3. Activate workflows you want to use"
echo ""
echo "Or run: bun run n8n:activate (to activate all workflows)"
