CREATE TABLE readiness_runs (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    state TEXT NOT NULL CHECK (
        state IN (
            'not_started',
            'pending',
            'checking',
            'ready',
            'degraded',
            'action_required',
            'failed',
            'recovering',
            'stopping'
        )
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE UNIQUE INDEX readiness_runs_single_incomplete
ON readiness_runs ((1))
WHERE completed_at IS NULL;

CREATE TABLE readiness_capabilities (
    run_id TEXT NOT NULL,
    capability_id TEXT NOT NULL CHECK (
        capability_id IN (
            'llm.chat',
            'embedding.text',
            'stt.transcribe',
            'tts.synthesize',
            'voice.enroll',
            'avatar.enroll',
            'avatar.stream'
        )
    ),
    position INTEGER NOT NULL CHECK (position >= 0),
    required INTEGER NOT NULL CHECK (required IN (0, 1)),
    state TEXT NOT NULL CHECK (
        state IN (
            'pending',
            'checking',
            'ready',
            'degraded',
            'action_required',
            'failed'
        )
    ),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    safe_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, capability_id),
    UNIQUE (run_id, position),
    FOREIGN KEY (run_id) REFERENCES readiness_runs (id) ON DELETE CASCADE
);

CREATE TABLE readiness_errors (
    run_id TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    code TEXT NOT NULL CHECK (length(code) > 0),
    message TEXT NOT NULL CHECK (length(message) > 0),
    retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
    recommended_action TEXT,
    PRIMARY KEY (run_id, capability_id),
    FOREIGN KEY (run_id, capability_id)
        REFERENCES readiness_capabilities (run_id, capability_id)
        ON DELETE CASCADE
);

CREATE INDEX readiness_runs_created_at
ON readiness_runs (created_at DESC, id DESC);

PRAGMA user_version = 1;
