"""Bulk outreach: upload a list, send it paced, watch the replies come back."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import broadcast as bulk
from .. import repository
from ..auth import get_current_user, require_admin
from ..config import Settings, get_settings
from ..db import get_session
from ..models import (
    BroadcastJob,
    BroadcastRecipient,
    BroadcastSend,
    EmailMessage,
    Mailbox,
    User,
)
from ..workspace_settings import effective_signatures
from ..schemas import (
    BrandOut,
    MessageTemplateOut,
    ClearResult,
    ListSource,
    BroadcastJobOut,
    BroadcastReply,
    BroadcastState,
    RecipientOut,
    StartBroadcastRequest,
    UploadResult,
)
from .mailboxes import remaining_today

logger = logging.getLogger("salesos.broadcast")

router = APIRouter(prefix="/api/broadcast", tags=["broadcast"])

# A list is people, not megabytes. Anything larger than this is a data export
# that wandered in by mistake.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024

ACTIVE = ("queued", "running", "cancelling")


def _by_source(recipients) -> dict[str, list]:
    grouped: dict[str, list] = {}
    for r in recipients:
        grouped.setdefault(r.source_file or "(typed in)", []).append(r)
    return grouped


def _job_schema(job: BroadcastJob, mailbox_address: str = "") -> BroadcastJobOut:
    return BroadcastJobOut(
        id=str(job.id),
        brand=job.brand,
        subject=job.subject,
        status=job.status,  # type: ignore[arg-type]
        detail=job.detail,
        total=job.total,
        sent=job.sent,
        skipped=job.skipped,
        failed=job.failed,
        delaySeconds=job.delay_seconds,
        mailbox=mailbox_address,
        createdAt=job.created_at.isoformat() if job.created_at else "",
        finishedAt=job.finished_at.isoformat() if job.finished_at else None,
    )


@router.get("", response_model=BroadcastState)
async def get_state(
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    _user: User = Depends(get_current_user),
) -> BroadcastState:
    """The whole screen: the list, the runs, and anything that replied."""
    # The sign-off under every template, as saved in Settings.
    signatures = await effective_signatures(session, settings)

    recipients = list(
        (await session.execute(select(BroadcastRecipient))).scalars().all()
    )
    # Who owns each shared address, so a row can name the contact mailed in
    # its place rather than just saying "duplicate".
    owner_names = {
        r.id: (r.name or r.email) for r in recipients
    }
    addresses = {r.email.lower() for r in recipients}

    # Anything inbound from someone on the list. Matching on address rather
    # than on a stored thread id means a reply still lands here when they
    # answer from a different device or start a fresh message.
    replies: list[EmailMessage] = []
    if addresses:
        replies = list(
            (
                await session.execute(
                    select(EmailMessage)
                    .where(
                        EmailMessage.direction == "inbound",
                        func.lower(EmailMessage.from_address).in_(addresses),
                    )
                    .order_by(EmailMessage.sent_at.desc())
                    .limit(200)
                )
            )
            .scalars()
            .all()
        )
    replied_addresses = {m.from_address.lower() for m in replies}

    suppressed = await repository.suppressed_values(session)

    jobs = list(
        (
            await session.execute(
                select(BroadcastJob).order_by(BroadcastJob.created_at.desc()).limit(20)
            )
        )
        .scalars()
        .all()
    )
    mailbox_names = {
        row[0]: row[1]
        for row in (await session.execute(select(Mailbox.id, Mailbox.address))).all()
    }

    active = next((j for j in jobs if j.status in ACTIVE), None)

    # Who is next, in the order they would actually be mailed. Showing this is
    # the whole point: "11 to 15, then back to 1" is only trustworthy if you
    # can see it before you press send.
    eligible = [
        r for r in bulk.rotation_order(recipients)
        if r.duplicate_of_id is None and not repository.is_suppressed(r.email, suppressed)
    ]
    # Shown in the order they will actually be mailed, so the table and the
    # send queue never disagree. Shared-address rows sit with their owner.
    ordered = eligible + [
        r for r in bulk.rotation_order(recipients) if r.duplicate_of_id is not None
    ]
    counts = [r.send_count for r in eligible]
    current_round = (min(counts) + 1) if counts else 1

    mailboxes = list(
        (await session.execute(select(Mailbox).where(Mailbox.is_active.is_(True))))
        .scalars()
        .all()
    )
    remaining = sum(remaining_today(m) for m in mailboxes)
    await session.commit()  # remaining_today may roll a stale send window

    return BroadcastState(
        recipients=[
            RecipientOut(
                id=str(r.id),
                email=r.email,
                name=r.name,
                company=r.company,
                title=r.title,
                industry=r.industry,
                location=r.location,
                sourceFile=r.source_file,
                status=r.status,  # type: ignore[arg-type]
                detail=r.detail,
                sendCount=r.send_count,
                sentAt=r.sent_at.isoformat() if r.sent_at else None,
                suppressed=repository.is_suppressed(r.email, suppressed),
                replied=r.email.lower() in replied_addresses,
                sharesAddressWith=(
                    owner_names.get(r.duplicate_of_id) if r.duplicate_of_id else None
                ),
            )
            for r in ordered
        ],
        jobs=[_job_schema(j, mailbox_names.get(j.mailbox_id, "")) for j in jobs],
        replies=[
            BroadcastReply(
                id=str(m.id),
                fromAddress=m.from_address,
                subject=m.subject,
                body=m.body,
                receivedAt=m.sent_at.isoformat() if m.sent_at else "",
                isRead=m.is_read,
                classification=m.classification,  # type: ignore[arg-type]
                classificationReason=m.classification_reason,
            )
            for m in replies
        ],
        brands=[
            BrandOut(
                key=b.key,
                name=b.name,
                site=b.site,
                templates=[
                    MessageTemplateOut(
                        key=t.key,
                        label=t.label,
                        hint=t.hint,
                        subject=t.subject,
                        body=t.body + bulk.signoff(b.key, signatures),
                    )
                    for t in b.templates
                ],
            )
            for b in bulk.BRANDS.values()
        ],
        sources=[
            ListSource(
                fileName=name,
                count=len(rows),
                mailable=sum(1 for r in rows if r.duplicate_of_id is None),
            )
            for name, rows in sorted(_by_source(recipients).items())
        ],
        pending=sum(1 for r in recipients if r.send_count == 0),
        sent=sum(1 for r in recipients if r.send_count > 0),
        eligible=len(eligible),
        currentRound=current_round,
        nextUp=[str(r.id) for r in eligible[:100]],
        remainingToday=remaining,
        mailboxCount=len(mailboxes),
        activeJobId=str(active.id) if active else None,
    )


@router.post("/upload", response_model=UploadResult)
async def upload_list(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(require_admin),
) -> UploadResult:
    """Read a spreadsheet of contacts onto the list.

    Addresses already on the do-not-contact list are counted and dropped here
    rather than imported and skipped later - there is no reason to carry them
    around, and a list that quietly contains people you may not mail is a trap.
    """
    blob = await file.read()
    if not blob:
        raise HTTPException(status_code=400, detail="That file is empty.")
    if len(blob) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"That file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.",
        )

    try:
        parsed = bulk.parse_upload(file.filename or "upload", blob)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - a corrupt workbook is user error
        logger.warning("[Broadcast] could not read %s: %s", file.filename, exc)
        raise HTTPException(
            status_code=400, detail="That file could not be read. Is it a valid spreadsheet?"
        ) from exc

    if not parsed.rows:
        raise HTTPException(
            status_code=400,
            detail="No email addresses found in that file. Check there is a column of addresses.",
        )

    # Two different keys, because they answer two different questions.
    #
    # `owners` maps an address to the contact who holds it, which is what makes
    # a later row with the same address a shared-inbox row rather than a new
    # one. `known` is the full identity of a row, so re-uploading the same file
    # changes nothing instead of doubling the list.
    owners: dict[str, uuid.UUID] = {}
    known: set[tuple[str, str, str]] = set()
    for existing_row in (
        (await session.execute(select(BroadcastRecipient))).scalars().all()
    ):
        address = existing_row.email.lower()
        if existing_row.duplicate_of_id is None:
            owners.setdefault(address, existing_row.id)
        known.add(
            (address, existing_row.name.strip().lower(), existing_row.company.strip().lower())
        )

    suppressed = await repository.suppressed_values(session)

    added = already = blocked = shared = 0
    for row in parsed.rows:
        identity = (row.email, row.name.strip().lower(), row.company.strip().lower())
        if identity in known:
            already += 1
            continue
        if repository.is_suppressed(row.email, suppressed):
            blocked += 1
            continue
        known.add(identity)

        owner = owners.get(row.email)
        recipient = BroadcastRecipient(
            email=row.email,
            name=row.name,
            company=row.company,
            title=row.title,
            industry=row.industry,
            location=row.location,
            source_file=(file.filename or "upload")[:255],
            status="pending",
            duplicate_of_id=owner,
        )
        session.add(recipient)
        await session.flush()  # need the id before it can own an address

        if owner is None:
            owners[row.email] = recipient.id
            added += 1
        else:
            shared += 1

    await session.commit()
    logger.info(
        "[Broadcast] %s: %d mailable, %d sharing an address, %d already listed, "
        "%d suppressed, %d invalid",
        file.filename, added, shared, already, blocked, parsed.skipped_invalid,
    )

    return UploadResult(
        added=added,
        sharedAddress=shared,
        duplicatesInFile=parsed.skipped_duplicate,
        alreadyOnList=already,
        invalid=parsed.skipped_invalid,
        suppressed=blocked,
        truncated=parsed.truncated,
        fileName=file.filename or "upload",
    )


@router.post("/send", response_model=BroadcastJobOut)
async def start_broadcast(
    payload: StartBroadcastRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    _user: User = Depends(require_admin),
) -> BroadcastJobOut:
    """Queue the next N pending recipients and start working through them.

    Returns as soon as the job exists. The sending itself happens in the
    background at the configured pace - twenty-five minutes for a hundred at
    fifteen seconds - and the screen polls this job to watch it.
    """
    running = await session.scalar(
        select(BroadcastJob).where(BroadcastJob.status.in_(ACTIVE)).limit(1)
    )
    if running is not None:
        raise HTTPException(
            status_code=409,
            detail="A send is already running. Wait for it to finish, or cancel it.",
        )

    try:
        mailbox_id = uuid.UUID(payload.mailboxId)
    except ValueError:
        raise HTTPException(status_code=404, detail="Mailbox not found.") from None

    mailbox = await session.get(Mailbox, mailbox_id)
    if mailbox is None:
        raise HTTPException(status_code=404, detail="Mailbox not found.")
    blocked = bulk._blocked_reason(mailbox)
    if blocked:
        raise HTTPException(status_code=400, detail=blocked)

    if payload.brand not in bulk.BRANDS:
        raise HTTPException(status_code=400, detail="Unknown sender profile.")

    suppressed = await repository.suppressed_values(session)
    recipients = await bulk.next_up(session, payload.count, suppressed)
    if not recipients:
        raise HTTPException(
            status_code=400,
            detail="Nobody to send to. Upload a list first.",
        )

    job = BroadcastJob(
        mailbox_id=mailbox.id,
        brand=payload.brand,
        subject=payload.subject,
        body=payload.body,
        status="queued",
        total=len(recipients),
        delay_seconds=payload.delaySeconds,
    )
    session.add(job)
    await session.flush()

    # The batch is fixed here, in the order the screen previewed, and each
    # recipient appears exactly once - that is the "no duplicate mail in one
    # run" guarantee, enforced by construction rather than by checking later.
    for position, recipient in enumerate(recipients):
        session.add(
            BroadcastSend(
                job_id=job.id,
                recipient_id=recipient.id,
                position=position,
                round_number=recipient.send_count + 1,
                status="pending",
            )
        )
    await session.commit()

    # Fire and forget. The task owns its own sessions; nothing below this line
    # depends on it finishing.
    task = asyncio.create_task(bulk.run_job(job.id, settings))
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)

    logger.info(
        "[Broadcast] queued %d recipient(s) as %s, %ds apart, from %s",
        len(recipients), payload.brand, payload.delaySeconds, mailbox.address,
    )
    return _job_schema(job, mailbox.address)


# Holding a reference keeps the loop from garbage-collecting a running task.
_BACKGROUND: set[asyncio.Task] = set()


@router.post("/jobs/{job_id}/cancel", response_model=BroadcastJobOut)
async def cancel_broadcast(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(require_admin),
) -> BroadcastJobOut:
    """Stop after the message in flight. Anything already sent stays sent."""
    try:
        parsed = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Job not found.") from None

    job = await session.get(BroadcastJob, parsed)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.status in ("done", "cancelled", "error", "interrupted"):
        return _job_schema(job)

    job.status = "cancelling"
    await session.commit()
    logger.info("[Broadcast] cancel requested for job %s", job_id)
    return _job_schema(job)


@router.delete("/recipients", response_model=ClearResult)
async def clear_list(
    only: str = Query(default="all", pattern="^(all|pending|sent)$"),
    sourceFile: str = Query(default="", max_length=255),
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(require_admin),
) -> ClearResult:
    """Remove rows from the list. Sent history in the Inbox is untouched.

    The list is the one thing here a person actually built by hand, so this
    reports what it removed rather than returning an empty 204 - and the UI
    asks before calling it.
    """
    running = await session.scalar(
        select(BroadcastJob).where(BroadcastJob.status.in_(ACTIVE)).limit(1)
    )
    if running is not None:
        raise HTTPException(
            status_code=409, detail="A send is running. Cancel it before clearing the list."
        )

    stmt = delete(BroadcastRecipient)
    if sourceFile:
        stmt = stmt.where(BroadcastRecipient.source_file == sourceFile)
    if only == "pending":
        stmt = stmt.where(BroadcastRecipient.send_count == 0)
    elif only == "sent":
        stmt = stmt.where(BroadcastRecipient.send_count > 0)

    result = await session.execute(stmt)
    await session.commit()

    removed = result.rowcount or 0
    remaining = await session.scalar(
        select(func.count()).select_from(BroadcastRecipient)
    )
    logger.info(
        "[Broadcast] removed %d recipient(s) (%s%s), %d left",
        removed, only, f", file={sourceFile}" if sourceFile else "", remaining or 0,
    )
    return ClearResult(removed=removed, remaining=remaining or 0)


@router.get("/export")
async def export(
    fmt: str = Query(default="xlsx", pattern="^(xlsx|docx|pdf|csv)$", alias="format"),
    scope: str = Query(default="recipients", pattern="^(recipients|clients|replies)$"),
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(require_admin),
) -> Response:
    """Download the list, the client book, or the replies as a real file."""
    if scope == "clients":
        title = "Clients and contacts"
        headers = ["Client", "Industry", "Contact", "Title", "Email", "Phone", "LinkedIn", "ICP", "Stage"]
        rows = []
        for company in await repository.list_companies(session):
            if not company.decision_makers:
                rows.append([company.name, company.industry, "", "", "", "", "", company.icp_score, company.stage])
            for dm in company.decision_makers:
                rows.append([
                    company.name, company.industry, dm.name, dm.title,
                    dm.email, dm.phone, dm.linkedin, company.icp_score, company.stage,
                ])

    elif scope == "replies":
        title = "Replies"
        addresses = {
            row[0].lower()
            for row in (await session.execute(select(BroadcastRecipient.email))).all()
        }
        headers = ["Email", "Subject", "Classification", "Received", "Message"]
        rows = []
        if addresses:
            messages = (
                await session.execute(
                    select(EmailMessage)
                    .where(
                        EmailMessage.direction == "inbound",
                        func.lower(EmailMessage.from_address).in_(addresses),
                    )
                    .order_by(EmailMessage.sent_at.desc())
                )
            ).scalars().all()
            rows = [
                [
                    m.from_address, m.subject, m.classification or "",
                    m.sent_at.strftime("%Y-%m-%d %H:%M") if m.sent_at else "",
                    " ".join((m.body or "").split())[:400],
                ]
                for m in messages
            ]

    else:
        title = "Outreach list"
        headers = ["Email", "Name", "Company", "Title", "Industry", "Location", "Mailable", "Times emailed", "Status", "Last sent", "Detail", "Source file"]
        recipients = (
            await session.execute(
                select(BroadcastRecipient).order_by(BroadcastRecipient.created_at)
            )
        ).scalars().all()
        rows = [
            [
                r.email, r.name, r.company, r.title, r.industry, r.location,
                "no - shares an address" if r.duplicate_of_id else "yes",
                r.send_count, r.status,
                r.sent_at.strftime("%Y-%m-%d %H:%M") if r.sent_at else "",
                r.detail, r.source_file,
            ]
            for r in recipients
        ]

    if not rows:
        raise HTTPException(status_code=400, detail=f"There is nothing to export for '{scope}'.")

    try:
        blob = bulk.build_export(fmt, title, headers, [[str(c) for c in r] for r in rows])
    except Exception as exc:  # noqa: BLE001
        logger.exception("[Broadcast] export failed")
        raise HTTPException(status_code=500, detail=f"Could not build that file: {exc}") from exc

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    filename = f"salesos-{scope}-{stamp}.{fmt}"
    logger.info("[Broadcast] exported %d row(s) as %s", len(rows), filename)

    return Response(
        content=blob,
        media_type=bulk.EXPORT_MIME[fmt],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
