ALTER TABLE build_jobs ADD COLUMN provider TEXT;

ALTER TABLE build_jobs ADD COLUMN remote_resource_id TEXT;

ALTER TABLE build_jobs ADD COLUMN cleanup_state TEXT NOT NULL DEFAULT 'none';

ALTER TABLE build_jobs ADD COLUMN last_error TEXT;

CREATE INDEX build_jobs_digital_human_id
ON build_jobs (digital_human_id, updated_at DESC, id DESC);

PRAGMA user_version = 13;