ALTER TABLE conversation_messages
ADD COLUMN citations TEXT NOT NULL DEFAULT '';

ALTER TABLE conversation_messages
ADD COLUMN grounded INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 5;
