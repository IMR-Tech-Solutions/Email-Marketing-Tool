"""Real SMTP sending and IMAP reply syncing.

Deliberately plain IMAP/SMTP rather than a provider API: it works with Gmail
app passwords, Microsoft, and any custom domain, with no OAuth app to register.

We are not building an email server. Gmail and Microsoft already run the hard
parts - storage, threading, spam, reputation. What this owns is knowing who the
sender is talking to and why.
"""

from __future__ import annotations

import asyncio
import logging
import re
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage as MimeMessage
from email.utils import formataddr, make_msgid, parseaddr

import aiosmtplib
from imap_tools import AND, MailBox

logger = logging.getLogger("salesos.email")

# Providers that reject plain-text logins are the norm; TLS is not optional.
SMTP_TIMEOUT = 25
IMAP_TIMEOUT = 30

# Quoted history and signature blocks make classification worse and cost more,
# so inbound bodies are trimmed at the first quote marker.
_QUOTE_MARKERS = [
    re.compile(r"^On .{5,120}\bwrote:\s*$", re.MULTILINE),
    re.compile(r"^-{2,}\s*Original Message\s*-{2,}\s*$", re.MULTILINE | re.IGNORECASE),
    re.compile(r"^_{10,}\s*$", re.MULTILINE),
    re.compile(r"^From:\s.+$", re.MULTILINE),
]


class MailboxError(RuntimeError):
    """A mailbox could not be reached, or rejected the credentials."""


@dataclass
class MailboxCredentials:
    address: str
    display_name: str
    smtp_host: str
    smtp_port: int
    imap_host: str
    imap_port: int
    username: str
    password: str


@dataclass
class SentMessage:
    message_id: str
    thread_key: str


@dataclass
class FetchedMessage:
    uid: int
    message_id: str | None
    in_reply_to: str | None
    from_address: str
    to_address: str
    subject: str
    body: str
    sent_at: datetime


def strip_quoted(body: str) -> str:
    """Keep only the newly written part of a reply."""
    cut = len(body)
    for marker in _QUOTE_MARKERS:
        match = marker.search(body)
        if match:
            cut = min(cut, match.start())
    trimmed = body[:cut].strip()
    # A reply that is nothing but quoted history is better shown whole.
    return trimmed or body.strip()


def thread_key_for(subject: str, counterpart: str) -> str:
    """A stable key for grouping a conversation.

    Message-ID chains are authoritative but break the moment a client rewrites
    them, so the fallback is the normalised subject plus the other party.
    """
    normalised = re.sub(r"^(re|fwd|fw)\s*:\s*", "", subject.strip(), flags=re.IGNORECASE)
    normalised = re.sub(r"\s+", " ", normalised).strip().lower()
    return f"{counterpart.strip().lower()}|{normalised}"[:512]


def _auth_hint(creds: MailboxCredentials) -> str:
    """Say which credential is likely wrong, not just that one of them is.

    "Wrong password" is the wrong first guess when the username is a bare word
    like "admin" - that is almost always a browser autofill, and no password
    will ever make it work.
    """
    major = any(h in creds.smtp_host.lower() for h in ("gmail", "googlemail", "office365", "outlook"))

    if major and "@" not in creds.username:
        return (
            f"The mail server rejected the sign-in. {creds.smtp_host} authenticates "
            f"with the full email address, but the username sent was "
            f"{creds.username!r}. Set the username to {creds.address} and try again."
        )
    if major:
        return (
            "The mail server rejected the credentials. Gmail and Microsoft require "
            "an app password, not your account password - and 2-Step Verification "
            "must be on before you can create one."
        )
    return (
        "The mail server rejected the credentials. Check the username and password, "
        "and whether the host requires an app-specific password."
    )


# --------------------------------------------------------------------------
# Sending
# --------------------------------------------------------------------------


async def send_message(
    creds: MailboxCredentials,
    *,
    to_address: str,
    subject: str,
    body: str,
    in_reply_to: str | None = None,
    references: str | None = None,
) -> SentMessage:
    """Send one message over SMTP. Raises MailboxError on any failure."""
    message = MimeMessage()
    message["From"] = formataddr((creds.display_name or creds.address, creds.address))
    message["To"] = to_address
    message["Subject"] = subject

    domain = creds.address.split("@")[-1] if "@" in creds.address else "localhost"
    message_id = make_msgid(domain=domain)
    message["Message-ID"] = message_id

    if in_reply_to:
        message["In-Reply-To"] = in_reply_to
        message["References"] = references or in_reply_to

    message.set_content(body)

    try:
        # 465 is implicit TLS; 587 upgrades with STARTTLS.
        use_tls = creds.smtp_port == 465
        await aiosmtplib.send(
            message,
            hostname=creds.smtp_host,
            port=creds.smtp_port,
            username=creds.username,
            password=creds.password,
            use_tls=use_tls,
            start_tls=not use_tls,
            timeout=SMTP_TIMEOUT,
        )
    except aiosmtplib.SMTPAuthenticationError as exc:
        raise MailboxError(_auth_hint(creds)) from exc
    except (aiosmtplib.SMTPException, OSError, ssl.SSLError, asyncio.TimeoutError) as exc:
        raise MailboxError(f"Could not send: {exc}") from exc

    logger.info("[Email] Sent to %s via %s", to_address, creds.address)
    return SentMessage(
        message_id=message_id,
        thread_key=thread_key_for(subject, to_address),
    )


# --------------------------------------------------------------------------
# Receiving
# --------------------------------------------------------------------------


def _fetch_blocking(creds: MailboxCredentials, since_uid: int | None, limit: int) -> list[FetchedMessage]:
    """imap-tools is synchronous; callers run this in a worker thread."""
    fetched: list[FetchedMessage] = []

    try:
        with MailBox(creds.imap_host, port=creds.imap_port).login(
            creds.username, creds.password
        ) as mailbox:
            criteria = AND(uid=f"{since_uid + 1}:*") if since_uid else AND(all=True)

            for msg in mailbox.fetch(criteria, limit=limit, reverse=not since_uid, bulk=True):
                try:
                    uid = int(msg.uid) if msg.uid else 0
                except (TypeError, ValueError):
                    uid = 0

                if since_uid and uid <= since_uid:
                    continue

                sender = parseaddr(msg.from_ or "")[1] or (msg.from_ or "")
                recipient = parseaddr(msg.to[0] if msg.to else "")[1] or creds.address
                body = (msg.text or msg.html or "").strip()

                sent_at = msg.date or datetime.now(timezone.utc)
                if sent_at.tzinfo is None:
                    sent_at = sent_at.replace(tzinfo=timezone.utc)

                fetched.append(
                    FetchedMessage(
                        uid=uid,
                        message_id=(msg.headers.get("message-id") or (None,))[0],
                        in_reply_to=(msg.headers.get("in-reply-to") or (None,))[0],
                        from_address=sender,
                        to_address=recipient,
                        subject=msg.subject or "(no subject)",
                        body=strip_quoted(body),
                        sent_at=sent_at,
                    )
                )
    except Exception as exc:  # imap_tools raises a wide family
        raise MailboxError(f"Could not read the mailbox: {exc}") from exc

    return fetched


async def fetch_messages(
    creds: MailboxCredentials, since_uid: int | None = None, limit: int = 40
) -> list[FetchedMessage]:
    """Pull recent messages. Blocking IMAP work runs off the event loop."""
    try:
        messages = await asyncio.wait_for(
            asyncio.to_thread(_fetch_blocking, creds, since_uid, limit),
            timeout=IMAP_TIMEOUT * 2,
        )
    except asyncio.TimeoutError as exc:
        raise MailboxError("The mail server did not respond in time.") from exc

    logger.info("[Email] Fetched %d message(s) for %s", len(messages), creds.address)
    return sorted(messages, key=lambda m: m.uid)


# --------------------------------------------------------------------------
# Connection test
# --------------------------------------------------------------------------


def _test_imap_blocking(creds: MailboxCredentials) -> None:
    try:
        with MailBox(creds.imap_host, port=creds.imap_port).login(
            creds.username, creds.password
        ):
            return
    except Exception as exc:
        raise MailboxError(f"IMAP failed: {exc}") from exc


async def test_connection(creds: MailboxCredentials) -> None:
    """Verify both directions before a mailbox is marked usable.

    A mailbox that can send but not read is worse than one that does neither -
    it means replies vanish silently.
    """
    try:
        use_tls = creds.smtp_port == 465
        smtp = aiosmtplib.SMTP(
            hostname=creds.smtp_host,
            port=creds.smtp_port,
            use_tls=use_tls,
            start_tls=not use_tls,
            timeout=SMTP_TIMEOUT,
        )
        await smtp.connect()
        await smtp.login(creds.username, creds.password)
        await smtp.quit()
    except aiosmtplib.SMTPAuthenticationError as exc:
        raise MailboxError(_auth_hint(creds)) from exc
    except (aiosmtplib.SMTPException, OSError, ssl.SSLError, asyncio.TimeoutError) as exc:
        raise MailboxError(f"SMTP failed: {exc}") from exc

    await asyncio.wait_for(asyncio.to_thread(_test_imap_blocking, creds), timeout=IMAP_TIMEOUT * 2)
