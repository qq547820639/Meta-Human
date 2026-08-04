ALTER TABLE build_jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'new'
CHECK (mode IN ('new', 'rebuild', 'copy'));

ALTER TABLE build_jobs ADD COLUMN staging_voice_id TEXT;

ALTER TABLE build_jobs ADD COLUMN staging_avatar_id TEXT;

PRAGMA user_version = 12;