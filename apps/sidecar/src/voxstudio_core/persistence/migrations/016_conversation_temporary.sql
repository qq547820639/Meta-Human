-- "临时对话" mode: a conversation flagged is_temporary never writes into the
-- long-term memory store (its content stays ephemeral).
ALTER TABLE conversations ADD COLUMN is_temporary INTEGER NOT NULL DEFAULT 0 CHECK (is_temporary IN (0, 1));

PRAGMA user_version = 16;