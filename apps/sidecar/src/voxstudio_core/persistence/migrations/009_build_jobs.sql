CREATE TABLE build_jobs (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    digital_human_id TEXT,
    idempotency_key TEXT,
    current_stage TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN (
            'pending',
            'running',
            'succeeded',
            'failed',
            'cancelling',
            'cancelled',
            'cleanup_pending',
            'cleanup_failed'
        )
    ),
    stage_progress TEXT,
    succeeded_stages TEXT NOT NULL DEFAULT '[]',
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    error_code TEXT,
    error_detail TEXT,
    cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
    portrait_path TEXT,
    recording_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (digital_human_id) REFERENCES digital_humans (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX build_jobs_idempotency_key
ON build_jobs (idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX build_jobs_updated_at
ON build_jobs (updated_at DESC, id DESC);

PRAGMA user_version = 9;