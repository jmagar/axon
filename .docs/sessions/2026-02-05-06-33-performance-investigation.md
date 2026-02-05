**Date:** 06:32:59 | 02/05/2026  
**Project:** cli-firecrawl  
**Topic:** Investigation of performance/scalability claims from session report 2026-02-05-performance-scalability-analysis.md

## Scope
Investigated the specific claims:
- Memory leaks via unbounded module/service caches
- Concurrency bottlenecks (sequential processing)
- HTTP inefficiency (no pooling)
- I/O blocking (sync FS in hot paths)
- Scalability limit beyond ~50 concurrent pages

## Evidence Collected
- `src/utils/embeddings.ts`: module-level `cachedTeiInfo` with no TTL/URL keying, reset only for tests.
- `src/utils/qdrant.ts`: collection cache is LRU (`LRUCache`) keyed by `qdrantUrl + collection` (bounded size).
- `src/container/services/QdrantService.ts`: instance-level LRU cache (bounded size).
- `src/container/services/TeiService.ts`: instance-level cache with no TTL.
- `src/container/services/EmbedPipeline.ts`: batchEmbed uses `p-limit` concurrency; closures capture `item` content.
- `src/utils/background-embedder.ts`: processes jobs sequentially in `processEmbedQueue` and `processStaleJobsOnce`.
- `src/utils/embed-queue.ts`: sync FS (readFileSync/writeFileSync/readdirSync) used for queue operations.
- `src/utils/http.ts` + `src/container/services/HttpClient.ts`: global `fetch` used; no explicit dispatcher/agent configured.

## Preliminary Findings
- Some cache-related claims are outdated: Qdrant caches are now LRU-bounded.
- TEI info cache remains a single global value in utils (no TTL or URL keying). Instance cache also has no TTL.
- Sequential job processing is present in background embedder by design.
- Sync FS calls are present in embed queue and settings/credentials utilities; hot-path impact depends on usage volume.
- No explicit connection pooling configuration is present; cannot conclude per-request TCP connections without runtime/network evidence.
- No direct evidence in code for "exponential" degradation beyond 50 concurrent pages; requires benchmark data.

## Notes
This session performed investigation only (Phase 1 of systematic debugging). No code changes or fixes were applied.