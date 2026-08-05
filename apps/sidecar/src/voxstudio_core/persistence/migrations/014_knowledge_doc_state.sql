ALTER TABLE knowledge_documents ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;

ALTER TABLE knowledge_documents ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';

ALTER TABLE knowledge_documents ADD COLUMN last_error TEXT;

ALTER TABLE knowledge_documents ADD COLUMN sync_stage TEXT;

ALTER TABLE knowledge_documents ADD COLUMN sync_progress REAL NOT NULL DEFAULT 0;

ALTER TABLE knowledge_documents ADD COLUMN sync_started_at TEXT;

ALTER TABLE knowledge_documents ADD COLUMN sync_finished_at TEXT;

PRAGMA user_version = 14;
