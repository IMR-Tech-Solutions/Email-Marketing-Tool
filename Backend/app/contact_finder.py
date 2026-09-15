"""Finding an email address for a contact - and saying how sure it is.

The discovery agent is deliberately given no email field, because a model with
no contact database can only produce a plausible-looking guess, and the next
thing this app does with an address is send real mail to it. So addresses come
from here instead, and every one arrives with its provenance attached:

  hunter     looked up in a maintained contact database, with that database's
             own confidence score and verification status.
  website    published by the company on its own site - a mailto: link or an
             address printed on the contact page. Not a guess at all: the
             company put it there to be written to.
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
import re
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

# The pages a company puts its address on, best first. The legal pages at the
# end look like an odd place to look and are among the most reliable: a
# privacy policy has to give a real way to reach the company, so a site that
# hides everything else behind a contact form still prints one there.
CONTACT_PAGES: tuple[str, ...] = (
    "",
    "/contact",
    "/contact-us",
    "/contact-us/",
    "/contactus",
    "/about",
    "/about-us",
    "/get-in-touch",
    "/privacy-policy",
    "/privacy",
    "/terms",
    "/legal",
)

# Enough to find an address without hammering a stranger's web server.
MAX_SCRAPE_REQUESTS = 10

# Stop sweeping once something this good has turned up - a named address or a
# front-door role mailbox. Below it, keep looking for something better.
GOOD_ENOUGH_SCORE = 70

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

# Published, but not a person and not a way in. Mailing these is either
# useless or actively counterproductive.
BLOCKED_MAILBOXES = frozenset(
    {
        "noreply", "no-reply", "donotreply", "do-not-reply", "postmaster",
        "abuse", "unsubscribe", "privacy", "dpo", "legal", "webmaster",
        "hostmaster", "security", "press", "media", "billing", "accounts",
        "invoices", "support", "helpdesk", "servicedesk", "it", "compliance",
        "gdpr", "feedback", "complaints", "newsletter", "subscriptions",
        # Recruiting inboxes, every spelling of them. A sales email to the
        # people who read these goes in the bin, if it is read at all.
        "careers", "career", "jobs", "job", "recruitment", "recruiting",
        "recruit", "hr", "humanresources", "human-resources", "human_resources",
        "talent", "hiring", "apply", "applications", "resume", "resumes", "cv",
    }
)

# Fragments that mark a mailbox as one of the above even with a prefix or
# suffix attached - hr-team@, uk.careers@, jobs2024@.
BLOCKED_FRAGMENTS: tuple[str, ...] = (
    "noreply", "donotreply", "recruit", "career", "humanresource", "talent",
    "hiring", "resume", "privacy", "unsubscribe", "helpdesk", "newsletter",
)

# A company publishes these so that strangers can start a conversation, which
# is exactly what outreach is. Ranked by how likely a reply is to reach a
# person who can buy something.
ROLE_MAILBOX_SCORES: dict[str, int] = {
    "sales": 78,
    "enquiries": 74,
    "inquiries": 74,
    "hello": 72,
    "contact": 72,
    "info": 70,
    "business": 70,
    "marketing": 64,
    "admin": 58,
    "office": 58,
}

# Scraping is a courtesy call on a stranger's web server: few pages, short
# timeout, and it identifies itself.
SCRAPE_TIMEOUT_SECONDS = 10.0
SCRAPE_USER_AGENT = "Mozilla/5.0 (compatible; SalesOS-ContactFinder/1.0)"


def _mailbox(address: str) -> str:
    return address.split("@", 1)[0].lower()


def score_published(address: str, first: str, last: str) -> int | None:
    """How good a published address is for outreach. None means do not use it.

    An address carrying the person's own name beats a shared inbox, and a
    shared inbox meant for enquiries beats one meant for invoices. Anything
    that cannot lead to a conversation is dropped rather than ranked.
    """
    box = _mailbox(address)
    stripped = re.sub(r"[._\-]", "", box)

    if box in BLOCKED_MAILBOXES or stripped in BLOCKED_MAILBOXES:
        return None
    # hr-team@, uk.careers@, jobs_2024@: any part of the mailbox that is a
    # blocked word on its own blocks the whole thing.
    if any(part in BLOCKED_MAILBOXES for part in re.split(r"[._\-]+", box) if part):
        return None
    if any(fragment in stripped for fragment in BLOCKED_FRAGMENTS):
        return None

    # The contact themselves, published by their own employer.
    if first and first in stripped and (not last or last in stripped):
        return 92
    if last and last in stripped:
        return 84

    if box in ROLE_MAILBOX_SCORES:
        return ROLE_MAILBOX_SCORES[box]

    # Somebody else's named address on the contact page. Still a real human
    # at the right company, which beats every guess.
    return 60


def extract_emails(html: str, domain: str) -> list[str]:
    """On-domain addresses printed anywhere in the page, deduplicated."""
    out: list[str] = []
    seen: set[str] = set()
    for hit in EMAIL_RE.findall(html or ""):
        address = hit.lower().strip(".")
        if address.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")):
            continue
        host = address.split("@", 1)[1]
        if host != domain and not host.endswith("." + domain):
            continue
        if address in seen:
            continue
        seen.add(address)
        out.append(address)
    return out


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
    source: Literal["hunter", "website", "pattern"]
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


# Titles the discovery agent routinely writes into a name, and letters people
# put after theirs. Neither is part of anybody's address: left in, "Dr. Amruta
# Deshpande" is looked up as dr.deshpande@ - a guess that is wrong on every
# domain in the world, which is worse than not guessing at all.
HONORIFICS = frozenset(
    {
        "dr", "drs", "mr", "mrs", "ms", "miss", "mx", "prof", "professor",
        "sir", "madam", "shri", "shree", "sri", "smt", "rev", "fr", "capt",
        "col", "maj", "lt", "gen", "eng", "er", "ca", "adv", "hon",
    }
)

SUFFIXES = frozenset(
    {
        "jr", "sr", "ii", "iii", "iv", "phd", "md", "mbbs", "ms", "msc",
        "mba", "cpa", "cfa", "esq", "pe", "bds", "mds", "dds", "do", "rn",
    }
)


def split_name(full_name: str) -> tuple[str, str]:
    """Best-effort first/last split. Middle names go to neither.

    Titles and post-nominals come off first. The research agent writes them
    into names often enough - "Dr." on every clinician it finds - that leaving
    them in poisons every pattern guess for that contact.
    """
    parts = [p for p in full_name.replace(".", " ").split() if p]

    trimmed = list(parts)
    while trimmed and _slug(trimmed[0]) in HONORIFICS:
        trimmed.pop(0)
    while trimmed and _slug(trimmed[-1]) in SUFFIXES:
        trimmed.pop()

    # A name that was nothing but titles is better searched as written.
    parts = trimmed or parts

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


async def domain_resolves(domain: str) -> bool:
    """Does this domain exist on the internet at all?

    An A record or an MX record will do - plenty of real companies park their
    site on one host and their mail on another, and either is proof the domain
    was registered by somebody. Nothing here proves the domain belongs to the
    company that claimed it; it only rules out the one that does not exist.

    Cheap, deterministic and free: a DNS lookup, no model and no API.
    """
    domain = normalise_domain(domain)
    if not domain:
        return False
    for record in ("A", "MX"):
        try:
            await dns.asyncresolver.resolve(domain, record)
            return True
        except (dns.exception.DNSException, ValueError):
            continue
    return False


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
    # The company's own website
    # ------------------------------------------------------------------

    async def _from_website(
        self, first: str, last: str, domain: str
    ) -> list[EmailCandidate]:
        """Addresses the company publishes on its own site.

        This is the source that works when nothing else does: no API key, no
        port 25, and no guessing. A company that prints sales@ on its homepage
        has said in public where to write to it.
        """
        found: dict[str, str] = {}
        headers = {"User-Agent": SCRAPE_USER_AGENT}
        host = domain
        requests = 0

        try:
            async with httpx.AsyncClient(
                headers=headers,
                timeout=SCRAPE_TIMEOUT_SECONDS,
                follow_redirects=True,
            ) as client:
                for path in CONTACT_PAGES:
                    if requests >= MAX_SCRAPE_REQUESTS:
                        break
                    try:
                        response = await client.get(f"https://{host}{path}")
                        requests += 1
                    except httpx.HTTPError:
                        # Some domains only answer on www. Try it once, on the
                        # first failure, then carry on with whichever works.
                        if host == domain:
                            host = f"www.{domain}"
                            try:
                                response = await client.get(f"https://{host}{path}")
                                requests += 1
                            except httpx.HTTPError:
                                host = domain
                                continue
                        else:
                            continue
                    if response.status_code >= 400:
                        continue
                    for address in extract_emails(response.text, domain):
                        found.setdefault(address, path or "/")

                    # Keep sweeping until something worth sending to turns up -
                    # a page that yields only privacy@ has not answered the
                    # question, even though it did return an address.
                    best = max(
                        (score_published(a, first, last) or 0 for a in found),
                        default=0,
                    )
                    if best >= GOOD_ENOUGH_SCORE:
                        break
        except Exception as exc:  # noqa: BLE001 - a site being odd is not news
            logger.info("[Website] %s unreadable: %s", domain, type(exc).__name__)
            return []

        candidates: list[EmailCandidate] = []
        for address, path in found.items():
            score = score_published(address, first, last)
            if score is None:
                continue
            candidates.append(
                EmailCandidate(
                    email=address,
                    source="website",
                    confidence=score,
                    status="unverified",
                    detail=f"Published by {domain} on {path}",
                )
            )
        candidates.sort(key=lambda c: -c.confidence)
        if candidates:
            logger.info(
                "[Website] %s published %d usable address(es)", domain, len(candidates)
            )
        return candidates

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

    async def find_published(
        self, *, full_name: str, domain: str
    ) -> list[EmailCandidate]:
        """Sourced addresses only: published on the site, or found in Hunter.

        No pattern guesses, and no mail-server probe. This is the path used
        when an address may be saved without anyone looking at it first, so
        everything it returns has to have come from somewhere - a template
        filled in with a surname has not.
        """
        domain = normalise_domain(domain)
        first, last = split_name(full_name)
        if not domain or not first:
            return []

        candidates: list[EmailCandidate] = []
        if self.hunter_configured:
            try:
                hit = await self._hunter(first, last, domain)
            except FinderError as exc:
                logger.warning("[Hunter] %s", exc)
                hit = None
            if hit is not None:
                candidates.append(hit)

        known = {c.email for c in candidates}
        candidates += [
            c for c in await self._from_website(first, last, domain)
            if c.email not in known
        ]
        candidates.sort(key=lambda c: -c.confidence)
        return candidates

    def best_guess(self, *, full_name: str, domain: str) -> EmailCandidate | None:
        """The single most likely pattern address. A guess, and labelled one.

        Nothing about this is evidence - it is the most common corporate
        addressing scheme applied to a name. Only ever used where the caller
        has explicitly accepted the bounce risk.
        """
        first, last = split_name(full_name)
        candidates = pattern_candidates(first, last, normalise_domain(domain))
        return candidates[0] if candidates else None

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

        published = await self._from_website(first, last, domain)
        known = {c.email for c in candidates}
        candidates += [c for c in published if c.email not in known]
        if not published:
            notes.append(f"{domain} publishes no usable address on its own site.")

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
            if c.source == "website":
                # Already evidence: the company printed it. The mail server
                # cannot add to that, and on a catch-all it cannot subtract.
                continue
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
