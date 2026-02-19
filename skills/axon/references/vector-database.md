# Axon Vector Database & RAG Reference

Complete reference for RAG (Retrieval-Augmented Generation) features, vector database management, and semantic search with integrated Qdrant.

---

## Overview

The Axon CLI includes integrated Qdrant vector database support for building production RAG systems. All scraping operations automatically embed content into Qdrant for semantic search and retrieval.

**Key Features:**
- Automatic embedding of scraped content
- Semantic search over embedded documents
- Full document retrieval by URL
- Vector database management (sources, stats, history, cleanup)
- Configurable collections and chunking

---

## Prerequisites

### Required Services

**Qdrant Vector Database:**
```bash
# Local instance
docker run -p 6333:6333 qdrant/qdrant

# Or use Qdrant Cloud: https://cloud.qdrant.io/
```

**Text Embeddings Inference (TEI):**
```bash
# Local instance with BGE model
docker run -p 8080:80 ghcr.io/huggingface/text-embeddings-inference:latest \
  --model-id BAAI/bge-small-en-v1.5

# Or use Hugging Face Inference Endpoints
```

---

## Configuration

Add to `~/claude-homelab/.env`:

```bash
# Qdrant Vector Database
QDRANT_URL="http://localhost:6333"  # Local instance
# QDRANT_URL="https://your-cluster.cloud.qdrant.io"  # Cloud instance
QDRANT_API_KEY=""  # Optional for cloud, empty for local
QDRANT_COLLECTION="axon"  # Collection name for embeddings

# Text Embeddings Inference (TEI)
TEI_URL="http://localhost:8080"  # Local TEI instance
# TEI_URL="https://your-endpoint.hf.space"  # HF Inference Endpoint
TEI_MODEL="BAAI/bge-small-en-v1.5"  # Embedding model
TEI_DIMENSIONS=384  # Model dimensions (bge-small-en-v1.5 = 384)
```

---

## Auto-Embedding Behavior

**Default:** All scrape, crawl, search, and extract operations automatically embed content into Qdrant.

```bash
# These ALL auto-embed by default:
axon scrape https://example.com          # ✅ Auto-embeds
axon crawl https://example.com --wait    # ✅ Auto-embeds
axon search "AI" --scrape                # ✅ Auto-embeds
axon extract https://example.com --prompt "..." # ✅ Auto-embeds
```

**Disable embedding:**
```bash
# Add --no-embed flag to skip embedding
axon scrape https://example.com --no-embed  # ❌ No embedding
axon crawl https://example.com --no-embed --wait  # ❌ No embedding
```

**When to disable:**
- Testing scraping logic
- Extracting data for non-RAG purposes
- Avoiding duplicate embeddings
- Performance-sensitive operations

---

## Embedding Commands

### Embed Content

Embed content into Qdrant vector database with automatic chunking.

```bash
# Embed from URL (scrapes then embeds)
axon embed https://example.com/docs

# Embed from file
axon embed --url https://example.com < document.md

# Embed from stdin with explicit URL
cat document.md | axon embed --url https://example.com/doc

# Embed without chunking (single vector)
axon embed https://example.com --no-chunk

# Embed to specific collection
axon embed https://example.com --collection custom_docs
```

**Parameters:**
- `[input]`: URL to scrape and embed, file path, or "-" for stdin
- `--url <url>`: Explicit URL for metadata (required for file/stdin)
- `--collection <name>`: Qdrant collection name (default: from env)
- `--no-chunk`: Disable chunking, embed as single vector
- `-o, --output <path>`: Save output to file
- `--json`: Output as JSON format

**Chunking Behavior:**
- **Default:** Content split into ~512 token chunks with 50 token overlap
- **Metadata preserved:** Each chunk includes source URL, domain, timestamp
- **Automatic deduplication:** Duplicate content not re-embedded

---

### Cancel Embedding Job

```bash
# Cancel pending embedding job
axon embed cancel <job-id>
```

**Note:** Can only cancel jobs in `pending` status.

---

## Query & Retrieval Commands

### Query Semantic Search

Search embedded content using semantic similarity.

```bash
# Basic query
axon query "How do I implement authentication?"

# Limit results
axon query "API documentation" --limit 10

# Filter by domain
axon query "authentication" --domain docs.example.com

# Show full chunk text
axon query "setup guide" --full

# Group results by URL
axon query "installation" --group

# Query specific collection
axon query "search term" --collection custom_docs
```

**Parameters:**
- `<query>`: Search query text
- `--limit <number>`: Maximum number of results (default: 5)
- `--domain <domain>`: Filter results by domain
- `--full`: Show full chunk text instead of truncated
- `--group`: Group results by URL
- `--collection <name>`: Qdrant collection name
- `-o, --output <path>`: Save output to file
- `--json`: Output as JSON format

**Output Format:**
```json
{
  "query": "authentication guide",
  "results": [
    {
      "url": "https://docs.example.com/auth",
      "domain": "docs.example.com",
      "chunk": "To implement authentication...",
      "score": 0.89,
      "timestamp": "2026-02-06T10:00:00Z"
    }
  ]
}
```

---

### Retrieve Document

Retrieve full document from Qdrant by URL.

```bash
# Retrieve by exact URL
axon retrieve https://example.com/docs/guide

# Retrieve from specific collection
axon retrieve https://example.com/docs/guide --collection custom_docs

# Save to file
axon retrieve https://example.com/docs/guide -o document.md
```

**Parameters:**
- `<url>`: URL of the document to retrieve
- `--collection <name>`: Qdrant collection name
- `-o, --output <path>`: Save output to file
- `--json`: Output as JSON format

**Output:**
```markdown
# Document Title

Full document content reconstructed from all chunks...
```

---

## Database Management Commands

### List Sources

List all source URLs indexed in the vector database.

```bash
# List all sources
axon sources

# Filter by domain
axon sources --domain example.com

# Filter by source command
axon sources --source scrape

# Limit results
axon sources --limit 100

# Save to file
axon sources -o sources.json
```

**Parameters:**
- `--domain <domain>`: Filter by domain
- `--source <command>`: Filter by source command (scrape, crawl, embed, search, extract)
- `--limit <number>`: Maximum sources to show
- `--collection <name>`: Qdrant collection name
- `-o, --output <path>`: Save output to file
- `--json`: Output as JSON format

**Output:**
```json
{
  "total": 42,
  "sources": [
    {
      "url": "https://docs.example.com/guide",
      "domain": "docs.example.com",
      "source": "crawl",
      "chunks": 15,
      "timestamp": "2026-02-06T10:00:00Z"
    }
  ]
}
```

---

### Database Statistics

Show vector database statistics.

```bash
# Basic stats
axon stats

# Verbose stats with details
axon stats --verbose

# Stats for specific collection
axon stats --collection custom_docs

# Save to file
axon stats -o stats.json
```

**Parameters:**
- `--verbose`: Include additional details
- `--collection <name>`: Qdrant collection name
- `-o, --output <path>`: Save output to file
- `--json`: Output as JSON format

**Output:**
```json
{
  "collection": "axon",
  "vectors": 1234,
  "documents": 87,
  "domains": 12,
  "sources": {
    "scrape": 45,
    "crawl": 35,
    "embed": 7
  },
  "storageSize": "15.3 MB",
  "averageChunksPerDoc": 14.2
}
```

---

### List Domains

List unique domains in the vector database.

```bash
# List all domains
axon domains

# Limit results
axon domains --limit 50

# Save to file
axon domains -o domains.json
```

**Parameters:**
- `--limit <number>`: Maximum domains to show
- `--collection <name>`: Qdrant collection name
- `-o, --output <path>`: Save output to file
- `--json`: Output as JSON format

**Output:**
```json
{
  "total": 12,
  "domains": [
    {
      "domain": "docs.example.com",
      "documents": 42,
      "vectors": 567,
      "lastUpdated": "2026-02-06T10:00:00Z"
    }
  ]
}
```

---

### Delete Vectors

Delete vectors from the vector database.

```bash
# Delete by URL
axon delete --url https://example.com/page --yes

# Delete by domain
axon delete --domain example.com --yes

# Delete all vectors (DANGEROUS)
axon delete --all --yes

# Delete from specific collection
axon delete --url https://example.com --collection custom_docs --yes
```

**Parameters:**
- `--url <url>`: Delete all vectors for a specific URL
- `--domain <domain>`: Delete all vectors for a specific domain
- `--all`: Delete all vectors in the collection
- `--yes`: Confirm deletion (required for safety)
- `--collection <name>`: Qdrant collection name
- `-o, --output <path>`: Save output to file
- `--json`: Output as JSON format

**⚠️ Safety:** The `--yes` flag is required to prevent accidental deletion.

**Output:**
```json
{
  "deleted": 156,
  "target": "https://example.com/docs",
  "collection": "axon"
}
```

---

### View History

Show time-based view of indexed content.

```bash
# Show all history
axon history

# Filter by last N days
axon history --days 7

# Filter by domain
axon history --domain example.com

# Filter by source command
axon history --source crawl

# Limit results
axon history --limit 100

# Save to file
axon history -o history.json
```

**Parameters:**
- `--days <number>`: Filter by entries from last N days
- `--domain <domain>`: Filter by domain
- `--source <command>`: Filter by source command (scrape, crawl, embed, search, extract)
- `--limit <number>`: Maximum entries to show
- `--collection <name>`: Qdrant collection name
- `-o, --output <path>`: Save output to file
- `--json`: Output as JSON format

**Output:**
```json
{
  "total": 87,
  "history": [
    {
      "url": "https://docs.example.com/new-guide",
      "domain": "docs.example.com",
      "source": "scrape",
      "chunks": 12,
      "timestamp": "2026-02-06T10:00:00Z"
    }
  ]
}
```

---

### Show URL Info

Show detailed information for a specific URL.

```bash
# Show info for URL
axon info https://example.com/docs/guide

# Show full chunk text (not truncated)
axon info https://example.com/docs/guide --full

# Info from specific collection
axon info https://example.com --collection custom_docs

# Save to file
axon info https://example.com -o info.json
```

**Parameters:**
- `<url>`: URL to get information for
- `-f, --full`: Show full chunk text (default: 100 char preview)
- `-c, --collection <name>`: Qdrant collection name (default: "axon")
- `-o, --output <file>`: Write output to file
- `--json`: Output as JSON

**Output:**
```json
{
  "url": "https://docs.example.com/guide",
  "domain": "docs.example.com",
  "source": "crawl",
  "totalChunks": 15,
  "totalVectors": 15,
  "timestamp": "2026-02-06T10:00:00Z",
  "chunks": [
    {
      "id": "chunk-1",
      "text": "Introduction to the guide...",
      "tokens": 512,
      "position": 0
    }
  ]
}
```

---

## RAG Workflows

### 1. Build Documentation RAG System

**Scrape → Auto-Embed → Query**

```bash
# Step 1: Scrape documentation (auto-embeds by default)
axon scrape https://docs.example.com/guide

# Step 2: Crawl entire docs site (auto-embeds all pages)
axon crawl https://docs.example.com \
  --include-paths "/docs/*" \
  --wait \
  --progress

# Step 3: Query the embedded content
axon query "How do I configure authentication?"

# Step 4: Retrieve full document
axon retrieve https://docs.example.com/auth-guide
```

---

### 2. Extract and Index Product Data

**Extract → Embed → Query**

```bash
# Extract structured product data
axon extract https://example.com/products \
  --prompt "Extract product name, price, description, and features" \
  --show-sources

# Manually embed extracted data (if --no-embed was used)
cat products.json | axon embed --url https://example.com/products

# Query products
axon query "products under $50 with free shipping"
```

---

### 3. Monitor and Update Content

**Check History → Refresh → Verify**

```bash
# Check what's indexed
axon sources --domain example.com

# Remove old content
axon delete --domain example.com --yes

# Re-crawl with fresh content
axon crawl https://example.com --wait

# Verify updates
axon history --domain example.com --days 1
```

---

### 4. Multi-Collection Organization

**Separate Collections for Different Purposes**

```bash
# Index documentation to docs collection
axon crawl https://docs.example.com \
  --collection docs \
  --wait

# Index blog posts to blog collection
axon crawl https://blog.example.com \
  --collection blog \
  --wait

# Query specific collection
axon query "API reference" --collection docs
axon query "case studies" --collection blog
```

---

### 5. Database Maintenance

**Inspect → Clean → Optimize**

```bash
# Show database stats
axon stats --verbose

# List all sources
axon sources

# Check specific domain
axon info https://example.com/old-page

# Delete outdated content
axon delete --domain old.example.com --yes

# View cleanup history
axon history --days 30
```

---

## Metadata Storage

Each embedded chunk includes:

```json
{
  "url": "https://docs.example.com/guide",
  "domain": "docs.example.com",
  "source": "crawl",
  "timestamp": "2026-02-06T10:00:00Z",
  "chunkIndex": 3,
  "totalChunks": 15,
  "text": "Chunk content...",
  "vector": [0.123, -0.456, ...]
}
```

**Searchable fields:**
- `url` - Exact URL filtering
- `domain` - Domain-based filtering
- `source` - Source command (scrape, crawl, embed, etc.)
- `timestamp` - Time-based filtering
- `vector` - Semantic similarity search

---

## Collection Management

### Default Collection

```bash
# Configured via environment variable
export QDRANT_COLLECTION="axon"
```

### Multiple Collections

```bash
# Use --collection flag for different collections
axon embed https://example.com --collection docs
axon query "search" --collection docs
axon sources --collection docs
```

**Use cases for multiple collections:**
- Separate production vs testing data
- Organize by domain or project
- Isolate different embedding models
- Version control for content

---

## Chunking Strategy

### Auto-Chunking (Default)

```bash
# Automatic chunking enabled by default
axon embed https://example.com
```

**Chunking parameters:**
- **Chunk size:** ~512 tokens (~2048 characters)
- **Overlap:** 50 tokens (prevents context loss)
- **Method:** Semantic boundaries (paragraphs, headers)

### Single-Vector Mode

```bash
# Disable chunking, embed as single vector
axon embed https://example.com --no-chunk
```

**When to use single-vector:**
- Short documents (<1000 tokens)
- Documents with single cohesive topic
- When full context always needed

---

## Deduplication

**Automatic deduplication prevents duplicate embeddings:**

1. **URL-based:** Same URL not re-embedded unless `--remove` flag used
2. **Content-based:** Identical content not re-embedded (content hash check)
3. **Domain refresh:** Use `axon scrape https://example.com --remove` to clear domain before re-scraping

**Refresh workflow:**
```bash
# Remove old content for domain
axon delete --domain docs.example.com --yes

# Re-scrape with fresh content
axon crawl https://docs.example.com --wait
```

---

## Performance Tips

### Query Optimization

- Use `--limit` to control result count
- Filter by `--domain` when possible
- Use `--group` to consolidate results by URL
- Index frequently queried domains in separate collections

### Embedding Optimization

- Use `--no-chunk` for short documents
- Batch multiple URLs with crawl instead of individual scrapes
- Monitor embedding queue: `axon status --embed`
- Use appropriate `--delay` to avoid rate limiting

### Storage Optimization

- Delete outdated content regularly
- Use `axon sources` to audit indexed content
- Monitor storage with `axon stats --verbose`
- Consider separate collections for temporary vs permanent content

---

## Troubleshooting

### Qdrant Connection Errors

**"Connection refused"**
- Verify Qdrant is running: `docker ps | grep qdrant`
- Check `QDRANT_URL` in `.env`
- Test connection: `curl http://localhost:6333/health`

**"Collection not found"**
- Collection created automatically on first embed
- Verify `QDRANT_COLLECTION` in `.env`
- Check existing collections: `curl http://localhost:6333/collections`

---

### TEI Service Errors

**"Failed to generate embeddings"**
- Verify TEI is running: `docker ps | grep text-embeddings`
- Check `TEI_URL` in `.env`
- Test endpoint: `curl http://localhost:8080/health`
- Ensure model is loaded: Check TEI logs

**"Model dimensions mismatch"**
- Verify `TEI_DIMENSIONS` matches model
- BGE-small-en-v1.5 = 384 dimensions
- BGE-base-en-v1.5 = 768 dimensions
- Update `.env` with correct dimensions

---

### Embedding Queue Issues

**"Queue not processing"**
- Check TEI service is running
- Check Qdrant connection
- View queue status: `axon status --embed`
- Check for failed jobs and errors

**"Slow embedding"**
- TEI may be rate-limited
- Check TEI container resources (CPU/memory)
- Consider upgrading TEI instance
- Use `--no-chunk` for small documents

---

### Query Issues

**"No results found"**
- Verify content is embedded: `axon sources`
- Check collection name: `--collection`
- Try broader query terms
- Check domain filter is correct

**"Irrelevant results"**
- Increase `--limit` to see more options
- Refine query with more specific terms
- Use `--domain` filter to narrow results
- Consider re-indexing with better content

---

For command syntax, see [commands.md](./commands.md)
For parameters, see [parameters.md](./parameters.md)
For job management, see [job-management.md](./job-management.md)
