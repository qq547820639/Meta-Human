CREATE TABLE knowledge_documents (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    title TEXT NOT NULL CHECK (length(title) > 0),
    source_url TEXT,
    content_hash TEXT NOT NULL CHECK (length(content_hash) > 0),
    synced_at TEXT NOT NULL
);

CREATE TABLE knowledge_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    content TEXT NOT NULL CHECK (length(content) > 0),
    UNIQUE (document_id, position),
    FOREIGN KEY (document_id)
        REFERENCES knowledge_documents (id)
        ON DELETE CASCADE
);

CREATE INDEX knowledge_chunks_document_id
ON knowledge_chunks (document_id, position);

PRAGMA user_version = 2;
