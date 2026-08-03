from dataclasses import dataclass

from voxstudio_core.persistence.database import Database


@dataclass(frozen=True, slots=True)
class ConversationMemory:
    summary: str
    created_at: str | None = None


class ConversationMemoryStore:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def load_latest(self) -> ConversationMemory | None:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT summary, created_at
                FROM conversation_memory
                ORDER BY id DESC
                LIMIT 1
                """
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return ConversationMemory(
            summary=row["summary"],
            created_at=row["created_at"],
        )

    async def save(self, *, summary: str) -> None:
        if not summary.strip():
            raise ValueError("memory summary must not be empty")
        async with self._database.transaction() as connection:
            await connection.execute(
                "INSERT INTO conversation_memory (summary) VALUES (?)",
                (summary.strip(),),
            )

    async def clear(self) -> None:
        async with self._database.transaction() as connection:
            await connection.execute("DELETE FROM conversation_memory")
