"""Mailbox connections: connect, test, and enforce the daily send ceiling."""

from __future__ import annotations

import logging
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import Settings, get_settings
from ..crypto import DecryptionError, decrypt_secret, encrypt_secret, mask
from ..db import get_session
from ..email_service import MailboxCredentials, MailboxError, test_connection
from ..models import Mailbox, User
from ..schemas import (
    MailboxCreateRequest,
    MailboxListResponse,
    MailboxOut,
    MailboxUpdateRequest,
)

logger = logging.getLogger("salesos.mailboxes")

router = APIRouter(prefix="/api/mailboxes", tags=["mailboxes"])


def roll_send_window(mailbox: Mailbox) -> None:
    """Reset today's counter when the date has moved on."""
    today = date.today()
    if mailbox.send_window_date != today:
        mailbox.send_window_date = today
        mailbox.sent_today = 0


def remaining_today(mailbox: Mailbox) -> int:
    roll_send_window(mailbox)
    if not mailbox.is_active or mailbox.status != "connected":
        return 0
    return max(0, mailbox.daily_limit - mailbox.sent_today)


def credentials_for(mailbox: Mailbox, settings: Settings) -> MailboxCredentials:
    return MailboxCredentials(
        address=mailbox.address,
        display_name=mailbox.display_name,
        smtp_host=mailbox.smtp_host,
        smtp_port=mailbox.smtp_port,
        imap_host=mailbox.imap_host,
        imap_port=mailbox.imap_port,
        username=mailbox.username,
        password=decrypt_secret(mailbox.password_encrypted, settings.session_secret),
    )


def to_schema(mailbox: Mailbox) -> MailboxOut:
    return MailboxOut(
        id=str(mailbox.id),
        address=mailbox.address,
        displayName=mailbox.display_name,
        smtpHost=mailbox.smtp_host,
        smtpPort=mailbox.smtp_port,
        imapHost=mailbox.imap_host,
        imapPort=mailbox.imap_port,
        username=mailbox.username,
        passwordMask=mask("app-password"),
        dailyLimit=mailbox.daily_limit,
        sentToday=mailbox.sent_today,
        remainingToday=remaining_today(mailbox),
        isActive=mailbox.is_active,
        status=mailbox.status,  # type: ignore[arg-type]
        statusDetail=mailbox.status_detail,
        lastSyncAt=mailbox.last_sync_at.isoformat() if mailbox.last_sync_at else None,
    )


async def _load(session: AsyncSession, mailbox_id: str) -> Mailbox:
    try:
        parsed = uuid.UUID(mailbox_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Mailbox not found.") from None

    mailbox = await session.get(Mailbox, parsed)
    if mailbox is None:
        raise HTTPException(status_code=404, detail="Mailbox not found.")
    return mailbox


@router.get("", response_model=MailboxListResponse)
async def list_mailboxes(
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> MailboxListResponse:
    result = await session.execute(select(Mailbox).order_by(Mailbox.created_at))
    mailboxes = list(result.scalars().all())
    await session.commit()  # persist any send-window rollovers

    items = [to_schema(m) for m in mailboxes]
    return MailboxListResponse(
        mailboxes=items,
        totalRemainingToday=sum(m.remainingToday for m in items),
    )


@router.post("", response_model=MailboxOut, status_code=201)
async def create_mailbox(
    payload: MailboxCreateRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    _user: User = Depends(get_current_user),
) -> MailboxOut:
    """Connect a mailbox. The credentials are verified before anything is saved.

    Both directions are tested: a mailbox that can send but not read is worse
    than one that does neither, because replies would vanish silently.
    """
    existing = await session.scalar(
        select(Mailbox).where(Mailbox.address == payload.address.strip().lower())
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="That mailbox is already connected.")

    creds = MailboxCredentials(
        address=payload.address.strip().lower(),
        display_name=payload.displayName.strip(),
        smtp_host=payload.smtpHost.strip(),
        smtp_port=payload.smtpPort,
        imap_host=payload.imapHost.strip(),
        imap_port=payload.imapPort,
        username=payload.username.strip(),
        password=payload.password,
    )

    try:
        await test_connection(creds)
    except MailboxError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    mailbox = Mailbox(
        address=creds.address,
        display_name=creds.display_name,
        smtp_host=creds.smtp_host,
        smtp_port=creds.smtp_port,
        imap_host=creds.imap_host,
        imap_port=creds.imap_port,
        username=creds.username,
        password_encrypted=encrypt_secret(payload.password, settings.session_secret),
        daily_limit=payload.dailyLimit,
        status="connected",
        status_detail="Verified over SMTP and IMAP.",
        send_window_date=date.today(),
    )
    session.add(mailbox)
    await session.commit()

    logger.info("[Mailbox] Connected %s", mailbox.address)
    return to_schema(mailbox)


@router.post("/{mailbox_id}/test", response_model=MailboxOut)
async def test_mailbox(
    mailbox_id: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    _user: User = Depends(get_current_user),
) -> MailboxOut:
    mailbox = await _load(session, mailbox_id)

    try:
        await test_connection(credentials_for(mailbox, settings))
    except (MailboxError, DecryptionError) as exc:
        mailbox.status = "error"
        mailbox.status_detail = str(exc)
        await session.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    mailbox.status = "connected"
    mailbox.status_detail = "Verified over SMTP and IMAP."
    await session.commit()
    return to_schema(mailbox)


@router.patch("/{mailbox_id}", response_model=MailboxOut)
async def update_mailbox(
    mailbox_id: str,
    payload: MailboxUpdateRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    _user: User = Depends(get_current_user),
) -> MailboxOut:
    mailbox = await _load(session, mailbox_id)

    if payload.displayName is not None:
        mailbox.display_name = payload.displayName.strip()
    if payload.dailyLimit is not None:
        mailbox.daily_limit = payload.dailyLimit
    if payload.isActive is not None:
        mailbox.is_active = payload.isActive
    if payload.password:
        mailbox.password_encrypted = encrypt_secret(payload.password, settings.session_secret)
        mailbox.status = "untested"
        mailbox.status_detail = "Password changed - test the connection."

    await session.commit()
    return to_schema(mailbox)


@router.delete("/{mailbox_id}", status_code=204)
async def delete_mailbox(
    mailbox_id: str,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> None:
    """Removes the mailbox and its stored messages. The credential goes with it."""
    mailbox = await _load(session, mailbox_id)
    address = mailbox.address
    await session.delete(mailbox)
    await session.commit()
    logger.info("[Mailbox] Removed %s", address)
