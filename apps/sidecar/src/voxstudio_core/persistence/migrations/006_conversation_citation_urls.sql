ALTER TABLE conversation_messages
ADD COLUMN citation_urls TEXT NOT NULL DEFAULT '';

PRAGMA user_version = 6;
