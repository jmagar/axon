CREATE TABLE jobs (
    job_id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    intent TEXT,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    priority TEXT NOT NULL,
    source_id TEXT,
    watch_id TEXT,
    parent_job_id TEXT,
    root_job_id TEXT,
    attempt INTEGER NOT NULL DEFAULT 0,
    counts_json TEXT,
    current_json TEXT,
    heartbeat_json TEXT,
    last_error_json TEXT,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    request_json TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    idempotency_key TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);

CREATE UNIQUE INDEX jobs_idempotency_key_idx
    ON jobs(idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX jobs_status_updated_at_idx ON jobs(status, updated_at);
CREATE INDEX jobs_kind_status_idx ON jobs(kind, status);
CREATE INDEX jobs_source_id_idx ON jobs(source_id);
CREATE INDEX jobs_watch_id_idx ON jobs(watch_id);

CREATE TABLE job_attempts (
    job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL,
    status TEXT NOT NULL,
    worker_id TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    heartbeat_at TEXT,
    error_json TEXT,
    PRIMARY KEY (job_id, attempt)
);

CREATE TABLE job_stages (
    stage_id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    phase TEXT NOT NULL,
    status TEXT NOT NULL,
    required INTEGER NOT NULL,
    provider_requirements_json TEXT NOT NULL DEFAULT '[]',
    counts_json TEXT,
    started_at TEXT,
    completed_at TEXT,
    error_json TEXT
);

CREATE INDEX job_stages_job_id_idx ON job_stages(job_id);

CREATE TABLE job_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    stage_id TEXT,
    phase TEXT NOT NULL,
    status TEXT NOT NULL,
    severity TEXT NOT NULL,
    visibility TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(job_id, sequence)
);

CREATE INDEX job_events_job_sequence_idx ON job_events(job_id, sequence);
CREATE INDEX job_events_job_phase_idx ON job_events(job_id, phase);
CREATE INDEX job_events_job_severity_idx ON job_events(job_id, severity);
CREATE INDEX job_events_job_visibility_idx ON job_events(job_id, visibility);

CREATE TABLE job_heartbeats (
    job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL DEFAULT 0,
    heartbeat_at TEXT NOT NULL,
    heartbeat_json TEXT NOT NULL,
    PRIMARY KEY (job_id, heartbeat_at)
);

CREATE INDEX job_heartbeats_job_id_idx ON job_heartbeats(job_id);
