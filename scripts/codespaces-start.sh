#!/bin/bash
set -e

echo "🐳 Starting Axon infrastructure in Codespaces..."

# Check if Docker is available
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not available. Please wait for Docker to start."
    exit 1
fi

# Start main services
echo "🚀 Starting main services (Firecrawl, Qdrant, Redis, RabbitMQ)..."
docker compose up -d

# Start TEI with CPU configuration
echo "🧠 Starting TEI embeddings service (CPU mode)..."
docker compose --env-file docker/.env.tei.mxbai -f docker/docker-compose.tei.mxbai.yaml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check service health
echo "🔍 Checking service health..."

services=(
    "http://localhost:53002/health:Firecrawl API"
    "http://localhost:53333:Qdrant"
    "http://localhost:53021/health:TEI Embeddings"
)

all_healthy=true
for service in "${services[@]}"; do
    IFS=':' read -r url name <<< "$service"
    if curl -sf "$url" > /dev/null 2>&1; then
        echo "  ✅ $name"
    else
        echo "  ❌ $name (not responding)"
        all_healthy=false
    fi
done

if [ "$all_healthy" = true ]; then
    echo ""
    echo "✅ All services are running!"
    echo ""
    echo "Service URLs:"
    echo "  - Firecrawl API:    http://localhost:53002"
    echo "  - Embedder Daemon:  http://localhost:53000"
    echo "  - TEI Embeddings:   http://localhost:53021"
    echo "  - Qdrant:           http://localhost:53333"
    echo ""
    echo "Try running: pnpm local status"
else
    echo ""
    echo "⚠️  Some services are not responding yet. Check logs with:"
    echo "  docker compose logs -f"
fi
