#!/bin/bash
set -e

echo "🚀 Setting up Axon development environment..."

# Install pnpm if not present
if ! command -v pnpm &> /dev/null; then
    echo "📦 Installing pnpm..."
    npm install -g pnpm
fi

# Install dependencies
echo "📦 Installing Node.js dependencies..."
pnpm install

# Create environment file for Codespaces
echo "⚙️  Creating .env file for Codespaces..."
cat > .env << 'EOF'
# Firecrawl Configuration
FIRECRAWL_API_KEY=local-dev
FIRECRAWL_API_URL=http://localhost:53002
HOST=0.0.0.0

# TEI Configuration (CPU-based for Codespaces)
TEI_URL=http://localhost:53021

# Qdrant Configuration
QDRANT_URL=http://localhost:53333

# Enable embeddings
EMBEDDINGS_ENABLED=true

# PostgreSQL Configuration
POSTGRES_USER=postgres
POSTGRES_PASSWORD=local-dev-password
POSTGRES_DB=firecrawl
POSTGRES_PORT=53432

# Firecrawl Database Connection
NUQ_DATABASE_URL=postgresql://postgres:local-dev-password@axon-postgres:53432/firecrawl

# Redis/RabbitMQ (match project defaults: non-standard Redis port)
REDIS_URL=redis://axon-redis:53379
REDIS_RATE_LIMIT_URL=redis://axon-redis:53379
REDIS_EVICT_URL=redis://axon-redis:53379
NUQ_REDIS_URL=redis://axon-redis:53379
REDIS_HOST=axon-redis
REDIS_PORT=53379
REDIS_RATE_LIMIT_BY_IP=10
RABBITMQ_URL=amqp://axon-rabbitmq:5672
NUQ_RABBITMQ_URL=amqp://axon-rabbitmq:5672

# Playwright
PLAYWRIGHT_URL=http://axon-playwright:53006
EOF

# Create TEI environment file for CPU mode
echo "⚙️  Creating TEI configuration for CPU..."
cat > docker/.env.tei.mxbai << 'EOF'
# TEI CPU configuration for Codespaces
TEI_IMAGE=ghcr.io/huggingface/text-embeddings-inference:cpu-1.8.1
TEI_HTTP_PORT=53021
TEI_EMBEDDING_MODEL=mixedbread-ai/mxbai-embed-large-v1
TEI_DTYPE=float32
TEI_POOLING=cls
TEI_DEFAULT_PROMPT=Represent this sentence for searching relevant passages:

# Conservative settings for Codespaces
TEI_MAX_CONCURRENT_REQUESTS=8
TEI_MAX_BATCH_TOKENS=4096
TEI_MAX_BATCH_REQUESTS=8
TEI_MAX_CLIENT_BATCH_SIZE=8
TEI_TOKENIZATION_WORKERS=2

# Storage
TEI_DATA_DIR=/workspace/.cache/tei-mxbai

# Runtime
OMP_NUM_THREADS=2
MKL_NUM_THREADS=2
TOKENIZERS_PARALLELISM=true
RUST_LOG=text_embeddings_router=info
HF_HUB_ENABLE_HF_TRANSFER=1
HF_TOKEN=
EOF

# Create cache directories
echo "📁 Creating cache directories..."
mkdir -p .cache/embed-queue
mkdir -p .firecrawl
mkdir -p qdrant_storage

# Build the project
echo "🔨 Building TypeScript project..."
pnpm build

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start the infrastructure: ./scripts/codespaces-start.sh"
echo "  2. Run status check: pnpm local status"
echo "  3. Test a scrape: pnpm local scrape https://example.com"
