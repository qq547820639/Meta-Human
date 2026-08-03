CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    type TEXT NOT NULL DEFAULT 'user_fact',
    content TEXT NOT NULL CHECK (length(content) > 0),
    source_message_id TEXT,
    confidence REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT,
    confirmed_by_user INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_by_user IN (0, 1)),
    sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
    expires_at TEXT,
    conflict_group TEXT
);

CREATE INDEX memory_entries_type
ON memory_entries (type);

CREATE INDEX memory_entries_created_at
ON memory_entries (created_at DESC);

PRAGMA user_version = 11;