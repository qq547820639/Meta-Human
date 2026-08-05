ALTER TABLE memory_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'system';

ALTER TABLE memory_entries ADD COLUMN scope TEXT NOT NULL DEFAULT 'global';

ALTER TABLE memory_entries ADD COLUMN scope_id TEXT;

ALTER TABLE memory_entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));

ALTER TABLE memory_entries ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1));

-- Backfill: entries that were explicitly requested to be remembered (or
-- detected as explicit requests) are treated as user-sourced for display.
UPDATE memory_entries SET source = 'user' WHERE type = 'explicit_request';

-- "不再记住此类信息" rules: block future persistence of a given memory type
-- within a scope (global / digital_human / conversation).
CREATE TABLE memory_ignore_rules (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    type TEXT NOT NULL CHECK (length(type) > 0),
    scope TEXT NOT NULL DEFAULT 'global',
    scope_id TEXT,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX memory_ignore_rules_unique
ON memory_ignore_rules (type, scope, scope_id);

CREATE INDEX memory_entries_scope
ON memory_entries (scope, scope_id);

PRAGMA user_version = 15;