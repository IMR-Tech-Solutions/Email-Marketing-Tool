"""AI Sales OS - FastAPI backend.

Serves the agent pipeline consumed by the React frontend in ../frontend, and
persists everything it produces to PostgreSQL.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from starlette.exceptions import HTTPException as StarletteHTTPException

from .auth import seed_initial_user
from .config import get_settings
from .db import create_tables, get_sessionmaker
from .dependencies import get_agents
from .models import User
from .pricing import is_priced
from .routers import (
    auth,
    broadcast,
    companies,
    inbox,
    insights,
    mailboxes,
    pipeline,
    workspace,
    users,
)
from .routers import settings as settings_routes
from .schemas import HealthResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("salesos")

settings = get_settings()


async def _close_orphaned_jobs(session) -> None:
    """Mark bulk sends that were running when the process died.

    The runner lives in this process, so a restart abandons it. Leaving the
    row as "running" would block every future send behind a job that will
    never move, and would tell the screen a send is in flight when it is not.
    """
    from sqlalchemy import update

    from .models import BroadcastJob

    result = await session.execute(
        update(BroadcastJob)
        .where(BroadcastJob.status.in_(("queued", "running", "cancelling")))
        .values(
            status="interrupted",
            detail="The server restarted while this was sending.",
            finished_at=func.now(),
        )
    )
    await session.commit()
    if result.rowcount:
        logger.warning(
            "Marked %d bulk send(s) as interrupted - they were running at shutdown. "
            "Anything still pending can be sent again.",
            result.rowcount,
        )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if not settings.database_configured:
        logger.error(
            "DATABASE_URL is not set - the app cannot start properly. "
            "See Backend/.env.example."
        )
    else:
        await create_tables()
        async with get_sessionmaker()() as session:
            await seed_initial_user(session, settings)
            await _close_orphaned_jobs(session)

    if not settings.claude_configured:
        logger.warning(
            "ANTHROPIC_API_KEY is not set - agent endpoints will fail. "
            "Add your Claude API key to Backend/.env."
        )

    for tier, model in (("large", settings.claude_model_large),
                        ("small", settings.claude_model_small)):
        if not is_priced(model):
            logger.warning(
                "No published price for the %s-tier model %r - cost reporting "
                "will fall back to Opus-tier rates for it.",
                tier, model,
            )

    logger.info(
        "AI Sales OS API ready. Large: %s | Small: %s",
        settings.claude_model_large,
        settings.claude_model_small,
    )
    yield


app = FastAPI(
    title="AI Sales OS API",
    description="Multi-agent sales prospecting pipeline powered by Claude, stored in PostgreSQL.",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# The frontend reads `data.error` from failed responses, so every error is
# normalised into that shape instead of FastAPI's default `detail`.
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": str(exc.detail)},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
    message = first.get("msg", "Invalid request.")
    return JSONResponse(
        status_code=422,
        content={"error": f"{field}: {message}" if field else message},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error")
    return JSONResponse(status_code=500, content={"error": str(exc) or "Internal server error."})


app.include_router(auth.router)
app.include_router(broadcast.router)
app.include_router(companies.router)
app.include_router(insights.router)
app.include_router(mailboxes.router)
app.include_router(inbox.router)
app.include_router(inbox.outbox_router)
app.include_router(workspace.router)
app.include_router(pipeline.router)
app.include_router(users.router)
app.include_router(settings_routes.router)


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    """Public. Reports whether the pieces the app needs are actually wired up."""
    agents = get_agents()

    database_connected = False
    user_count = 0

    if settings.database_configured:
        try:
            async with get_sessionmaker()() as session:
                user_count = await session.scalar(select(func.count()).select_from(User)) or 0
            database_connected = True
        except Exception as exc:
            logger.warning("Health check could not reach the database: %s", exc)

    return HealthResponse(
        modelLarge=agents.model_large,
        modelSmall=agents.model_small,
        claudeConfigured=agents.is_configured,
        databaseConnected=database_connected,
        userCount=user_count,
    )
