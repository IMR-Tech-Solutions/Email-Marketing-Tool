"""Manage dashboard accounts.

    python scripts/manage_user.py list
    python scripts/manage_user.py set <username> <password>   # create or reset
    python scripts/manage_user.py disable <username>
    python scripts/manage_user.py enable <username>
    python scripts/manage_user.py delete <username>

Run from the Backend directory with the virtualenv active.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.auth import get_user_by_username  # noqa: E402
from app.db import create_tables, get_sessionmaker  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password  # noqa: E402


async def cmd_list() -> int:
    async with get_sessionmaker()() as session:
        users = (await session.execute(select(User).order_by(User.username))).scalars().all()

    if not users:
        print("No accounts yet. Create one with:  manage_user.py set <username> <password>")
        return 0

    print(f"{'USERNAME':<24} {'ACTIVE':<8} LAST LOGIN")
    for user in users:
        last = user.last_login_at.strftime("%Y-%m-%d %H:%M") if user.last_login_at else "never"
        print(f"{user.username:<24} {str(user.is_active):<8} {last}")
    return 0


async def cmd_set(username: str, password: str) -> int:
    async with get_sessionmaker()() as session:
        user = await get_user_by_username(session, username)

        if user is None:
            session.add(User(username=username.strip(), password_hash=hash_password(password)))
            action = "Created"
        else:
            user.password_hash = hash_password(password)
            user.is_active = True
            action = "Updated"

        await session.commit()

    print(f"{action} account {username!r}.")
    return 0


async def _set_active(username: str, active: bool) -> int:
    async with get_sessionmaker()() as session:
        user = await get_user_by_username(session, username)
        if user is None:
            print(f"No such account: {username!r}")
            return 1
        user.is_active = active
        await session.commit()

    print(f"{'Enabled' if active else 'Disabled'} account {username!r}.")
    return 0


async def cmd_delete(username: str) -> int:
    async with get_sessionmaker()() as session:
        user = await get_user_by_username(session, username)
        if user is None:
            print(f"No such account: {username!r}")
            return 1
        await session.delete(user)
        await session.commit()

    print(f"Deleted account {username!r}.")
    return 0


async def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1

    await create_tables()
    command, args = argv[0], argv[1:]

    if command == "list":
        return await cmd_list()
    if command == "set" and len(args) == 2:
        return await cmd_set(*args)
    if command == "disable" and len(args) == 1:
        return await _set_active(args[0], False)
    if command == "enable" and len(args) == 1:
        return await _set_active(args[0], True)
    if command == "delete" and len(args) == 1:
        return await cmd_delete(args[0])

    print(__doc__)
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
