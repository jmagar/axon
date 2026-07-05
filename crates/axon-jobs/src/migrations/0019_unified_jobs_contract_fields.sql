ALTER TABLE jobs ADD COLUMN auth_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(auth_snapshot_json));
ALTER TABLE jobs ADD COLUMN config_snapshot_id TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN stage_plan_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(stage_plan_json));
ALTER TABLE jobs ADD COLUMN requirements_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(requirements_json));
ALTER TABLE jobs ADD COLUMN result_schema TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json));
ALTER TABLE jobs ADD COLUMN last_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0);

CREATE INDEX idx_axon_jobs_status_kind_updated
    ON jobs(status, kind, updated_at DESC, job_id DESC);
CREATE INDEX idx_axon_jobs_source_status_updated
    ON jobs(source_id, status, updated_at DESC, job_id DESC);
CREATE INDEX idx_axon_jobs_watch_status_updated
    ON jobs(watch_id, status, updated_at DESC, job_id DESC);
CREATE INDEX idx_axon_job_events_job_sequence
    ON job_events(job_id, sequence);
CREATE INDEX idx_axon_job_events_job_severity_sequence
    ON job_events(job_id, severity, sequence);
CREATE INDEX idx_axon_job_attempts_job_attempt
    ON job_attempts(job_id, attempt);
CREATE INDEX idx_axon_job_stages_job_stage
    ON job_stages(job_id, stage_id);
