"""Dashboard login, backed by the users table.

A successful login returns a short-lived signed JWT, which the frontend sends
back as `Authorization: Bearer <token>` on every protected call.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings, get_settings
from .db import get_session
from .models import User
from .security import hash_password, verify_password

logger = logging.getLogger("salesos.auth")

ALGORITHM = "HS256"

# auto_error=False so a missing header produces our own 401 shape, not the
# default one, and so the frontend always sees {"error": ...}.
bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_user_by_username(session: AsyncSession, username: str) -> User | None:
    """Case-insensitive lookup, so 'Admin' and 'admin' are the same account."""
    result = await session.execute(
        select(User).where(func.lower(User.username) == username.strip().lower())
    )
    return result.scalar_one_or_none()


async def authenticate_user(
    session: AsyncSession, username: str, password: str
) -> User | None:
    user = await get_user_by_username(session, username)

    if user is None:
        # Hash anyway, so a missing user and a wrong password take the same
        # amount of time and cannot be told apart.
        verify_password(password, "$2b$12$" + "." * 53)
        return None

    if not verify_password(password, user.password_hash):
        return None

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been disabled.",
        )

    return user


def create_access_token(user: User, settings: Settings) -> tuple[str, int]:
    """Return (token, seconds until it expires)."""
    expires_in = settings.session_hours * 3600
    now = datetime.now(timezone.utc)

    token = jwt.encode(
        {
            "sub": str(user.id),
            "username": user.username,
            "role": user.role,
            "iat": now,
            "exp": now + timedelta(seconds=expires_in),
        },
        settings.session_secret,
        algorithm=ALGORITHM,
    )
    return token, expires_in


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> User:
    """FastAPI dependency guarding every protected endpoint."""
    if credentials is None or not credentials.credentials:
        raise _unauthorized("Not signed in.")

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.session_secret,
            algorithms=[ALGORITHM],
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Your session has expired. Please sign in again.") from None
    except jwt.InvalidTokenError:
        raise _unauthorized("Invalid session. Please sign in again.") from None

    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        raise _unauthorized("Invalid session. Please sign in again.") from None

    # Checked against the database every request, so deleting or disabling an
    # account takes effect immediately instead of when the token expires.
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized("This account is no longer active. Please sign in again.")

    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """The guard on everything that spends money, changes configuration or
    manages accounts. A sales executive gets a clear refusal, not a 401."""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an admin can do this.",
        )
    return user


async def _ensure_an_admin(session: AsyncSession, settings: Settings) -> None:
    """Accounts that predate roles were all admins in practice.

    The role column arrives with a default of 'sales', which on an existing
    database would silently lock the only login out of everything it could do
    yesterday. So: if nobody is an admin, the seeded account becomes one - or
    every existing account does, if the seeded name is not among them.
    """
    admins = await session.scalar(
        select(func.count()).select_from(User).where(User.role == "admin")
    )
    if admins:
        return

    seeded = None
    if settings.dashboard_username:
        seeded = await get_user_by_username(session, settings.dashboard_username)
    targets = [seeded] if seeded else list((await session.execute(select(User))).scalars().all())
    for user in targets:
        user.role = "admin"
    await session.commit()
    logger.info(
        "Promoted %d pre-existing account(s) to admin: %s",
        len(targets),
        ", ".join(u.username for u in targets),
    )


async def seed_initial_user(session: AsyncSession, settings: Settings) -> None:
    """Create the first account from .env, only while the table is empty.

    The first account is an admin - it has to be, or nobody could create the
    second one.
    """
    existing = await session.scalar(select(func.count()).select_from(User))
    if existing:
        await _ensure_an_admin(session, settings)
        return

    if not settings.seed_login_configured:
        logger.warning(
            "No users exist and DASHBOARD_PASSWORD is not set - nobody can sign in. "
            "Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD in Backend/.env, or run "
            "scripts/manage_user.py."
        )
        return

    session.add(
        User(
            username=settings.dashboard_username.strip(),
            password_hash=hash_password(settings.dashboard_password),
            role="admin",
        )
    )
    await session.commit()
    logger.info(
        "Seeded the first dashboard account %r from .env. The database is the "
        "source of truth from now on.",
        settings.dashboard_username,
    )
