CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(
    content,
    content='knowledge_chunks',
    content_rowid='id',
    tokenize='trigram'
);

CREATE TRIGGER knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
    INSERT INTO knowledge_chunks_fts(rowid, content)
    VALUES (new.id, new.content);
END;

CREATE TRIGGER knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
    INSERT INTO knowledge_chunks_fts(
        knowledge_chunks_fts, rowid, content
    ) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER knowledge_chunks_au AFTER UPDATE OF content ON knowledge_chunks BEGIN
    INSERT INTO knowledge_chunks_fts(
        knowledge_chunks_fts, rowid, content
    ) VALUES ('delete', old.id, old.content);
    INSERT INTO knowledge_chunks_fts(rowid, content)
    VALUES (new.id, new.content);
END;

INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts)
VALUES ('rebuild');

PRAGMA user_version = 7;
