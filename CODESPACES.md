# Testing Axon in GitHub Codespaces

## Quick Start

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/YOUR_USERNAME/axon)

1. Click "Create codespace on main"
2. Wait for automatic setup (~3-5 minutes)
3. Run `./scripts/codespaces-start.sh`
4. Test with `pnpm local status`

## What Gets Set Up Automatically

The `.devcontainer/devcontainer.json` configuration handles:

- ✅ Node.js 20 environment
- ✅ Docker-in-Docker support
- ✅ pnpm installation
- ✅ Project dependencies
- ✅ Environment variables
- ✅ Port forwarding (53000, 53002, 53021, 53333)

## Manual Testing Workflow

### 1. Start Services

```bash
# Start all infrastructure
./scripts/codespaces-start.sh

# Verify services are running
docker compose ps

# Check health
pnpm local status
```

### 2. Basic Scraping Test

```bash
# Single page scrape
pnpm local scrape https://example.com --output test.md

# Verify output
cat test.md
```

### 3. Embedding Pipeline Test

```bash
# Scrape with embeddings (auto-enabled)
pnpm local scrape https://example.com

# Query the embedded content
pnpm local query "example domain" --limit 3
```

### 4. Search & Crawl Test

```bash
# Search and auto-scrape
pnpm local search "rust programming" --limit 3

# Small crawl
pnpm local crawl https://example.com --limit 5

# Check Qdrant collections
curl http://localhost:53333/collections/axon
```

### 5. Ask Questions Test

```bash
# Requires claude CLI installed
pnpm local ask "what is rust?" --limit 5 --model sonnet
```

## Monitoring Services

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f axon-api
docker compose logs -f axon-embedder

# TEI embeddings
docker compose -f docker/docker-compose.tei.mxbai.yaml logs -f
```

### Check Resource Usage

```bash
# Container stats
docker stats

# Disk usage
df -h

# Memory usage
free -h
```

## Performance Benchmarks

Expected performance in Codespaces (2-core, 8GB RAM):

| Operation | Speed | Notes |
|-----------|-------|-------|
| Single scrape | ~2-3 sec | Network-dependent |
| Embedding (per doc) | ~200ms | CPU-only, sequential |
| Batch embedding (10 docs) | ~1.5 sec | Limited parallelism |
| Vector search | ~50ms | Depends on collection size |
| Small crawl (10 pages) | ~30-40 sec | Includes embedding |

## Troubleshooting

### Services won't start

```bash
# Check Docker daemon
docker info

# Restart Docker (in Codespaces)
sudo systemctl restart docker

# Clean start
docker compose down -v
./scripts/codespaces-start.sh
```

### Out of memory errors

```bash
# Check memory usage
docker stats --no-stream

# Reduce resource limits
docker compose -f docker-compose.yaml -f docker-compose.codespaces.yaml up -d

# Stop non-essential services
docker compose stop axon-rabbitmq
```

### Embedding timeout errors

The CPU-based TEI is slower. Adjust timeouts in `utils/embeddings.ts`:

```typescript
// Increase timeout for CPU mode
const timeout = process.env.CODESPACES ? 30000 : 10000;
```

### Port forwarding issues

```bash
# Check forwarded ports in VS Code
# View → Ports

# Manually forward missing ports
gh codespace ports forward 53002:53002
```

## Cleanup

### Stop Services

```bash
# Stop all containers
docker compose down

# Stop TEI
docker compose -f docker/docker-compose.tei.mxbai.yaml down

# Remove volumes (complete cleanup)
docker compose down -v
docker system prune -f
```

### Delete Codespace

In GitHub:
1. Go to https://github.com/codespaces
2. Find your Axon codespace
3. Click "..." → "Delete"

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/test-codespaces.yml
name: Test in Codespaces Environment

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install pnpm
        run: npm install -g pnpm

      - name: Install dependencies
        run: pnpm install

      - name: Build
        run: pnpm build

      - name: Start services
        run: |
          docker compose up -d
          docker compose --env-file docker/.env.tei.mxbai -f docker/docker-compose.tei.mxbai.yaml up -d

      - name: Wait for services
        run: sleep 30

      - name: Run tests
        run: pnpm test

      - name: Test status
        run: pnpm local status
```

## Cost Considerations

GitHub Codespaces pricing (as of 2024):

- **Free tier**: 120 core-hours/month for personal accounts
- **2-core machine**: 60 hours/month free
- **4-core machine**: 30 hours/month free

**Cost optimization tips:**

1. Stop codespace when not in use (auto-stops after 30min idle)
2. Use prebuilds to reduce startup time
3. Delete unused codespaces
4. Use local development for long-running tasks

## Comparison: Codespaces vs Local

| Aspect | Codespaces | Local (with GPU) |
|--------|-----------|------------------|
| **Setup time** | ~5 minutes | ~10 minutes (first time) |
| **Embedding speed** | 5 docs/sec | 50+ docs/sec |
| **Memory** | 8GB | 32GB+ |
| **Storage** | 32GB | Unlimited |
| **Cost** | Free tier / $0.18/hr | Hardware cost |
| **Portability** | Any device | Requires setup |
| **Persistence** | Stopped state saved | Always available |

## When to Use Codespaces

✅ **Good for:**
- CI/CD testing
- Quick demos
- Contributor onboarding
- Testing in clean environment
- Working from multiple devices

❌ **Not ideal for:**
- Large-scale crawling (>100 pages)
- Performance benchmarking
- Long-running batch jobs
- GPU-accelerated workloads

## Support

If you encounter issues:

1. Check the [troubleshooting guide](.devcontainer/README.md)
2. Review Docker logs: `docker compose logs`
3. Open an issue with:
   - Codespace machine type
   - Error messages
   - Steps to reproduce
