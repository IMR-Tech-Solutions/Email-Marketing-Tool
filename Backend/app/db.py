"""Database engine, session factory and the declarative base."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings

logger = logging.getLogger("salesos.db")


class Base(DeclarativeBase):
    """Declarative base for every model."""


def _async_url(url: str) -> str:
    """Force the async driver, so a plain postgresql:// URL still works."""
    if url.startswith("postgresql+"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):  # the form some hosts hand out
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to Backend/.env - see .env.example."
        )
    return create_async_engine(
        _async_url(settings.database_url),
        pool_pre_ping=True,  # drop connections the server closed while idle
        pool_size=5,
        max_overflow=5,
        echo=False,
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a session that commits or rolls back."""
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# create_all() creates missing *tables*, never missing *columns*, so a table
# that already exists is left exactly as it was. These are the columns added
# after the first release; ADD COLUMN IF NOT EXISTS makes replaying them free.
# Still the honest stopgap it always was - the day one of these needs a
# backfill or a type change, that is the day for Alembic.
_ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("companies", "website", "VARCHAR(255) NOT NULL DEFAULT ''"),
    ("companies", "headquarters", "VARCHAR(255) NOT NULL DEFAULT ''"),
    ("companies", "founded", "VARCHAR(32) NOT NULL DEFAULT ''"),
    ("companies", "latest_launch", "TEXT NOT NULL DEFAULT ''"),
    ("companies", "products", "TEXT[] NOT NULL DEFAULT '{}'"),
    ("companies", "buying_signals", "TEXT[] NOT NULL DEFAULT '{}'"),
    ("companies", "pain_points", "TEXT[] NOT NULL DEFAULT '{}'"),
    ("decision_makers", "phone", "VARCHAR(64) NOT NULL DEFAULT ''"),
    # Roles arrived after the first accounts. The default is the lesser role;
    # seed_initial_user promotes whoever was here before roles existed.
    ("users", "role", "VARCHAR(20) NOT NULL DEFAULT 'sales'"),
    ("decision_makers", "linkedin_verified", "BOOLEAN NOT NULL DEFAULT false"),
    ("broadcast_recipients", "send_count", "INTEGER NOT NULL DEFAULT 0"),
    ("broadcast_recipients", "location", "VARCHAR(255) NOT NULL DEFAULT ''"),
    ("broadcast_recipients", "duplicate_of_id", "UUID REFERENCES broadcast_recipients(id) ON DELETE SET NULL"),
)

# Columns that were replaced rather than added. broadcast_recipients.job_id
# became broadcast_sends: a recipient belongs to many rounds, not to one job.
_DROPPED_COLUMNS: tuple[tuple[str, str], ...] = (
    ("broadcast_recipients", "job_id"),
)


async def create_tables() -> None:
    """Create anything missing. Fine at this size; swap for Alembic if the
    schema starts changing in ways that need real migrations."""
    from . import models  # noqa: F401  (registers the mappings)

    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for table, column, ddl in _ADDED_COLUMNS:
            await conn.execute(
                text(f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl}')
            )
        for table, column in _DROPPED_COLUMNS:
            await conn.execute(
                text(f'ALTER TABLE {table} DROP COLUMN IF EXISTS {column}')
            )
    logger.info("Database tables are up to date.")
