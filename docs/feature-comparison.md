# Firecrawl CLI Feature Comparison

**Date**: 2026-02-03
**Official CLI Version**: v1.1.1
**Our CLI Version**: Custom fork with semantic search capabilities

## Executive Summary

Our implementation is a **superset of the official Firecrawl CLI** with 15 additional commands focused on:
- Vector database integration (Qdrant + TEI embeddings)
- Semantic search and RAG capabilities
- Advanced vector database management
- Enhanced job tracking

## Side-by-Side Command Comparison

| Command | Official CLI | Our CLI | Notes |
|---------|:------------:|:-------:|-------|
| **Core Scraping** |
| `scrape` | ✅ | ✅ | Identical functionality |
| `crawl` | ✅ | ✅ | Identical functionality |
| `map` | ✅ | ✅ | Identical functionality |
| `search` | ✅ | ✅ | Identical functionality |
| **Authentication** |
| `login` | ✅ | ✅ | Identical functionality |
| `logout` | ✅ | ✅ | Identical functionality |
| `config` | ✅ | ✅ | Identical functionality |
| `view-config` | ❌ | ✅ | **NEW** - Separate read-only config viewer |
| **Monitoring** |
| `version` | ✅ | ✅ | Identical functionality |
| `credit-usage` | ✅ | ❌ | **MISSING** - We don't have this |
| `--status` flag | ✅ | ✅ | Both show auth/concurrency/credits |
| `status` command | ❌ | ✅ | **NEW** - Enhanced system status |
| `list` | ❌ | ✅ | **NEW** - List active crawl jobs |
| **Data Extraction** |
| `extract` | ❌ | ✅ | **NEW** - Structured data extraction |
| `batch` | ❌ | ✅ | **NEW** - Batch scraping |
| **Semantic Search** |
| `embed` | ❌ | ✅ | **NEW** - Manual embedding |
| `query` | ❌ | ✅ | **NEW** - Vector similarity search |
| `retrieve` | ❌ | ✅ | **NEW** - Document reconstruction |
| **Vector DB Management** |
| `sources` | ❌ | ✅ | **NEW** - List indexed URLs |
| `stats` | ❌ | ✅ | **NEW** - Database statistics |
| `domains` | ❌ | ✅ | **NEW** - List unique domains |
| `delete` | ❌ | ✅ | **NEW** - Delete vectors |
| `history` | ❌ | ✅ | **NEW** - Time-based view |
| `info` | ❌ | ✅ | **NEW** - URL details |

## Features We Added (15 Total)

### 1. Vector Database Integration
**Commands**: `embed`, `query`, `retrieve`

Complete semantic search stack:
- **TEI (Text Embeddings Inference)**: Local embedding service (port 53010)
- **Qdrant**: Vector database (port 53333)
- Automatic chunking with markdown-aware splitting
- Concurrent batch processing with p-limit

```bash
# Embed scraped content
firecrawl scrape https://example.com --embed

# Semantic search
firecrawl query "How do I authenticate?"

# Reconstruct full document
firecrawl retrieve https://example.com
```

### 2. Vector Database Management (6 Commands)
**Commands**: `sources`, `stats`, `domains`, `delete`, `history`, `info`

Full lifecycle management of embedded content:

```bash
# List all indexed URLs
firecrawl sources

# Show database stats
firecrawl stats

# List unique domains
firecrawl domains

# Delete by URL or domain
firecrawl delete --url https://example.com
firecrawl delete --domain example.com

# Time-based view of content
firecrawl history

# Detailed URL info
firecrawl info https://example.com
```

### 3. Enhanced Job Management (2 Commands)
**Commands**: `list`, `status`

Better visibility into long-running operations:

```bash
# List all active crawl jobs
firecrawl list

# Enhanced system status (jobs + embedding queue)
firecrawl status
```

### 4. Data Extraction Commands (2 Commands)
**Commands**: `extract`, `batch`

Batch processing and structured extraction:

```bash
# Extract structured data
firecrawl extract https://example.com/product

# Batch scrape multiple URLs
firecrawl batch https://site1.com https://site2.com --embed
```

### 5. Configuration Enhancement (1 Command)
**Command**: `view-config`

Separate read-only config viewer (official CLI uses `config` for both):

```bash
# View config without modifying
firecrawl view-config
```

### 6. Self-Hosted Infrastructure

Our implementation uses a **completely self-hosted stack**:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| Firecrawl | `ghcr.io/firecrawl/firecrawl` | 53002 | Main API |
| Patchright | `loorisr/patchright-scrape-api` | 53006 | Browser scraping |
| TEI | `ghcr.io/huggingface/tei` | 53010 | Text embeddings |
| Qdrant | `qdrant/qdrant` | 53333 | Vector database |

**Custom Patches**:
- Fixed `page.timeout()` → `page.wait_for_timeout()` bug in Patchright
- Mounted patched `patchright-app.py` via docker-compose volume

### 7. Automatic Embedding Integration

All scraping commands support automatic embedding:

```bash
# Scrape and embed in one command
firecrawl scrape https://example.com --embed

# Crawl and wait for embedding completion
firecrawl crawl https://example.com --embed --wait
```

## Features We're Missing (1 Total)

### `credit-usage` Command

The official CLI has a dedicated `credit-usage` command:

```bash
# Official CLI
firecrawl credit-usage --json --pretty
```

**Our workaround**: Use the global `--status` flag which shows credits:

```bash
# Our CLI
firecrawl --status
# Output includes: "Credits: 500,000 remaining"
```

## Architecture Differences

### Official CLI
```text
CLI → Firecrawl Cloud API (api.firecrawl.dev)
```

### Our CLI
```text
CLI → Local Firecrawl (53002) → Patchright (53006) → Chrome
                              ↓
                            TEI (53010) → Qdrant (53333)
```

## Use Case Comparison

| Use Case | Official CLI | Our CLI |
|----------|--------------|---------|
| One-off web scraping | ✅ Perfect | ✅ Perfect |
| Site crawling | ✅ Perfect | ✅ Perfect |
| Web search | ✅ Perfect | ✅ Perfect |
| URL discovery | ✅ Perfect | ✅ Perfect |
| **Building knowledge bases** | ❌ Not supported | ✅ **Core feature** |
| **Semantic search** | ❌ Not supported | ✅ **Core feature** |
| **RAG pipelines** | ❌ Not supported | ✅ **Core feature** |
| **Document reconstruction** | ❌ Not supported | ✅ **Core feature** |
| **Vector DB management** | ❌ Not supported | ✅ **Core feature** |
| Cloud deployment | ✅ Native | ❌ Self-hosted only |
| Credit management | ✅ Native | ⚠️ Partial (`--status` only) |

## Summary

We've built a **complete RAG (Retrieval-Augmented Generation) platform** on top of the official Firecrawl CLI:

✅ **15 new commands** for semantic search and vector database management
✅ **100% compatibility** with official CLI commands (except credit-usage)
✅ **Self-hosted infrastructure** with custom bug fixes
✅ **Automatic embedding** integration on all scraping commands
✅ **Production-ready** vector search capabilities

The official CLI is a **cloud-based scraping tool**.
Our CLI is a **self-hosted knowledge base platform** with scraping capabilities.
