---
description: Suggest complementary docs URLs to crawl using your configured OpenAI-compatible model
argument-hint: "[focus text]" [--limit N] [--json]
allowed-tools: Bash(axon *)
---

# Crawl Suggestions

Execute the Axon suggest command with the provided arguments:

```bash
axon suggest $ARGUMENTS
```

`suggest` reads indexed URLs from Qdrant, derives base URL context, asks the configured model for complementary docs, and filters out URLs that are already indexed.

## Expected Output

Plaintext mode:
- Header: `Suggested Crawl Targets`
- Summary line with requested/accepted/filtered counts
- Ranked list with URL + rationale

JSON mode:
- `collection`
- `requested`
- `indexed_urls_count`
- `indexed_base_urls_count`
- `suggestions` (url + reason)
- `rejected_existing`
- `raw_model_output`
