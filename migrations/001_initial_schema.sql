-- migrations/001_initial_schema.sql
-- Initial schema: all axon job tables and supporting structures.
--
-- This file is a reference migration extracted from the inline ensure_schema()
-- calls scattered across crates/jobs/. When sqlx-migrate or refinery is
-- adopted (A-M-04), these CREATE TABLE statements become the authoritative
-- source of truth and the inline DDL can be removed.
--
-- Status constraint: all job tables use the same five-value check.
-- Advisory locks in the inline code prevent concurrent DDL races.
-- Those locks are not reproducible in a migration tool context — the tool
-- itself provides serialization by running one migration at a time.

-- ──────────────────────────────────────────────────────────────────────────────
-- Crawl jobs
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS axon_crawl_jobs (
    id          UUID        PRIMARY KEY,
    url         TEXT        NOT NULL,
    status      TEXT        NOT NULL
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'canceled')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_text  TEXT,
    result_json JSONB,
    config_json JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_axon_crawl_jobs_status
    ON axon_crawl_jobs(status);

CREATE INDEX IF NOT EXISTS idx_axon_crawl_jobs_pending
    ON axon_crawl_jobs(created_at ASC)
    WHERE status = 'pending';

-- ──────────────────────────────────────────────────────────────────────────────
-- Extract jobs
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS axon_extract_jobs (
    id          UUID        PRIMARY KEY,
    status      TEXT        NOT NULL
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'canceled')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_text  TEXT,
    urls_json   JSONB       NOT NULL,
    result_json JSONB,
    config_json JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_axon_extract_jobs_pending
    ON axon_extract_jobs(created_at ASC)
    WHERE status = 'pending';

-- ──────────────────────────────────────────────────────────────────────────────
-- Embed jobs
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS axon_embed_jobs (
    id          UUID        PRIMARY KEY,
    status      TEXT        NOT NULL
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'canceled')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_text  TEXT,
    input_text  TEXT        NOT NULL,
    result_json JSONB,
    config_json JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_axon_embed_jobs_pending
    ON axon_embed_jobs(created_at ASC)
    WHERE status = 'pending';

-- ──────────────────────────────────────────────────────────────────────────────
-- Ingest jobs (github / reddit / youtube)
-- Note: uses source_type + target instead of url/urls_json
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS axon_ingest_jobs (
    id          UUID        PRIMARY KEY,
    status      TEXT        NOT NULL
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'canceled')),
    source_type TEXT        NOT NULL,
    target      TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_text  TEXT,
    result_json JSONB,
    config_json JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_axon_ingest_jobs_pending
    ON axon_ingest_jobs(created_at ASC)
    WHERE status = 'pending';

-- ──────────────────────────────────────────────────────────────────────────────
-- Refresh jobs
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS axon_refresh_jobs (
    id          UUID        PRIMARY KEY,
    status      TEXT        NOT NULL
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'canceled')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_text  TEXT,
    urls_json   JSONB       NOT NULL,
    result_json JSONB,
    config_json JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_axon_refresh_jobs_pending
    ON axon_refresh_jobs(created_at ASC)
    WHERE status = 'pending';

-- ──────────────────────────────────────────────────────────────────────────────
-- Refresh targets (ETags / last-modified state for conditional GET)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS axon_refresh_targets (
    url             TEXT        PRIMARY KEY,
    etag            TEXT,
    last_modified   TEXT,
    content_hash    TEXT,
    markdown_chars  INTEGER,
    last_status     INTEGER,
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_changed_at TIMESTAMPTZ,
    error_text      TEXT
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Refresh schedules (periodic re-crawl configuration)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS axon_refresh_schedules (
    id             UUID        PRIMARY KEY,
    name           TEXT        NOT NULL UNIQUE,
    seed_url       TEXT,
    urls_json      JSONB,
    every_seconds  BIGINT      NOT NULL,
    enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    next_run_at    TIMESTAMPTZ NOT NULL,
    last_run_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_axon_refresh_schedules_due
    ON axon_refresh_schedules(next_run_at ASC)
    WHERE enabled = TRUE;

-- ──────────────────────────────────────────────────────────────────────────────
-- Session ingest state (deduplication tracker for AI session export files)
-- Source: crates/ingest/sessions.rs SessionStateTracker::new()
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS axon_session_ingest_state (
    file_path     TEXT        PRIMARY KEY,
    last_modified TIMESTAMPTZ NOT NULL,
    file_size     BIGINT      NOT NULL,
    indexed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
