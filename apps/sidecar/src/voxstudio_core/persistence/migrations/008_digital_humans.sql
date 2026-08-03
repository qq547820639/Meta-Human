CREATE TABLE digital_humans (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    name TEXT NOT NULL CHECK (length(name) > 0),
    voice_provider_id TEXT,
    avatar_provider_id TEXT,
    voice_id TEXT,
    avatar_id TEXT,
    creation_status TEXT NOT NULL CHECK (
        creation_status IN (
            'pending',
            'building',
            'ready',
            'failed',
            'cancelled'
        )
    ),
    creation_progress TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    error TEXT,
    portrait_path TEXT,
    recording_path TEXT,
    remote_status TEXT,
    UNIQUE (id)
);

CREATE INDEX digital_humans_updated_at
ON digital_humans (updated_at DESC, id DESC);

PRAGMA user_version = 8;