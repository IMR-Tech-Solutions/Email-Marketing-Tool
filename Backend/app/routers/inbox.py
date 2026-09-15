"""The inbox: send outreach, sync replies, triage them, and reply back."""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import repository
from ..agents import AgentError, SalesAgents
from ..auth import get_current_user
from ..config import Settings, get_settings
from ..crypto import DecryptionError
from ..db import get_session
from ..dependencies import get_agents
from ..email_service import MailboxError, fetch_messages, send_message, thread_key_for
from ..signatures import sign
from ..workspace_settings import effective_signatures
from ..models import (
    BroadcastRecipient,
    Company,
    DecisionMaker,
    EmailMessage,
    Mailbox,
    OutreachCampaign,
    User,
)
from ..schemas import (
    CampaignSendPreview,
    OutboxResponse,
    SentMessage,
    CampaignSendResult,
    CampaignSendTarget,
    EmailOut,
    InboxResponse,
    ReplyRequest,
    SendCampaignRequest,
    SendCampaignResponse,
    SendEmailRequest,
    SendEmailResponse,
    SyncResponse,
    ThreadOut,
)
from .mailboxes import credentials_for, remaining_today, roll_send_window

logger = logging.getLogger("salesos.inbox")

router = APIRouter(prefix="/api/inbox", tags=["inbox"])

# Sent mail is its own screen rather than a filter on the inbox: what you want
# to know about a message you sent (did it land, did anyone answer) is a
# different question from what you want to know about one you received.
outbox_router = APIRouter(prefix="/api/outbox", tags=["outbox"])

# The whole history is kept, but the screen only renders a window of it.
OUTBOX_PAGE = 400

# Classes that mean a human should look at the thread.
NEEDS_RESPONSE = {"positive", "referral"}


def to_email_schema(message: EmailMessage, company_name: str | None = None) -> EmailOut:
    return EmailOut(
        id=str(message.id),
        direction=message.direction,  # type: ignore[arg-type]
        subject=message.subject,
        body=message.body,
        fromAddress=message.from_address,
        toAddress=message.to_address,
        sentAt=message.sent_at.isoformat() if message.sent_at else "",
        isRead=message.is_read,
        classification=message.classification,  # type: ignore[arg-type]
        classificationConfidence=message.classification_confidence,
        classificationReason=message.classification_reason,
        companyId=str(message.company_id) if message.company_id else None,
        companyName=company_name,
    )


async def _company_names(session: AsyncSession) -> dict[str, str]:
    result = await session.execute(select(Company.id, Company.name))
    return {str(cid): name for cid, name in result.all()}


async def _match_company(session: AsyncSession, address: str) -> uuid.UUID | None:
    """Link an inbound message to the client it came from.

    An exact match on a stored contact address is authoritative - that address
    was typed by a person and is what we mailed. Only when that misses do we
    fall back to guessing from the domain, which is a hint and nothing more.
    """
    if "@" not in address:
        return None

    normalised = address.strip().lower()

    exact = await session.scalar(
        select(DecisionMaker.company_id).where(
            func.lower(DecisionMaker.email) == normalised
        )
    )
    if exact is not None:
        return exact

    slug = normalised.split("@", 1)[1].split(".")[0]
    if not slug:
        return None

    result = await session.execute(select(Company.id, Company.name))
    for company_id, name in result.all():
        compact = "".join(ch for ch in name.lower() if ch.isalnum())
        if compact and (compact.startswith(slug) or slug.startswith(compact)):
            return company_id
    return None


@router.get("", response_model=InboxResponse)
async def get_inbox(
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> InboxResponse:
    """Every conversation, newest first, grouped into threads."""
    result = await session.execute(select(EmailMessage).order_by(EmailMessage.sent_at))
    messages = list(result.scalars().all())
    names = await _company_names(session)
    mailbox_count = await session.scalar(
        select(Mailbox.id).limit(1)
    )

    grouped: dict[str, list[EmailMessage]] = defaultdict(list)
    for message in messages:
        grouped[message.thread_key].append(message)

    threads: list[ThreadOut] = []
    for key, items in grouped.items():
        items.sort(key=lambda m: m.sent_at or datetime.min.replace(tzinfo=timezone.utc))
        last = items[-1]

        counterparty = (
            last.from_address if last.direction == "inbound" else last.to_address
        )
        company_id = next((m.company_id for m in reversed(items) if m.company_id), None)

        # The latest inbound classification is what the thread is "about".
        inbound = [m for m in items if m.direction == "inbound"]
        classification = inbound[-1].classification if inbound else None

        threads.append(
            ThreadOut(
                threadKey=key,
                subject=items[0].subject or "(no subject)",
                counterparty=counterparty,
                companyId=str(company_id) if company_id else None,
                companyName=names.get(str(company_id)) if company_id else None,
                lastAt=last.sent_at.isoformat() if last.sent_at else "",
                messageCount=len(items),
                unread=sum(1 for m in items if m.direction == "inbound" and not m.is_read),
                classification=classification,  # type: ignore[arg-type]
                # The ball is in our court when they spoke last.
                awaitingReply=last.direction == "inbound",
                messages=[to_email_schema(m, names.get(str(m.company_id))) for m in items],
            )
        )

    threads.sort(key=lambda t: t.lastAt, reverse=True)

    return InboxResponse(
        threads=threads,
        unread=sum(t.unread for t in threads),
        needsResponse=sum(1 for t in threads if t.awaitingReply),
        positive=sum(1 for t in threads if t.classification in NEEDS_RESPONSE),
        mailboxCount=1 if mailbox_count else 0,
    )


async def _spend_send_slot(session: AsyncSession, mailbox: Mailbox) -> None:
    """Check and consume one send from today's allowance.

    Distributing across healthy mailboxes at their configured limits is fine.
    Creating headroom to escape a limit is how domains get burned, so the only
    way past this is to raise the limit deliberately.
    """
    if not mailbox.is_active:
        raise HTTPException(status_code=400, detail="That mailbox is disabled.")
    if mailbox.status != "connected":
        raise HTTPException(
            status_code=400, detail="That mailbox is not verified. Test the connection first."
        )

    roll_send_window(mailbox)
    if mailbox.sent_today >= mailbox.daily_limit:
        raise HTTPException(
            status_code=429,
            detail=(
                f"{mailbox.address} has used its {mailbox.daily_limit} sends for today. "
                "Raise the limit deliberately, or send from another mailbox."
            ),
        )
    mailbox.sent_today += 1


@router.post("/send", response_model=SendEmailResponse)
async def send_email(
    payload: SendEmailRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    _user: User = Depends(get_current_user),
) -> SendEmailResponse:
    """Send one email. Suppression is checked here, at send time."""
    try:
        mailbox_id = uuid.UUID(payload.mailboxId)
    except ValueError:
        raise HTTPException(status_code=404, detail="Mailbox not found.") from None

    mailbox = await session.get(Mailbox, mailbox_id)
    if mailbox is None:
        raise HTTPException(status_code=404, detail="Mailbox not found.")

    # Section M: checked at send time, not at audience build time, so someone
    # who opts out mid-campaign stops receiving mail immediately.
    suppressed = await repository.suppressed_values(session)
    if repository.is_suppressed(payload.toAddress, suppressed):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"{payload.toAddress} is on the do-not-contact list. "
                "This send was blocked."
            ),
        )

    await _spend_send_slot(session, mailbox)

    try:
        creds = credentials_for(mailbox, settings)
        sent = await send_message(
            creds,
            to_address=payload.toAddress,
            subject=payload.subject,
            body=payload.body,
        )
    except (MailboxError, DecryptionError) as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    company_id = None
    if payload.companyId:
        try:
            company_id = uuid.UUID(payload.companyId)
        except ValueError:
            company_id = None

    message = EmailMessage(
        mailbox_id=mailbox.id,
        direction="outbound",
        message_id=sent.message_id,
        thread_key=sent.thread_key,
        from_address=mailbox.address,
        to_address=payload.toAddress,
        subject=payload.subject,
        body=payload.body,
        is_read=True,
        company_id=company_id,
        sent_at=datetime.now(timezone.utc),
    )
    session.add(message)
    await session.commit()

    logger.info("[Inbox] Sent to %s from %s", payload.toAddress, mailbox.address)
    names = await _company_names(session)
    return SendEmailResponse(
        message=to_email_schema(message, names.get(str(company_id)) if company_id else None),
        remainingToday=remaining_today(mailbox),
    )


@router.post("/threads/{thread_key:path}/reply", response_model=SendEmailResponse)
async def reply_to_thread(
    thread_key: str,
    payload: ReplyRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    _user: User = Depends(get_current_user),
) -> SendEmailResponse:
    """Reply in an existing conversation, threaded onto the last message."""
    result = await session.execute(
        select(EmailMessage)
        .where(EmailMessage.thread_key == thread_key)
        .order_by(EmailMessage.sent_at)
    )
    items = list(result.scalars().all())
    if not items:
        raise HTTPException(status_code=404, detail="Thread not found.")

    last = items[-1]
    last_inbound = next((m for m in reversed(items) if m.direction == "inbound"), None)
    recipient = last_inbound.from_address if last_inbound else last.to_address

    try:
        mailbox_id = uuid.UUID(payload.mailboxId)
    except ValueError:
        raise HTTPException(status_code=404, detail="Mailbox not found.") from None

    mailbox = await session.get(Mailbox, mailbox_id)
    if mailbox is None:
        raise HTTPException(status_code=404, detail="Mailbox not found.")

    suppressed = await repository.suppressed_values(session)
    if repository.is_suppressed(recipient, suppressed):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{recipient} is on the do-not-contact list. This reply was blocked.",
        )

    await _spend_send_slot(session, mailbox)

    subject = items[0].subject or ""
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    try:
        sent = await send_message(
            credentials_for(mailbox, settings),
            to_address=recipient,
            subject=subject,
            body=payload.body,
            in_reply_to=last.message_id,
        )
    except (MailboxError, DecryptionError) as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    message = EmailMessage(
        mailbox_id=mailbox.id,
        direction="outbound",
        message_id=sent.message_id,
        in_reply_to=last.message_id,
        thread_key=thread_key,
        from_address=mailbox.address,
        to_address=recipient,
        subject=subject,
        body=payload.body,
        is_read=True,
        company_id=last.company_id,
        sent_at=datetime.now(timezone.utc),
    )
    session.add(message)

    # Answering closes the loop on everything before it.
    for item in items:
        item.is_read = True

    await session.commit()

    names = await _company_names(session)
    return SendEmailResponse(
        message=to_email_schema(message, names.get(str(last.company_id)) if last.company_id else None),
        remainingToday=remaining_today(mailbox),
    )


@outbox_router.get("", response_model=OutboxResponse)
async def get_outbox(
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> OutboxResponse:
    """Everything this workspace has sent, newest first.

    The useful question about a sent message is whether it got an answer, so a
    reply is matched back onto it by thread key and the classification is
    carried across. Names come from whichever side of the app the address is
    known to - a pipeline contact or an uploaded list row - which is also how
    each message is labelled with where it was sent from.
    """
    sent = list(
        (
            await session.execute(
                select(EmailMessage)
                .where(EmailMessage.direction == "outbound")
                .order_by(EmailMessage.sent_at.desc())
            )
        )
        .scalars()
        .all()
    )

    # Which conversations came back, and what the reply was judged to be.
    inbound = (
        await session.execute(
            select(
                EmailMessage.thread_key,
                EmailMessage.from_address,
                EmailMessage.classification,
                EmailMessage.sent_at,
            ).where(EmailMessage.direction == "inbound")
        )
    ).all()
    replied_threads: dict[str, str | None] = {}
    replied_addresses: dict[str, str | None] = {}
    for thread_key, from_address, classification, _ in inbound:
        replied_threads.setdefault(thread_key, classification)
        replied_addresses.setdefault((from_address or "").lower(), classification)

    # Who each address belongs to. Pipeline contacts win over list rows,
    # because a discovered contact carries a company the other may not.
    people: dict[str, tuple[str, str, str]] = {}
    for row in (
        await session.execute(select(BroadcastRecipient.email, BroadcastRecipient.name, BroadcastRecipient.company))
    ).all():
        people[(row[0] or "").lower()] = (row[1] or "", row[2] or "", "bulk")

    contacts = (
        await session.execute(
            select(DecisionMaker.email, DecisionMaker.name, Company.name)
            .join(Company, Company.id == DecisionMaker.company_id)
            .where(DecisionMaker.email != "")
        )
    ).all()
    for email, contact_name, company_name in contacts:
        people[(email or "").lower()] = (contact_name or "", company_name or "", "campaign")

    today = datetime.now(timezone.utc).date()
    messages: list[SentMessage] = []
    replied_count = 0
    sent_today = 0

    for message in sent:
        address = (message.to_address or "").lower()
        name, company, origin = people.get(address, ("", "", "manual"))

        # A message tied to a company row was sent from the pipeline, whatever
        # else that address later turned up in.
        source = "campaign" if message.company_id else origin

        classification = replied_threads.get(message.thread_key)
        did_reply = message.thread_key in replied_threads or address in replied_addresses
        if did_reply:
            replied_count += 1
            if classification is None:
                classification = replied_addresses.get(address)

        if message.sent_at and message.sent_at.date() == today:
            sent_today += 1

        if len(messages) < OUTBOX_PAGE:
            messages.append(
                SentMessage(
                    id=str(message.id),
                    toAddress=message.to_address,
                    recipient=name,
                    company=company,
                    subject=message.subject or "(no subject)",
                    body=message.body or "",
                    sentAt=message.sent_at.isoformat() if message.sent_at else "",
                    fromAddress=message.from_address,
                    source=source,  # type: ignore[arg-type]
                    threadKey=message.thread_key,
                    replied=did_reply,
                    replyClassification=classification,  # type: ignore[arg-type]
                )
            )

    total = len(sent)
    return OutboxResponse(
        messages=messages,
        total=total,
        replied=replied_count,
        sentToday=sent_today,
        replyRate=round(replied_count / total * 100, 1) if total else 0.0,
        truncated=total > OUTBOX_PAGE,
    )


@router.post("/sync", response_model=SyncResponse)
async def sync_inbox(
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    agents: SalesAgents = Depends(get_agents),
    _user: User = Depends(get_current_user),
) -> SyncResponse:
    """Pull new replies, triage them, and act on unsubscribes.

    An unsubscribe is suppressed automatically rather than only logged - that is
    the whole point of reading the mailbox.
    """
    result = await session.execute(select(Mailbox).where(Mailbox.is_active.is_(True)))
    mailboxes = list(result.scalars().all())

    if not mailboxes:
        raise HTTPException(
            status_code=400, detail="No mailbox connected. Add one on the Mailboxes screen."
        )

    fetched = classified = suppressed_count = 0
    total_cost = 0.0
    errors: list[str] = []

    known_ids = {
        row[0]
        for row in (await session.execute(select(EmailMessage.message_id))).all()
        if row[0]
    }
    own_addresses = {m.address.lower() for m in mailboxes}

    for mailbox in mailboxes:
        try:
            messages = await fetch_messages(
                credentials_for(mailbox, settings), since_uid=mailbox.last_seen_uid
            )
        except (MailboxError, DecryptionError) as exc:
            mailbox.status = "error"
            mailbox.status_detail = str(exc)
            errors.append(f"{mailbox.address}: {exc}")
            continue

        for item in messages:
            if item.uid:
                mailbox.last_seen_uid = max(mailbox.last_seen_uid or 0, item.uid)

            # Skip our own sent copies and anything already stored.
            if item.from_address.lower() in own_addresses:
                continue
            if item.message_id and item.message_id in known_ids:
                continue
            if item.message_id:
                known_ids.add(item.message_id)

            company_id = await _match_company(session, item.from_address)

            record = EmailMessage(
                mailbox_id=mailbox.id,
                direction="inbound",
                message_id=item.message_id,
                in_reply_to=item.in_reply_to,
                thread_key=thread_key_for(item.subject, item.from_address),
                from_address=item.from_address,
                to_address=item.to_address or mailbox.address,
                subject=item.subject,
                body=item.body,
                is_read=False,
                company_id=company_id,
                sent_at=item.sent_at,
            )

            # Triage on the small model, then act on the result.
            try:
                triage = await agents.classify_reply(
                    item.subject, item.body, item.from_address
                )
            except AgentError as exc:
                logger.warning("[Inbox] Could not classify a reply: %s", exc)
            else:
                record.classification = triage.output.classification
                record.classification_confidence = triage.output.confidence
                record.classification_reason = triage.output.reason
                classified += 1
                total_cost += float(triage.usage.cost_usd)

                await repository.record_model_call(
                    session,
                    agent=triage.usage.agent,
                    model=triage.usage.model,
                    input_tokens=triage.usage.input_tokens,
                    output_tokens=triage.usage.output_tokens,
                    cost_usd=triage.usage.cost_usd,
                )

                if triage.output.classification == "unsubscribe":
                    added = await repository.add_suppression(
                        session, item.from_address, "unsubscribed", source="inbox"
                    )
                    if added is not None:
                        suppressed_count += 1
                        logger.info(
                            "[Compliance] Auto-suppressed %s from a reply", item.from_address
                        )

            session.add(record)
            fetched += 1

        mailbox.last_sync_at = datetime.now(timezone.utc)
        if not errors:
            mailbox.status = "connected"
            mailbox.status_detail = "Verified over SMTP and IMAP."

    await session.commit()

    logger.info(
        "[Inbox] Sync: %d new, %d classified, %d suppressed, $%.6f",
        fetched, classified, suppressed_count, total_cost,
    )
    return SyncResponse(
        fetched=fetched,
        classified=classified,
        suppressed=suppressed_count,
        costUsd=round(total_cost, 6),
        errors=errors,
    )


@router.post("/threads/{thread_key:path}/read", status_code=204)
async def mark_thread_read(
    thread_key: str,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> None:
    result = await session.execute(
        select(EmailMessage).where(EmailMessage.thread_key == thread_key)
    )
    for message in result.scalars().all():
        message.is_read = True
    await session.commit()


# --------------------------------------------------------------------------
# Bulk campaign send
# --------------------------------------------------------------------------


async def _campaign_targets(
    session: AsyncSession, company_ids: list[uuid.UUID] | None = None
) -> list[CampaignSendTarget]:
    """Every drafted campaign, with whether it can actually be sent and why not.

    The blocking reasons are computed the same way here and at send time, so the
    preview never promises something the send then refuses.
    """
    stmt = select(OutreachCampaign)
    if company_ids is not None:
        stmt = stmt.where(OutreachCampaign.company_id.in_(company_ids))
    campaigns = list((await session.execute(stmt)).scalars().all())
    if not campaigns:
        return []

    company_rows = await session.execute(
        select(Company.id, Company.name, Company.source_icp).where(
            Company.id.in_([c.company_id for c in campaigns])
        )
    )
    names: dict[uuid.UUID, str] = {}
    briefs: dict[uuid.UUID, str] = {}
    for cid, name, icp in company_rows.all():
        names[cid] = name
        briefs[cid] = icp or ""

    contact_rows = await session.execute(
        select(DecisionMaker).where(
            DecisionMaker.id.in_([c.decision_maker_id for c in campaigns])
        )
    )
    contacts = {c.id: c for c in contact_rows.scalars().all()}

    suppressed = await repository.suppressed_values(session)
    signatures = await effective_signatures(session, get_settings())

    # Anyone already emailed should not be emailed the same thing twice.
    sent_rows = await session.execute(
        select(EmailMessage.company_id).where(EmailMessage.direction == "outbound")
    )
    already = {row[0] for row in sent_rows.all() if row[0]}

    targets: list[CampaignSendTarget] = []
    for campaign in campaigns:
        contact = contacts.get(campaign.decision_maker_id)
        email = (contact.email if contact else "") or ""

        reason: str | None = None
        if not email:
            reason = "No email address - add one on the account"
        elif repository.is_suppressed(email, suppressed):
            reason = "On the do-not-contact list"
        elif campaign.company_id in already:
            reason = "Already emailed - reply from the Inbox instead"

        targets.append(
            CampaignSendTarget(
                companyId=str(campaign.company_id),
                company=names.get(campaign.company_id, "Unknown"),
                contact=contact.name if contact else "-",
                email=email,
                subject=campaign.email_subject,
                # Signed here, so the preview shows the exact email that the
                # send will put on the wire - signature and all.
                body=sign(
                    campaign.email_body, briefs.get(campaign.company_id, ""), signatures
                ),
                sendable=reason is None,
                blockedReason=reason,
            )
        )

    targets.sort(key=lambda t: (not t.sendable, t.company))
    return targets


@router.get("/campaign-preview", response_model=CampaignSendPreview)
async def campaign_preview(
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> CampaignSendPreview:
    """What is ready to send, and what is blocked - before anything is sent."""
    targets = await _campaign_targets(session)

    result = await session.execute(select(Mailbox).where(Mailbox.is_active.is_(True)))
    mailboxes = list(result.scalars().all())
    remaining = sum(remaining_today(m) for m in mailboxes)
    await session.commit()

    return CampaignSendPreview(
        targets=targets,
        sendable=sum(1 for t in targets if t.sendable),
        blocked=sum(1 for t in targets if not t.sendable),
        remainingToday=remaining,
    )


@router.post("/send-campaign", response_model=SendCampaignResponse)
async def send_campaign(
    payload: SendCampaignRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    _user: User = Depends(get_current_user),
) -> SendCampaignResponse:
    """Send the drafted outreach to up to ten selected accounts.

    Each one is checked individually and reported individually: a blocked or
    failed recipient never silently disappears, and it never stops the rest.
    """
    try:
        mailbox_id = uuid.UUID(payload.mailboxId)
    except ValueError:
        raise HTTPException(status_code=404, detail="Mailbox not found.") from None

    mailbox = await session.get(Mailbox, mailbox_id)
    if mailbox is None:
        raise HTTPException(status_code=404, detail="Mailbox not found.")

    company_ids: list[uuid.UUID] = []
    for raw in payload.companyIds:
        try:
            company_ids.append(uuid.UUID(raw))
        except ValueError:
            continue
    if not company_ids:
        raise HTTPException(status_code=400, detail="No valid accounts selected.")

    targets = await _campaign_targets(session, company_ids)
    creds = credentials_for(mailbox, settings)

    results: list[CampaignSendResult] = []
    sent = skipped = failed = 0

    for target in targets:
        if not target.sendable:
            skipped += 1
            results.append(
                CampaignSendResult(
                    companyId=target.companyId,
                    company=target.company,
                    email=target.email,
                    status="skipped",
                    detail=target.blockedReason or "Not sendable",
                )
            )
            continue

        # The ceiling is re-checked per message, so a batch stops at the limit
        # rather than blowing through it.
        try:
            await _spend_send_slot(session, mailbox)
        except HTTPException as exc:
            skipped += 1
            results.append(
                CampaignSendResult(
                    companyId=target.companyId,
                    company=target.company,
                    email=target.email,
                    status="skipped",
                    detail=str(exc.detail),
                )
            )
            continue

        try:
            outcome = await send_message(
                creds,
                to_address=target.email,
                subject=target.subject,
                body=target.body,
            )
        except (MailboxError, DecryptionError) as exc:
            mailbox.sent_today = max(0, mailbox.sent_today - 1)
            failed += 1
            results.append(
                CampaignSendResult(
                    companyId=target.companyId,
                    company=target.company,
                    email=target.email,
                    status="failed",
                    detail=str(exc),
                )
            )
            continue

        session.add(
            EmailMessage(
                mailbox_id=mailbox.id,
                direction="outbound",
                message_id=outcome.message_id,
                thread_key=outcome.thread_key,
                from_address=mailbox.address,
                to_address=target.email,
                subject=target.subject,
                body=target.body,
                is_read=True,
                company_id=uuid.UUID(target.companyId),
                sent_at=datetime.now(timezone.utc),
            )
        )

        # Sending is the moment an account stops being just a lead.
        company = await session.get(Company, uuid.UUID(target.companyId))
        if company is not None and company.stage == "lead":
            company.stage = "contacted"

        sent += 1
        results.append(
            CampaignSendResult(
                companyId=target.companyId,
                company=target.company,
                email=target.email,
                status="sent",
                detail=f"Sent to {target.email}",
            )
        )

    await session.commit()
    logger.info("[Campaign] %d sent, %d skipped, %d failed", sent, skipped, failed)

    return SendCampaignResponse(
        sent=sent,
        skipped=skipped,
        failed=failed,
        remainingToday=remaining_today(mailbox),
        results=results,
    )
