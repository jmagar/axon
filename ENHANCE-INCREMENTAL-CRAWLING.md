# Plan: Omniscient Incremental Crawling with Redis and Postgres

This plan describes the implementation of a "Global Intelligence" layer for the Axon crawler. It upgrades the system from "Linear Memory" (chaining off the last job) to "Global Memory" (reusing spoils from *any* historical job) and adds real-time coordination.

## Objectives

1.  **Deep History Deduplication (Postgres):** Enable a new hunt to "borrow" unchanged Markdown spoils from **any** previous hunt, even if the "Latest" job was partial, filtered, or failed.
2.  **Real-time Battlefield Radar (Redis):** Prevent "Thundering Herds" by ensuring that parallel workers do not fetch or process the same URL simultaneously.
3.  **Resilience:** Maintain a permanent index of content hashes that survives even if local manifest files are deleted or corrupted.

---

## Phase 1: Global Intelligence Bureau (Postgres)

### 1.1 Schema Update
We will add the `axon_page_index` table. This table maps URLs to their most recent successful storage location across the entire Armory.

```sql
-- crates/jobs/crawl_jobs/runtime/mod.rs -> ensure_schema()
CREATE TABLE IF NOT EXISTS axon_page_index (
    url TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    reflink_path TEXT NOT NULL,        -- Path relative to AXON_OUTPUT_DIR
    domain TEXT NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_axon_page_index_hash ON axon_page_index(content_hash);
CREATE INDEX IF NOT EXISTS idx_axon_page_index_domain ON axon_page_index(domain);
```

### 1.2 Performance: Batch Indexing
To avoid bottlenecking the traverser during high-speed crawls, we will implement a buffered indexing strategy (Write-Behind).

- **Implementation:** `crates/crawl/manifest/pg_index.rs`
- **Struct:** `PageIndexer`
- **Logic:** Buffers upserts in a `Vec`. Flushes to Postgres every 100 items or 5 seconds.
- **SQL:**
  ```sql
  INSERT INTO axon_page_index (url, content_hash, reflink_path, domain)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (url) DO UPDATE SET
    content_hash = EXCLUDED.content_hash,
    reflink_path = EXCLUDED.reflink_path,
    last_seen_at = NOW();
  ```

---

## Phase 2: Battlefield Radar (Redis)

### 2.1 Coordination Lock
Parallel workers will use Redis to coordinate their strikes on the same domain.

- **Key Pattern:** `axon:crawl:lock:<base64_url>`
- **Logic:** Before processing a page in `collector.rs`:
  ```rust
  // Attempt to acquire lock for 5 minutes
  let locked: bool = redis.set_nx(key, worker_id, EX 300).await?;
  if !locked {
      log_info("Skipping URL handled by another worker");
      continue;
  }
  ```

---

## Phase 3: The Omniscient Loop (`collector.rs`)

The `collect_crawl_pages` loop will now consult the global memory if local memory misses:

1.  **Level 1: Local Job Memory (Manifest)**
    - Check the manifest of the "Latest" successful job for this domain.
    - If Match: Reflink and mark `changed: false`.
2.  **Level 2: Global Memory (Postgres)**
    - If Local Miss: Calculate SHA-256 hash of newly fetched content (or check hash before fetch if we add HEAD support).
    - Query Postgres: `SELECT reflink_path FROM axon_page_index WHERE url=$1 AND content_hash=$2`
    - If Hash matches AND the stored `reflink_path` exists on disk:
        - **Reflink** from the recorded path (which might be from Job A, even if "Latest" is Job B).
        - Mark `changed: false`.
        - **Success:** Saved a write/embed that the current system would have missed.
3.  **Level 3: Fresh Conquest**
    - If both misses: Perform full write and mark `changed: true`.
    - Buffer update for `PageIndexer` (Phase 1.2).

---

## Phase 4: Data Portability & Safety

### 4.1 Stale Path Handling
Since jobs can be deleted, the `reflink_path` in Postgres might point to a folder that no longer exists.
- **Verification:** The collector will verify `tokio::fs::metadata(path).is_ok()` before attempting a reflink. 
- **Self-Healing:** If a file is missing, we treat it as a miss, write the new file, and update Postgres with the new successful location.

---

## Phase 5: Verification & Testing

1.  **Deep History Test (The Core Value):**
    - Run **Job A** (Full Crawl, 10 pages).
    - Run **Job B** (Partial Crawl, 1 page). Job B becomes "Latest".
    - Run **Job C** (Full Crawl).
    - **Verify:** Job C reuses 9 pages from Job A (via Postgres) and 1 page from Job B.
    - *Note: The current system would re-fetch the 9 pages because Job B "forgot" them.*
2.  **Parallel Worker Test:** Spawn parallel workers and verify Redis prevents duplicate fetches.
3.  **Recovery Test:** Delete the `manifest.jsonl` of the previous job manually. Verify Postgres still allows the next job to find and reflink the files.

---

## Risks & Mitigations

- **Risk:** High latency on Postgres lookups blocking the crawl loop.
- **Mitigation:** Use a background task/channel (`tokio::spawn`) to handle Postgres lookups and upserts so the main crawl loop never waits on the database. The lookup channel effectively becomes a "promise" of a path.
