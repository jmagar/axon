# Ask Command - Comprehensive Usage Examples

This document provides detailed examples and usage patterns for the `firecrawl ask` command.

## Purpose

Ask questions about your embedded documents and get Claude's answer. The command handles everything internally - no manual piping required.

## Architecture

1. Query Qdrant for relevant documents (semantic search)
2. Retrieve full content from top results
3. Format documents + question into context
4. Spawn `claude` CLI as subprocess
5. Pipe context to Claude's stdin
6. Stream response back to stdout

## Basic Usage

### Default Query (Haiku Model)

```bash
firecrawl ask "How do I create a Claude Code skill?"
```

**Output format:**
- **stdout**: Claude's response (streamed in real-time, pipe-safe)
- **stderr**: Progress messages and source citations (visible but don't interfere with piping)

**Default behavior:**
- Model: Haiku (fast and cost-effective)
- Limit: 10 documents
- Collection: `firecrawl` (default)

## Advanced Usage

### Limit Number of Documents

```bash
# Get fewer, more relevant results
firecrawl ask "What is FastAPI?" --limit 3

# Get more comprehensive context
firecrawl ask "Explain the entire authentication system" --limit 20
```

**When to adjust:**
- Use `--limit 3-5` for specific, focused questions
- Use `--limit 15-20` for broad architectural questions
- Default `--limit 10` works well for most queries

### Choose Different Models

```bash
# Use Sonnet for complex analysis
firecrawl ask "Compare the pros and cons of these three approaches" --model sonnet

# Use Opus for the most thorough analysis
firecrawl ask "Analyze this codebase architecture and suggest improvements" --model opus

# Use Haiku (default) for quick queries
firecrawl ask "What does this function do?" --model haiku
```

**Model selection guide:**
- **Haiku**: Fast, cheap, good for factual queries (default)
- **Sonnet**: Balanced speed/quality, good for analysis
- **Opus**: Most thorough, use for complex reasoning

### Filter by Domain

```bash
# Only search within a specific domain
firecrawl ask "Explain React hooks" --domain react.dev

# Combine with other options
firecrawl ask "What are the API endpoints?" --domain api.example.com --limit 5
```

**Use cases:**
- Isolate results to official documentation
- Exclude unrelated content from multi-domain crawls
- Focus on specific subdomain or site

### Use Different Collection

```bash
# Query a different Qdrant collection
firecrawl ask "What is Qdrant?" --collection docs

# Useful for organizing content by topic
firecrawl ask "How do I configure Docker?" --collection infrastructure
```

**Collection strategies:**
- Separate by project/domain
- Organize by content type (docs, code, articles)
- Use collection names that reflect the content

### Combine Multiple Options

```bash
# Complex query with all options
firecrawl ask "What is Qdrant?" \
  --limit 5 \
  --model opus \
  --domain qdrant.tech \
  --collection docs
```

## Example Session

```bash
$ firecrawl ask "What are the main features of Firecrawl?"

  ◉ Searching for relevant documents...
  ✓ Found 5 relevant documents
  ◉ Retrieving full document content...
  ✓ Retrieved 5 documents
  → Asking Claude...

Based on the documentation, Firecrawl's main features include:

1. **Web Scraping**: Single URL scraping with browser automation
2. **Crawling**: Multi-page crawling with depth and path controls
3. **Semantic Search**: Vector embeddings via TEI and Qdrant
4. **Structured Extraction**: Schema-based data extraction
5. **Batch Operations**: Parallel scraping of multiple URLs
6. **Map Discovery**: Sitemap-like URL enumeration
7. **Query Interface**: Semantic search over embedded content
8. **Ask Interface**: Q&A over embedded documents with Claude

The system uses Playwright-based browser automation (via Patchright) for JavaScript-heavy sites, with a fetch engine fallback for simpler pages. All scraped content is automatically embedded using TEI and stored in Qdrant for semantic search.

────────────────────────────────────────────────────────────
Sources:
  1. [0.92] https://docs.firecrawl.dev/features
     Firecrawl Features Overview

  2. [0.88] https://docs.firecrawl.dev/getting-started
     Getting Started Guide

  3. [0.85] https://docs.firecrawl.dev/api/crawl
     Crawl API Documentation

  4. [0.83] https://docs.firecrawl.dev/architecture
     Architecture Overview

  5. [0.81] https://github.com/mendableai/firecrawl
     Firecrawl GitHub Repository

  i Retrieved 5 documents
```

## Requirements

- **TEI embeddings service**: For semantic search (remote or local)
- **Qdrant vector database**: For document storage and retrieval
- **`claude` CLI tool**: Must be installed and in PATH

**Why `claude` CLI?**
- Uses Claude Max subscription (no per-token API costs)
- No API key management required
- Same pattern as calling `git`, `docker`, `npm` as subprocesses
- Officially maintained by Anthropic

## Piping and Integration

### Pipe Output to File

```bash
# Save Claude's response (stdout only)
firecrawl ask "Explain this architecture" > response.txt

# Save both response and sources (stderr + stdout)
firecrawl ask "Explain this architecture" &> full-output.txt
```

### Pipe to Other Commands

```bash
# Extract key points with grep
firecrawl ask "What are the main features?" | grep "^\d\."

# Process with other tools
firecrawl ask "List all API endpoints" | jq -R 'split("\n")'

# Chain with other commands
firecrawl ask "What needs testing?" | xargs -I {} echo "TODO: {}"
```

## Troubleshooting

### No Results Found

```bash
$ firecrawl ask "What is XYZ?"
  ◉ Searching for relevant documents...
  ✗ No relevant documents found
```

**Solutions:**
1. Check if content was embedded: `firecrawl query "XYZ"`
2. Try broader search terms
3. Increase limit: `--limit 20`
4. Verify collection: `curl http://localhost:53333/collections/firecrawl`

### Connection Errors

```bash
$ firecrawl ask "Question"
  ✗ Error: Failed to connect to Qdrant
```

**Solutions:**
1. Check Qdrant status: `docker ps | grep qdrant`
2. Verify port: `ss -tuln | grep 53333`
3. Check environment: `echo $QDRANT_URL`
4. Restart services: `docker compose restart firecrawl-qdrant`

### Claude CLI Not Found

```bash
$ firecrawl ask "Question"
  ✗ Error: claude CLI not found in PATH
```

**Solutions:**
1. Install Claude Code: `npm install -g @anthropic-ai/claude`
2. Verify installation: `which claude`
3. Add to PATH if needed
4. Check Claude authentication: `claude --help`

## Performance Tips

### Optimize Query Speed

1. **Use fewer documents**: `--limit 3` for faster queries
2. **Use Haiku model**: Default, fastest model
3. **Be specific**: More specific questions = better relevance = fewer docs needed

### Optimize Answer Quality

1. **Use more documents**: `--limit 15-20` for comprehensive answers
2. **Use Sonnet/Opus**: Better reasoning for complex questions
3. **Filter by domain**: Reduce noise, improve relevance
4. **Refine question**: Clear, specific questions get better answers

## Best Practices

1. **Start broad, then narrow**: Use default settings first, then adjust based on results
2. **Use domain filtering**: When you know the source, filter by domain
3. **Choose model by complexity**: Haiku for facts, Sonnet for analysis, Opus for reasoning
4. **Iterate on questions**: Refine based on initial results
5. **Check sources**: Review source citations to verify answer accuracy

## Integration Examples

### In Scripts

```bash
#!/bin/bash
# ask-about-feature.sh - Query documentation for feature details

FEATURE="$1"
if [ -z "$FEATURE" ]; then
  echo "Usage: $0 <feature-name>"
  exit 1
fi

# Query with specific parameters
firecrawl ask "How does $FEATURE work?" \
  --limit 5 \
  --model sonnet \
  --domain docs.example.com
```

### In Makefiles

```makefile
.PHONY: docs-query
docs-query:
	@echo "Querying documentation..."
	@firecrawl ask "$(Q)" --limit 5 --domain docs.example.com

# Usage: make docs-query Q="How do I deploy?"
```

### In CI/CD

```yaml
# .github/workflows/docs-check.yml
- name: Check documentation coverage
  run: |
    ANSWER=$(firecrawl ask "Is feature X documented?" --limit 3)
    if echo "$ANSWER" | grep -q "not documented"; then
      echo "Feature X needs documentation"
      exit 1
    fi
```

## Related Commands

- **`firecrawl query`**: Direct semantic search in Qdrant (no Claude interpretation)
- **`firecrawl retrieve`**: Get full document content by URL
- **`firecrawl search`**: Web search with optional scraping
- **`firecrawl embed`**: Manually embed content into Qdrant

## See Also

- Main CLAUDE.md: Quick usage reference
- TEI Integration: How embeddings are generated
- Qdrant Setup: Vector database configuration
