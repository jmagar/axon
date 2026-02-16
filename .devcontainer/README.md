# Axon on GitHub Codespaces

This configuration enables running the complete Axon stack in GitHub Codespaces for testing and development.

## What's Included

- ✅ Firecrawl API (web scraping backend)
- ✅ Patchright (browser automation)
- ✅ Qdrant (vector database)
- ✅ Redis (cache/queue)
- ✅ RabbitMQ (message broker)
- ✅ TEI Embeddings (CPU mode with mxbai-embed-large-v1)
- ✅ Embedder daemon (async embedding processor)

## Quick Start

### Option 1: Automatic Setup (Recommended)

When you open this repo in Codespaces, everything will be set up automatically via the `postCreateCommand`.

Once the Codespace is ready:

```bash
# Start all services
./scripts/codespaces-start.sh

# Check status
pnpm local status

# Test a scrape
pnpm local scrape https://example.com --output test-scrape.md
```

### Option 2: Manual Setup

```bash
# Install dependencies
pnpm install

# Copy environment files
cp .env.example .env
cp docker/.env.tei.mxbai.example docker/.env.tei.mxbai

# Build the project
pnpm build

# Start services
./scripts/codespaces-start.sh
```

## Service Ports

All services are automatically forwarded in Codespaces:

| Service | Port | Purpose |
|---------|------|---------|
| Firecrawl API | 53002 | Main scraping API |
| Embedder Daemon | 53000 | Async embedding processor |
| TEI Embeddings | 53021 | CPU-based embedding model |
| Qdrant | 53333 | Vector database |

## Testing Commands

```bash
# Status check
pnpm local status

# Scrape a single page
pnpm local scrape https://example.com

# Search and auto-scrape results
pnpm local search "rust programming language" --limit 3

# Crawl a small site
pnpm local crawl https://example.com --limit 10

# Query embedded content
pnpm local query "how to use rust" --limit 5

# Ask questions over indexed docs
pnpm local ask "what is rust?"
```

## Resource Constraints

Codespaces has limited resources compared to a local machine:

- **CPU**: 2-4 cores
- **Memory**: 8GB typical
- **Storage**: 32GB
- **No GPU**: Using CPU-based embeddings (slower but works)

### Performance Expectations

- **Embedding speed**: ~5-10 docs/sec (vs ~50-100/sec on GPU)
- **Scraping**: Same speed as local (network-bound)
- **Vector search**: Slightly slower due to limited RAM

## Troubleshooting

### Services not starting

```bash
# Check Docker status
docker ps

# View logs
docker compose logs -f

# Restart everything
docker compose down
./scripts/codespaces-start.sh
```

### Out of memory

```bash
# Stop non-essential services temporarily
docker compose stop axon-rabbitmq

# Use smaller batch sizes
pnpm local crawl https://example.com --limit 5
```

### Slow embeddings

This is expected on CPU. To speed up:

1. Reduce concurrent embedding requests in `.env`:
   ```bash
   TEI_MAX_CONCURRENT_REQUESTS=4
   ```

2. Use smaller batches when crawling:
   ```bash
   pnpm local crawl https://example.com --limit 10
   ```

## Differences from Local Setup

| Aspect | Local (GPU) | Codespaces (CPU) |
|--------|-------------|------------------|
| Embedding Model | Qwen3-Embedding-0.6B | mxbai-embed-large-v1 |
| Embedding Dim | 1536 | 1024 |
| Speed | ~50 docs/sec | ~5 docs/sec |
| VRAM | 12GB (RTX 4070) | N/A |
| RAM | 32GB+ | 8GB |

## Cost Optimization

To minimize Codespaces usage hours:

1. **Stop when not in use**: Codespaces auto-stops after 30min idle
2. **Use prebuilds**: Configure in `.github/workflows` for instant starts
3. **Test locally first**: Use Codespaces for CI/integration tests only

## Next Steps

1. **Run the test suite**: `pnpm test`
2. **Test the full pipeline**: Scrape → Embed → Query → Ask
3. **Verify all services**: Check health endpoints
4. **Monitor resources**: `docker stats`

## Known Limitations

- CPU-only embeddings are 5-10x slower than GPU
- Limited concurrent scraping due to memory constraints
- Large crawls (>100 pages) may hit memory limits
- Browser automation may be slower due to CPU constraints
