-- Provider cooling: bounded cooldown window on the unified `jobs` table so a
-- job that hit a saturated provider (e.g. TEI 429 after local retries are
-- exhausted) backs off instead of being reclaimed and re-failing in a tight
-- loop. See docs/pipeline-unification/plans/2026-07-08-provider-cooling.md.
--
-- `cooldown_until` is stored as TEXT (RFC3339), matching every other
-- timestamp column on `jobs` (created_at/updated_at/started_at/finished_at) —
-- all written via the `Timestamp(pub String)` newtype, not epoch integers.
--
-- The claim query (`claim_next_unified_job_unchecked` in
-- crates/axon-jobs/src/workers/unified.rs) filters
-- `status IN ('queued', 'waiting', 'blocked')` and must additionally exclude
-- rows whose `cooldown_until` is still in the future. `idx_axon_jobs_claim`
-- (migration 0019) already covers `status` for that predicate; this migration
-- adds a companion partial index scoped to `status = 'waiting'` (the only
-- status a cooldown is ever set on) so the new `cooldown_until` filter stays
-- index-covered on every worker poll without widening the existing index.
ALTER TABLE jobs ADD COLUMN cooldown_until TEXT;

CREATE INDEX idx_axon_jobs_claim_cooldown
    ON jobs(status, cooldown_until)
    WHERE status = 'waiting';
