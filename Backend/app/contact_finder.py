"""Finding an email address for a contact - and saying how sure it is.

The discovery agent is deliberately given no email field, because a model with
no contact database can only produce a plausible-looking guess, and the next
thing this app does with an address is send real mail to it. So addresses come
from here instead, and every one arrives with its provenance attached:

  hunter     looked up in a maintained contact database, with that database's
             own confidence score and verification status.
  pattern    derived from the company domain and the person's name. This is a
             GUESS about the shape of their addressing scheme, and it is only
             worth anything once the mail server has confirmed it.

Nothing in this module writes to the database. It returns candidates, a person
picks one, and the existing PATCH endpoint is still the only way an address is
stored - see routers/companies.py.

WHY VERIFICATION MATTERS. Sending to guessed addresses is how a sending domain
gets burned: hard bounces are the single strongest spam signal there is, and a
handful of them costs you deliverability for every legitimate send afterwards.
So a candidate that could not be checked is labelled as such, never promoted.
"""

from __future__ import annotations

import asyncio
import logging
import random
import string
from dataclasses import dataclass
from typing import Literal

import aiosmtplib
import dns.asyncresolver
import dns.exception
import httpx

from .config import Settings

logger = logging.getLogger("salesos.finder")

# What the mail server told us about one address.
VerifyStatus = Literal[
    "verified",     # the server accepted the recipient: the mailbox exists
    "rejected",     # the server refused it: the mailbox does not exist
    "accepts_all",  # catch-all domain - it accepts anything, so this proves nothing
    "unverified",   # the domain takes mail, but we could not check this mailbox
    "no_mx",        # the domain has no mail server at all
]

HUNTER_ENDPOINT = "https://api.hunter.io/v2/email-finder"

# Corporate addressing schemes, ordered by how common they are in the wild.
# The score is a prior on the *pattern*, before the mail server says anything.
PATTERNS: tuple[tuple[str, int], ...] = (
    ("{first}.{last}", 55),
    ("{f}{last}", 45),
    ("{first}", 35),
    ("{first}{last}", 30),
    ("{first}_{last}", 22),
    ("{first}{l}", 20),
)

# A probe has to identify itself as coming from somewhere deliverable, or a
# lot of servers will refuse to answer. Overridden with a real mailbox address
# when the workspace has one connected.
FALLBACK_PROBE_SENDER = "postmaster@localhost"

# Kept deliberately short. When port 25 is blocked - which it is on most home
# and office connections - every probe hits this, and six of them in series is
# a request that looks hung.
PROBE_TIMEOUT_SECONDS = 6.0


@dataclass
class EmailCandidate:
    """One possible address, and everything known about how good it is."""

    email: str
    source: Literal["hunter", "pattern"]
    confidence: int
    status: VerifyStatus
    detail: str = ""


@dataclass
class FindResult:
    domain: str
    candidates: list[EmailCandidate]
    # Why the list looks the way it does - shown verbatim in the UI, because
    # "nothing found" and "could not check" are very different answers.
    note: str = ""
    mailServerReachable: bool = False


class FinderError(RuntimeError):
    """Raised when a lookup cannot be attempted at all."""


def normalise_domain(value: str) -> str:
    """'https://www.Northgate.co.uk/about' -> 'northgate.co.uk'."""
    domain = value.strip().lower()
    for scheme in ("https://", "http://"):
        if domain.startswith(scheme):
            domain = domain[len(scheme):]
    domain = domain.split("/", 1)[0].split("?", 1)[0]
    if domain.startswith("www."):
        domain = domain[4:]
    return domain.strip(". ")


def _slug(value: str) -> str:
    """Keep letters only, folded to ASCII-ish lowercase. 'Priya  Raval' -> 'priya'."""
    return "".join(ch for ch in value.lower() if ch in string.ascii_lowercase)


def split_name(full_name: str) -> tuple[str, str]:
    """Best-effort first/last split. Middle names go to neither."""
    parts = [p for p in full_name.replace(".", " ").split() if p]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return _slug(parts[0]), ""
    return _slug(parts[0]), _slug(parts[-1])


def pattern_candidates(first: str, last: str, domain: str) -> list[EmailCandidate]:
    """The addresses this person would have under each common scheme."""
    if not first or not domain:
        return []

    out: list[EmailCandidate] = []
    seen: set[str] = set()
    for template, prior in PATTERNS:
        local = template.format(
            first=first, last=last, f=first[:1], l=last[:1] if last else ""
        )
        # Templates that need a surname collapse into ones we already have.
        if not last and ("{last}" in template or "{l}" in template):
            continue
        local = local.strip("._")
        if not local or local in seen:
            continue
        seen.add(local)
        out.append(
            EmailCandidate(
                email=f"{local}@{domain}",
                source="pattern",
                confidence=prior,
                status="unverified",
                detail="Guessed from the domain. Unconfirmed until the mail server answers.",
            )
        )
    return out


class ContactFinder:
    """Hunter first where it is configured, then pattern guessing, then the
    mail server gets the final word on all of it."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def hunter_configured(self) -> bool:
        return bool(self._settings.hunter_api_key)

    # ------------------------------------------------------------------
    # Hunter
    # ------------------------------------------------------------------

    async def _hunter(self, first: str, last: str, domain: str) -> EmailCandidate | None:
        """One email-finder lookup. Returns None when Hunter has no answer."""
        params = {
            "domain": domain,
            "first_name": first,
            "last_name": last,
            "api_key": self._settings.hunter_api_key,
        }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(HUNTER_ENDPOINT, params=params)
        except httpx.HTTPError as exc:
            logger.warning("[Hunter] unreachable: %s", exc)
            return None

        if response.status_code == 401:
            raise FinderError("Hunter rejected the API key. Check HUNTER_API_KEY in Backend/.env.")
        if response.status_code == 429:
            raise FinderError("Hunter rate limit or monthly quota reached.")
        if response.status_code >= 400:
            logger.warning("[Hunter] returned %s", response.status_code)
            return None

        data = (response.json() or {}).get("data") or {}
        email = (data.get("email") or "").strip().lower()
        if not email:
            return None

        # Hunter's own score, and its own verification verdict where it has one.
        score = int(data.get("score") or 0)
        verification = (data.get("verification") or {}).get("status") or ""
        sources = len(data.get("sources") or [])

        detail = f"Hunter score {score}"
        if verification:
            detail += f", verification '{verification}'"
        if sources:
            detail += f", seen on {sources} public page{'s' if sources != 1 else ''}"

        return EmailCandidate(
            email=email,
            source="hunter",
            confidence=score,
            status="verified" if verification == "valid" else "unverified",
            detail=detail,
        )

    # ------------------------------------------------------------------
    # The mail server
    # ------------------------------------------------------------------

    async def _mx_host(self, domain: str) -> str | None:
        try:
            answer = await dns.asyncresolver.resolve(domain, "MX")
        except (dns.exception.DNSException, ValueError):
            return None
        hosts = sorted((r.preference, str(r.exchange).rstrip(".")) for r in answer)
        return hosts[0][1] if hosts else None

    async def _probe(
        self, host: str, sender: str, recipients: list[str]
    ) -> dict[str, bool | None]:
        """Ask the mail server whether it would accept each recipient.

        RCPT TO with no DATA: nothing is delivered and no message is sent. True
        means accepted, False refused, None means the server would not say.

        One connection for all of them, and the whole thing is abandoned the
        moment the connection itself fails - on a blocked port that is the
        difference between one timeout and six.
        """
        results: dict[str, bool | None] = {r: None for r in recipients}
        smtp = aiosmtplib.SMTP(hostname=host, port=25, timeout=PROBE_TIMEOUT_SECONDS)
        try:
            await smtp.connect()
            await smtp.ehlo()
            await smtp.mail(sender)
            for recipient in recipients:
                try:
                    code, _ = await smtp.rcpt(recipient)
                    results[recipient] = 200 <= code < 300
                except aiosmtplib.SMTPRecipientRefused:
                    results[recipient] = False
                except aiosmtplib.SMTPException:
                    results[recipient] = None
        except (aiosmtplib.SMTPException, OSError, asyncio.TimeoutError) as exc:
            logger.info("[Probe] %s unreachable on port 25: %s", host, type(exc).__name__)
            return results
        finally:
            try:
                await smtp.quit()
            except Exception:  # noqa: BLE001 - closing a dead socket is not news
                pass
        return results

    # ------------------------------------------------------------------
    # The whole lookup
    # ------------------------------------------------------------------

    async def find(
        self, *, full_name: str, domain: str, probe_sender: str = ""
    ) -> FindResult:
        domain = normalise_domain(domain)
        if not domain:
            raise FinderError(
                "This client has no website domain, so there is nothing to search. "
                "Add one, or type the address in by hand."
            )

        first, last = split_name(full_name)
        if not first:
            raise FinderError("That contact has no usable name to search on.")

        candidates: list[EmailCandidate] = []
        notes: list[str] = []

        if self.hunter_configured:
            hit = await self._hunter(first, last, domain)
            if hit is not None:
                candidates.append(hit)
            else:
                notes.append("Hunter had no address on file for this person.")
        else:
            notes.append(
                "Hunter is not configured, so these are pattern guesses only. "
                "Add HUNTER_API_KEY to Backend/.env for looked-up addresses."
            )

        known = {c.email for c in candidates}
        candidates += [
            c for c in pattern_candidates(first, last, domain) if c.email not in known
        ]

        # Now let the mail server settle it.
        mx = await self._mx_host(domain)
        if mx is None:
            for c in candidates:
                c.status = "no_mx"
                c.confidence = 0
            notes.append(
                f"{domain} publishes no mail server, so no address there can receive mail."
            )
            return FindResult(domain=domain, candidates=candidates, note=" ".join(notes))

        # A catch-all domain accepts everything, which would make every guess
        # look confirmed. Ask about an address nobody could own, first.
        canary = "".join(random.choices(string.ascii_lowercase, k=18)) + f"@{domain}"
        verdicts = await self._probe(
            mx, probe_sender or FALLBACK_PROBE_SENDER, [canary] + [c.email for c in candidates]
        )

        reachable = any(v is not None for v in verdicts.values())
        catch_all = verdicts.get(canary) is True

        if not reachable:
            notes.append(
                f"Could not reach {mx} on port 25 to confirm any of these - outbound "
                "port 25 is blocked on most home and office connections. The domain "
                "does accept mail; the individual mailboxes are unconfirmed."
            )
        elif catch_all:
            notes.append(
                f"{domain} is a catch-all: it accepts mail to any address, so the "
                "server cannot tell you which of these is real."
            )

        for c in candidates:
            verdict = verdicts.get(c.email)
            if not reachable:
                c.status = "unverified"
            elif catch_all:
                c.status = "accepts_all"
            elif verdict is True:
                c.status = "verified"
                c.confidence = max(c.confidence, 90)
                c.detail = "The mail server confirmed this mailbox exists."
            elif verdict is False:
                c.status = "rejected"
                c.confidence = 0
                c.detail = "The mail server says this mailbox does not exist."

        # Best answer first; a rejected address sinks to the bottom.
        candidates.sort(key=lambda c: (c.status == "rejected", -c.confidence))

        return FindResult(
            domain=domain,
            candidates=candidates,
            note=" ".join(notes),
            mailServerReachable=reachable,
        )
