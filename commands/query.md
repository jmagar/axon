---
description: Semantic search over embedded content in Qdrant
argument-hint: "<search query>" [--limit N] [--domain example.com]
allowed-tools: Bash(axon *)
---

# Semantic Search Query

Execute the Axon query command with the provided arguments:

```bash
axon query $ARGUMENTS
```

## Instructions

1. **Execute the command** using the Bash tool with the arguments provided
2. **Parse the response** to extract:
   - Ranked search results
   - Relevance scores
   - Content snippets
   - Source URLs
3. **Present the results** including:
   - Top N results (ranked by similarity)
   - Relevance score for each result
   - Content preview/snippet
   - Source URL and metadata
4. **Summarize findings**:
   - Most relevant result
   - Common themes across results
   - Suggested follow-up queries

## Expected Output

The command returns JSON containing:
- `results`: Array of search results with:
  - `score`: Similarity score (0-1)
  - `content`: Content snippet
  - `url`: Source URL
  - `metadata`: Page metadata
- `query`: Original search query
- `total`: Total results found

Present search results ranked by relevance with scores and content previews.
