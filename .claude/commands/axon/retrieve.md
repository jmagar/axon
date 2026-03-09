---
description: Retrieve full document from vector database by URL
argument-hint: <url>
allowed-tools: mcp__axon__axon, Bash
---

Use `mcp__axon__axon` directly:

```json
{ "action": "retrieve", "url": "<url from $ARGUMENTS>" }
```

Optional: `max_points` (int), `response_mode`.

**NEVER include `collection` — it is not a valid field for `retrieve` and will cause an `invalid request` error.**

Present reconstructed content, chunk count, and source metadata. If no chunks found, suggest scraping or crawling the URL first.
