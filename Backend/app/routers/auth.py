"""Login endpoints."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import authenticate_user, create_access_token, get_current_user
from ..config import Settings, get_settings
from ..db import get_session
from ..models import User
from ..schemas import ChangePasswordRequest, LoginRequest, LoginResponse, SessionResponse
from ..security import PasswordTooLongError, hash_password, verify_password

logger = logging.getLogger("salesos.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> LoginResponse:
    user = await authenticate_user(session, payload.username, payload.password)

    if user is None:
        logger.warning("Failed login attempt for username %r", payload.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
        )

    user.last_login_at = datetime.now(timezone.utc)
    await session.commit()

    token, expires_in = create_access_token(user, settings)
    logger.info("User %r signed in.", user.username)

    return LoginResponse(
        accessToken=token,
        expiresIn=expires_in,
        username=user.username,
        role=user.role,  # type: ignore[arg-type]
    )


@router.get("/me", response_model=SessionResponse)
async def me(user: User = Depends(get_current_user)) -> SessionResponse:
    """Used by the frontend on load to check a stored token is still good."""
    return SessionResponse(username=user.username, role=user.role)  # type: ignore[arg-type]


@router.post("/password", status_code=204)
async def change_password(
    payload: ChangePasswordRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    """Change the signed-in account's own password. Either role.

    The current password is required, so a token lifted from an unlocked
    laptop cannot be turned into a permanent lock-out. An admin who needs to
    reset somebody else goes through Team instead.
    """
    if not verify_password(payload.currentPassword, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The current password is wrong.",
        )
    if payload.currentPassword == payload.newPassword:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The new password is the same as the current one.",
        )
    try:
        user.password_hash = hash_password(payload.newPassword)
    except PasswordTooLongError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await session.commit()
    logger.info("User %r changed their password.", user.username)
