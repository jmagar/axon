#!/bin/bash
# Docker Health Check for CLI Firecrawl Infrastructure
# Checks all 7 services and outputs status with color coding

set -o pipefail

# Change to project root (4 levels up from scripts/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$PROJECT_ROOT"

# Load TEI_URL with correct precedence: env var > .env > default
if [ -z "$TEI_URL" ]; then
  # No environment variable set, try .env file
  if [ -f ".env" ]; then
    # Source .env safely (only TEI_URL)
    TEI_URL_FROM_ENV=$(grep "^TEI_URL=" .env 2>/dev/null | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    if [ -n "$TEI_URL_FROM_ENV" ]; then
      TEI_URL="$TEI_URL_FROM_ENV"
    fi
  fi
fi
# Final fallback to default if still empty
TEI_URL="${TEI_URL:-http://localhost:53010}"

# Extract hostname and port from TEI_URL for display
TEI_HOST=$(echo "$TEI_URL" | sed -E 's|https?://||' | cut -d'/' -f1)

# Colors (only if TTY)
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;36m'
  DIM='\033[2m'
  BOLD='\033[1m'
  NC='\033[0m' # No Color
else
  GREEN=''
  RED=''
  YELLOW=''
  BLUE=''
  DIM=''
  BOLD=''
  NC=''
fi

# Track overall health
HEALTHY_COUNT=0
TOTAL_COUNT=7

# Display embedding model info banner
echo ""
echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${BOLD}   EMBEDDING MODEL INFORMATION${NC}"
echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${GREEN}✓${NC} Model: Qwen/Qwen3-Embedding-0.6B"
echo "${GREEN}✓${NC} Service: Hugging Face Text Embeddings Inference (TEI)"
echo "${GREEN}✓${NC} Location: ${TEI_HOST}"
echo "${GREEN}✓${NC} Hardware: RTX 4070 GPU"
echo "${GREEN}✓${NC} Vector Dimension: 1024"
echo "${GREEN}✓${NC} Endpoints: /embed (native), /v1 (OpenAI-compatible)"
echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo "${BOLD}Docker Service Health Check${NC}"
echo ""

# 1. Firecrawl API (Port 53002)
echo -n "Checking firecrawl (53002)... "
if STATUS=$(curl -sf --max-time 5 http://localhost:53002/health 2>/dev/null); then
  echo -e "${GREEN}✓ healthy${NC}"
  ((HEALTHY_COUNT++))
else
  echo -e "${RED}✗ unhealthy${NC} [Connection refused]"
  echo -e "${DIM}  → docker restart firecrawl${NC}"
  echo -e "${DIM}  → docker logs firecrawl --tail 50${NC}"
fi

# 2. Embedder Daemon (Port 53000)
echo -n "Checking embedder (53000)... "
if HEALTH=$(curl -sf --max-time 5 http://localhost:53000/health 2>/dev/null); then
  if STATUS=$(curl -sf --max-time 5 http://localhost:53000/status 2>/dev/null); then
    PENDING=$(echo "$STATUS" | jq -r '.pending // 0' 2>/dev/null || echo "0")
    PROCESSING=$(echo "$STATUS" | jq -r '.processing // 0' 2>/dev/null || echo "0")
    echo -e "${GREEN}✓ healthy${NC} ${DIM}[${PENDING} pending, ${PROCESSING} processing]${NC}"
    ((HEALTHY_COUNT++))
  else
    echo -e "${GREEN}✓ healthy${NC} ${DIM}[queue status unavailable]${NC}"
    ((HEALTHY_COUNT++))
  fi
else
  echo -e "${RED}✗ unhealthy${NC} [Connection refused]"
  echo -e "${DIM}  → docker restart firecrawl-embedder${NC}"
  echo -e "${DIM}  → docker logs firecrawl-embedder --tail 50${NC}"
fi

# 3. Patchright (Port 53006 - Internal)
echo -n "Checking patchright (53006)... "
if STATUS=$(docker inspect firecrawl-playwright --format '{{.State.Status}}' 2>/dev/null); then
  if [ "$STATUS" = "running" ]; then
    echo -e "${GREEN}✓ running${NC}"
    ((HEALTHY_COUNT++))
  else
    echo -e "${RED}✗ ${STATUS}${NC}"
    echo -e "${DIM}  → docker restart firecrawl-playwright${NC}"
  fi
else
  echo -e "${RED}✗ not found${NC}"
  echo -e "${DIM}  → docker compose up -d firecrawl-playwright${NC}"
fi

# 4. Qdrant (Port 53333)
echo -n "Checking qdrant (53333)... "
if HEALTH=$(curl -sf --max-time 5 http://localhost:53333/health 2>/dev/null); then
  if COLLECTION=$(curl -sf --max-time 5 http://localhost:53333/collections/firecrawl 2>/dev/null); then
    VECTORS=$(echo "$COLLECTION" | jq -r '.result.vectors_count // 0' 2>/dev/null || echo "0")
    echo -e "${GREEN}✓ healthy${NC} ${DIM}[${VECTORS} vectors]${NC}"
    ((HEALTHY_COUNT++))
  else
    echo -e "${GREEN}✓ healthy${NC} ${DIM}[no collections yet]${NC}"
    ((HEALTHY_COUNT++))
  fi
else
  echo -e "${RED}✗ unhealthy${NC} [Connection refused]"
  echo -e "${DIM}  → docker restart firecrawl-qdrant${NC}"
  echo -e "${DIM}  → docker logs firecrawl-qdrant --tail 50${NC}"
fi

# 5. Redis (Port 53379 - Internal)
echo -n "Checking redis (53379)... "
if PING=$(docker exec firecrawl-redis redis-cli -p 53379 PING 2>/dev/null); then
  if [ "$PING" = "PONG" ]; then
    echo -e "${GREEN}✓ healthy${NC}"
    ((HEALTHY_COUNT++))
  else
    echo -e "${RED}✗ unhealthy${NC} [No PONG response]"
    echo -e "${DIM}  → docker restart firecrawl-redis${NC}"
  fi
else
  echo -e "${RED}✗ unhealthy${NC} [Cannot connect]"
  echo -e "${DIM}  → docker restart firecrawl-redis${NC}"
fi

# 6. RabbitMQ (Internal)
echo -n "Checking rabbitmq... "
if HEALTH=$(docker inspect firecrawl-rabbitmq --format '{{.State.Health.Status}}' 2>/dev/null); then
  if [ "$HEALTH" = "healthy" ]; then
    echo -e "${GREEN}✓ healthy${NC}"
    ((HEALTHY_COUNT++))
  elif [ "$HEALTH" = "starting" ]; then
    echo -e "${YELLOW}⚠ starting${NC} ${DIM}(wait 30-60s)${NC}"
  else
    echo -e "${RED}✗ ${HEALTH}${NC}"
    echo -e "${DIM}  → docker restart firecrawl-rabbitmq${NC}"
    echo -e "${DIM}  → docker logs firecrawl-rabbitmq --tail 50${NC}"
  fi
else
  echo -e "${RED}✗ not found${NC}"
  echo -e "${DIM}  → docker compose up -d firecrawl-rabbitmq${NC}"
fi

# 7. Remote TEI (from TEI_URL env var)
echo -n "Checking remote-tei (${TEI_HOST})... "
if INFO=$(curl -sf --max-time 5 "${TEI_URL}/info" 2>/dev/null); then
  MODEL=$(echo "$INFO" | jq -r '.model_id // "unknown"' 2>/dev/null || echo "unknown")
  echo -e "${GREEN}✓ healthy${NC} ${DIM}[${MODEL}]${NC}"
  ((HEALTHY_COUNT++))
else
  echo -e "${RED}✗ unreachable${NC}"
  echo -e "${DIM}  → Check TEI service at ${TEI_URL}${NC}"
  echo -e "${DIM}  → Verify TEI_URL in .env file${NC}"
  echo -e "${DIM}  → Check firewall/network connectivity${NC}"
fi

# Summary
echo ""
echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${BOLD}Services: ${HEALTHY_COUNT}/${TOTAL_COUNT} healthy${NC}"

if [ $HEALTHY_COUNT -eq $TOTAL_COUNT ]; then
  echo "${GREEN}Status: All systems operational ✓${NC}"
  echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 0
else
  echo "${RED}Status: Degraded - fix unhealthy services ✗${NC}"
  echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "${YELLOW}For detailed diagnostics, ask Claude to spawn the docker-debugger agent${NC}"
  exit 1
fi
