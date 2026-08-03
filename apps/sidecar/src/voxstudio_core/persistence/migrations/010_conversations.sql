CREATE TABLE conversations (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    title TEXT NOT NULL DEFAULT '新对话',
    avatar_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_message_at TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    summary TEXT
);

-- The migration runner tracks applied versions in schema_migrations, so this
-- migration runs exactly once per database and the column is never added twice.
ALTER TABLE conversation_messages
ADD COLUMN conversation_id TEXT;

CREATE INDEX conversations_updated_at
ON conversations (updated_at DESC, id DESC);

CREATE INDEX conversation_messages_conversation_id
ON conversation_messages (conversation_id);

PRAGMA user_version = 10;