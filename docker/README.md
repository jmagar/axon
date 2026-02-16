# Docker Configuration

This directory contains Docker-related configuration files and patches for the Axon CLI project.

## Files

- **`patchright-app.py`** - Patched version of the patchright-scrape-api app.py
  - Fixes `page.timeout()` → `page.wait_for_timeout()` bug
  - Mounted into the firecrawl-playwright container via docker-compose.yaml

- **`docker-compose.tei.yaml`** - Alternative compose file for local TEI (Text Embeddings Inference) setup
  - Use when running TEI locally instead of remote steamy-wsl
  - Includes TEI service with GPU support
  - Companion env files: `.env.tei.example`, `.env.tei.rtx4070.example`

- **`docker-compose.tei.mxbai.yaml`** - Alternative compose file using mxbai embedding model
  - Variant using mixedbread-ai/mxbai-embed-large-v1 model
  - Use when testing different embedding models
  - Companion env files: `.env.tei.mxbai.example`, `.env.tei.rtx3050.example`

- **`.env.tei.example`** - Environment template for local TEI setup
- **`.env.tei.mxbai.example`** - Environment template for mxbai variant
- **`.env.tei.rtx4070.example`** - RTX 4070-optimized TEI template
- **`.env.tei.rtx3050.example`** - RTX 3050 (8GB)-optimized TEI template

## Deployment

**All Docker Compose commands should be run from the project root:**

```bash
# From project root (axon/)
docker compose up -d                    # Start main stack
docker compose ps                       # Check service status
docker compose logs -f firecrawl        # View logs
docker compose down                     # Stop all services

# Using alternative TEI configs
docker compose -f docker-compose.yaml -f docker/docker-compose.tei.yaml up -d
docker compose -f docker-compose.yaml -f docker/docker-compose.tei.mxbai.yaml up -d
```

**Why deploy from project root:**
- `docker-compose.yaml` is in project root
- `.env` file is in project root
- Volume mounts reference project root (`.:/app`)
- Build contexts reference subdirectories (`apps/axon-postgres`)

## Directory Structure

```
axon/
├── .env                              # Main environment variables (stays in root)
├── .env.example                      # Main env template (stays in root)
├── docker-compose.yaml               # Main compose file (stays in root)
└── docker/
    ├── README.md                     # This file
    ├── patchright-app.py             # Patchright bug fix
    ├── docker-compose.tei.yaml       # Local TEI variant
    ├── docker-compose.tei.mxbai.yaml # mxbai variant
    ├── .env.tei.example              # TEI env template
    ├── .env.tei.rtx4070.example      # RTX 4070 TEI template
    ├── .env.tei.mxbai.example        # mxbai env template
    └── .env.tei.rtx3050.example      # RTX 3050 TEI template
```

## Patchright Patch Details

**Issue:** Upstream `loorisr/patchright-scrape-api` has a bug on line 374:
```python
await page.timeout(request_model.wait_after_load)  # ❌ Wrong
```

**Fix:** Our patched version:
```python
await page.wait_for_timeout(request_model.wait_after_load)  # ✅ Correct
```

**Mount:** The main docker-compose.yaml mounts this fix:
```yaml
volumes:
  - ./docker/patchright-app.py:/app/app.py:ro
```

This ensures the patched version persists across container restarts.
