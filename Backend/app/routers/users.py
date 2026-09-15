"""Team accounts - the one place a login is created.

Admin only, every route. A sales executive gets a login from here, never by
signing up, and what that login can reach is decided by `require_admin` on
the routes that spend money, change configuration or manage accounts - see
auth.py. Everything else a rep needs to work a lead is open to both roles.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_user_by_username, require_admin
from ..db import get_session
from ..models import User
from ..schemas import CreateUserRequest, UpdateUserRequest, UserListResponse, UserOut
from ..security import hash_password

logger = logging.getLogger("salesos.users")

router = APIRouter(prefix="/api/users", tags=["users"])


def _out(user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        username=user.username,
        role=user.role,  # type: ignore[arg-type]
        isActive=user.is_active,
        createdAt=user.created_at.isoformat() if user.created_at else None,
        lastLoginAt=user.last_login_at.isoformat() if user.last_login_at else None,
    )


async def _load(session: AsyncSession, user_id: str) -> User:
    try:
        parsed = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="No such account.") from None
    user = await session.get(User, parsed)
    if user is None:
        raise HTTPException(status_code=404, detail="No such account.")
    return user


async def _other_active_admins(session: AsyncSession, user: User) -> int:
    return (
        await session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role == "admin", User.is_active.is_(True), User.id != user.id)
        )
    ) or 0


@router.get("", response_model=UserListResponse)
async def list_users(
    session: AsyncSession = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> UserListResponse:
    users = (await session.execute(select(User).order_by(User.created_at))).scalars().all()
    return UserListResponse(users=[_out(u) for u in users])


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    payload: CreateUserRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> UserOut:
    """Create a login. The password is hashed here and never stored as typed."""
    if await get_user_by_username(session, payload.username) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That username is already taken.",
        )

    user = User(
        username=payload.username.strip(),
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    logger.info("%r created %s account %r", admin.username, user.role, user.username)
    return _out(user)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    payload: UpdateUserRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> UserOut:
    """Reset a password, change a role, or enable/disable an account.

    Two things are refused outright: an admin demoting or disabling their own
    login, and any change that would leave the workspace with no active admin
    at all - there would be nobody left who could undo it.
    """
    user = await _load(session, user_id)
    is_self = user.id == admin.id

    if payload.password:
        user.password_hash = hash_password(payload.password)

    if payload.role is not None and payload.role != user.role:
        if is_self:
            raise HTTPException(status_code=400, detail="You cannot change your own role.")
        user.role = payload.role

    if payload.isActive is not None and payload.isActive != user.is_active:
        if is_self:
            raise HTTPException(
                status_code=400, detail="You cannot disable the account you are signed in with."
            )
        user.is_active = payload.isActive

    losing_admin = user.role != "admin" or not user.is_active
    if losing_admin and await _other_active_admins(session, user) == 0:
        await session.rollback()
        raise HTTPException(
            status_code=400,
            detail="That would leave no active admin. Make someone else an admin first.",
        )

    await session.commit()
    await session.refresh(user)
    logger.info("%r updated account %r", admin.username, user.username)
    return _out(user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> None:
    user = await _load(session, user_id)
    if user.id == admin.id:
        raise HTTPException(
            status_code=400, detail="You cannot delete the account you are signed in with."
        )
    if user.role == "admin" and user.is_active and await _other_active_admins(session, user) == 0:
        raise HTTPException(
            status_code=400,
            detail="That is the only active admin. Make someone else an admin first.",
        )

    await session.delete(user)
    await session.commit()
    logger.info("%r deleted account %r", admin.username, user.username)
