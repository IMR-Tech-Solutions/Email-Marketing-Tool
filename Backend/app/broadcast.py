"""Bulk outreach: read a list in, pace the send out, export the result.

Three things live here.

READING A LIST. Spreadsheets from the real world have no agreed shape, so
columns are matched by what their header looks like rather than by position,
and a file that is just a column of addresses with no header still works.

PACING THE SEND. A hundred messages at fifteen seconds apart is twenty-five
minutes, which is not something an HTTP request can hold open. The request
creates a job row and returns; `run_job` works through it in the background
and writes its counters as it goes, so the screen can watch it happen. The
delay is not decoration - a burst of identical mail from one address is the
fastest route into a spam folder, and the daily ceiling and the suppression
list are both re-checked per message rather than once at the start.

EXPORTING. xlsx, docx and pdf of whatever list you are looking at.
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Sequence

from sqlalchemy import func, select

from .config import Settings
from .crypto import DecryptionError
from .db import get_sessionmaker
from .email_service import MailboxError, send_message
from .models import (
    BroadcastJob,
    BroadcastRecipient,
    BroadcastSend,
    EmailMessage,
    Mailbox,
    Suppression,
)

logger = logging.getLogger("salesos.broadcast")

# Cheap sanity check, not RFC 5322. The mail server has the last word anyway.
EMAIL_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$", re.IGNORECASE)

VARIABLE_RE = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")

MAX_RECIPIENTS_PER_JOB = 100
MAX_UPLOAD_ROWS = 5000


# --------------------------------------------------------------------------
# The two businesses these lists get mailed on behalf of
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class MessageTemplate:
    key: str
    label: str
    hint: str
    subject: str
    body: str


@dataclass(frozen=True)
class Brand:
    key: str
    name: str
    site: str
    templates: tuple["MessageTemplate", ...]


# The first angle for each brand is the sender's own copy, used verbatim apart
# from three changes: [First Name] became {{first_name}}, the [Phone]/[Email]/
# [Website] placeholders were filled from each site, and a one-line opt-out was
# added at the end. That last line is not decoration - the reply-triage agent
# auto-suppresses anyone who answers "unsubscribe", so inviting it is what
# keeps the do-not-contact list filling honestly rather than through
# complaints. Delete it if you would rather not have it; nothing else depends
# on it being there.
#
# The shorter angles below each default exist because the rotation comes back
# around: sending somebody the identical message on round two is what gets a
# sending domain reported.

_SIGNOFF_TECH = (
    "\n\nBest regards,\n"
    "Akshay V. Patil\n"
    "Director\n"
    "IMR Tech Solutions\n"
    "+91 91753-37569 | contact@imrtechsolutions.com\n"
    "https://imrtechsolutions.com\n\n"
    'If this isn’t relevant, reply "unsubscribe" and I won’t write again.'
)

_SIGNOFF_RESEARCH = (
    "\n\nBest regards,\n"
    "Akshay V. Patil\n"
    "Business Development Head\n"
    "Introspective Market Research Pvt. Ltd.\n"
    "+91-74101-03736 | sales@introspectivemarketresearch.com\n"
    "https://introspectivemarketresearch.com\n\n"
    'If this isn’t relevant, reply "unsubscribe" and I won’t write again.'
)

BRANDS: dict[str, Brand] = {
    "imr_tech": Brand(
        key="imr_tech",
        name="IMR Tech Solutions",
        site="imrtechsolutions.com",
        templates=(
            MessageTemplate(
                key="capabilities",
                label="Capabilities overview",
                hint="Akshay’s full introduction. Sent by default.",
                subject="Custom software built around {{company_name}}’s processes",
                body=(
                    "Hi {{first_name}},\n\n"
                    "I’m Akshay from IMR Tech Solutions.\n\n"
                    "We help businesses build and implement custom digital "
                    "solutions that simplify operations, automate repetitive "
                    "processes and improve visibility across teams.\n\n"
                    "Our capabilities include:\n"
                    "• Custom Web & Mobile App Development\n"
                    "• Business Management & ERP Solutions\n"
                    "• CRM & HRMS Development\n"
                    "• Workflow & Process Automation\n"
                    "• Customer & Employee Portals\n"
                    "• API & Third-Party Integrations\n"
                    "• AI-powered Business Solutions\n"
                    "• Website Development & Digital Transformation\n\n"
                    "Rather than forcing your business into an off-the-shelf "
                    "system, we build solutions around your actual processes, "
                    "teams and business requirements.\n\n"
                    "If your organization is currently dealing with manual "
                    "processes, disconnected software or operational "
                    "inefficiencies, I’d be happy to understand the challenge "
                    "and suggest a practical technology approach.\n\n"
                    "Would you be open to a 15-minute discussion next week?"
                    + _SIGNOFF_TECH
                ),
            ),
            MessageTemplate(
                key="outgrown",
                label="Outgrown the tool",
                hint="Shorter follow-up angle, for round two.",
                subject="The spreadsheet nobody at {{company_name}} wants to own",
                body=(
                    "Hi {{first_name}},\n\n"
                    "Most teams in {{industry}} have one process running on a "
                    "spreadsheet somebody built years ago that everyone is now "
                    "afraid to touch. Quoting, reconciliation, onboarding, "
                    "reporting. It works — until the person who understands it "
                    "goes on leave.\n\n"
                    "We replace those with software shaped around how the work "
                    "actually happens: custom web and mobile applications, ERP "
                    "and CRM builds, and automation for the steps that never "
                    "needed a person.\n\n"
                    "If something like that exists at {{company_name}}, I’d be "
                    "glad to walk you through two or three we have built for "
                    "teams your size.\n\n"
                    "Would you be open to a 15-minute discussion next week?"
                    + _SIGNOFF_TECH
                ),
            ),
            MessageTemplate(
                key="ai_payoff",
                label="Where AI pays off",
                hint="Shorter follow-up angle, for round three.",
                subject="The dull AI question for {{company_name}}",
                body=(
                    "Hi {{first_name}},\n\n"
                    "Most AI pitches landing in your inbox are a demo looking "
                    "for a problem. The ones that pay for themselves are duller: "
                    "reading documents, chasing exceptions, drafting the same "
                    "reply for the two-hundredth time.\n\n"
                    "That is the work we automate — usually sitting on top of "
                    "the custom software, portals and integrations we build "
                    "anyway, across {{industry}} and a dozen other sectors.\n\n"
                    "Name the task at {{company_name}} that eats a day a week "
                    "and I’ll tell you honestly whether it is worth automating. "
                    "That answer is free either way.\n\n"
                    "Would you be open to a 15-minute discussion next week?"
                    + _SIGNOFF_TECH
                ),
            ),
        ),
    ),
    "imr_research": Brand(
        key="imr_research",
        name="Introspective Market Research",
        site="introspectivemarketresearch.com",
        templates=(
            MessageTemplate(
                key="capabilities",
                label="Capabilities overview",
                hint="Akshay’s full introduction. Sent by default.",
                subject="Primary market research for {{company_name}}",
                body=(
                    "Hi {{first_name}},\n\n"
                    "I’m Akshay from Introspective Market Research (IMR) Pvt "
                    "Ltd.\n\n"
                    "We help companies make better business decisions through "
                    "primary market research — collecting fresh, first-hand "
                    "insights directly from customers, buyers, decision-makers, "
                    "channel partners and industry experts.\n\n"
                    "Our research capabilities include:\n\n"
                    "Quantitative Research\n"
                    "• Online Surveys & CATI\n"
                    "• B2B & Consumer Surveys\n"
                    "• CSAT & Brand Tracking\n"
                    "• Usage & Attitude Studies\n"
                    "• Concept & Product Testing\n\n"
                    "Qualitative & B2B Research\n"
                    "• In-depth Interviews (IDIs) & FGDs\n"
                    "• CXO / KOL Interviews\n"
                    "• Voice of Customer\n"
                    "• Dealer & Distributor Research\n"
                    "• Procurement & Buying Process Studies\n"
                    "• Competitor Analysis\n"
                    "• Customer Journey & Mystery Shopping\n\n"
                    "We can support projects across India and international "
                    "markets, from research design and respondent recruitment "
                    "to fieldwork, analysis and actionable reporting.\n\n"
                    "If you have an upcoming requirement around market "
                    "validation, customer insights, competitor intelligence, "
                    "product research or market opportunity assessment, I’d be "
                    "happy to discuss how we can support you.\n\n"
                    "Would you be open to a 15-minute discussion next week?"
                    + _SIGNOFF_RESEARCH
                ),
            ),
            MessageTemplate(
                key="voice",
                label="What buyers won’t say",
                hint="Shorter follow-up angle, for round two.",
                subject="What {{company_name}}’s buyers won’t tell your sales team",
                body=(
                    "Hi {{first_name}},\n\n"
                    "Customers are polite to the people who sell to them. The "
                    "real reason a deal stalled — or why a product gets used in "
                    "a way nobody designed for — tends to surface with a "
                    "neutral third party in the room, and not before.\n\n"
                    "That is what our primary work is for: in-depth interviews, "
                    "FGDs, CXO and KOL conversations, Voice of Customer and "
                    "mystery shopping, run so the answers are not shaped by who "
                    "is asking.\n\n"
                    "If there is a question at {{company_name}} your own "
                    "channels keep answering ambiguously, that is usually the "
                    "one worth handing to someone outside.\n\n"
                    "Would you be open to a 15-minute discussion next week?"
                    + _SIGNOFF_RESEARCH
                ),
            ),
            MessageTemplate(
                key="sizing",
                label="Size before you spend",
                hint="Shorter follow-up angle, for round three.",
                subject="Sizing it before {{company_name}} commits the budget",
                body=(
                    "Hi {{first_name}},\n\n"
                    "Most market-entry calls get made on the loudest opinion in "
                    "the room, then defended with numbers found afterwards. It "
                    "usually works. When it does not, it is expensive and slow "
                    "to admit.\n\n"
                    "We run the version that goes first: market sizing, "
                    "segmentation, competitor analysis and opportunity "
                    "assessment, across India and international markets — from "
                    "research design and respondent recruitment through to "
                    "reporting you can put in front of a board.\n\n"
                    "If there is a number {{company_name}} needs this quarter "
                    "that nobody can currently defend, I am happy to scope what "
                    "it would take to get it properly.\n\n"
                    "Would you be open to a 15-minute discussion next week?"
                    + _SIGNOFF_RESEARCH
                ),
            ),
        ),
    ),
}


def default_template(brand_key: str) -> "MessageTemplate | None":
    """The angle a brand opens on before anyone picks a different one."""
    brand = BRANDS.get(brand_key)
    return brand.templates[0] if brand else None


def render(text: str, recipient: BroadcastRecipient) -> str:
    """Fill {{variables}} from one row.

    An unknown or empty variable becomes a neutral word rather than an empty
    gap, because "Hi ," in the first line of a cold email is worse than not
    personalising at all.
    """
    first, _, last = (recipient.name or "").partition(" ")
    values = {
        "first_name": first or "there",
        "last_name": last or "",
        "company_name": recipient.company or "your team",
        # These read as the tail of a prepositional phrase ("teams in X",
        # "at X"), which is the shape every template below uses them in - so
        # a missing cell degrades to a sentence that still reads.
        "job_title": recipient.title or "your role",
        "industry": recipient.industry or "your sector",
        "location": recipient.location or "your market",
        "email": recipient.email,
    }
    return VARIABLE_RE.sub(lambda m: values.get(m.group(1), "") or "", text)


# --------------------------------------------------------------------------
# Reading a list in
# --------------------------------------------------------------------------

# Header text -> field. Matched as a substring, lowercased, so "E-mail
# Address", "Work Email" and "email" all land on the same column.
COLUMN_HINTS: tuple[tuple[str, str], ...] = (
    ("email", "email"),
    ("e-mail", "email"),
    ("mail", "email"),
    ("company", "company"),
    ("organisation", "company"),
    ("organization", "company"),
    ("account", "company"),
    ("title", "title"),
    ("designation", "title"),
    ("role", "title"),
    ("position", "title"),
    ("industry", "industry"),
    ("sector", "industry"),
    ("country", "location"),
    ("location", "location"),
    ("city", "location"),
    ("region", "location"),
    ("name", "name"),  # last: "company name" must match company first
)


@dataclass
class ParsedRow:
    email: str
    name: str = ""
    company: str = ""
    title: str = ""
    industry: str = ""
    location: str = ""


@dataclass
class ParseResult:
    rows: list[ParsedRow] = field(default_factory=list)
    skipped_invalid: int = 0
    skipped_duplicate: int = 0
    truncated: bool = False


def _map_columns(header: Sequence[str]) -> dict[int, str]:
    """Which column index holds which field."""
    mapping: dict[int, str] = {}
    taken: set[str] = set()
    for index, raw in enumerate(header):
        text = (raw or "").strip().lower()
        if not text:
            continue
        for hint, field_name in COLUMN_HINTS:
            if hint in text and field_name not in taken:
                mapping[index] = field_name
                taken.add(field_name)
                break
    return mapping


def _rows_from_grid(grid: Iterable[Sequence[str]]) -> ParseResult:
    """Turn a rectangle of cells into recipients, header or no header."""
    result = ParseResult()
    rows = [r for r in grid if any((c or "").strip() for c in r)]
    if not rows:
        return result

    mapping = _map_columns(rows[0])
    # A first row that maps nothing but does contain an address is data, not a
    # header - which is the "just a column of emails" case.
    header_is_data = "email" not in mapping.values() and any(
        EMAIL_RE.match((c or "").strip()) for c in rows[0]
    )
    body = rows if header_is_data else rows[1:]

    if header_is_data or "email" not in mapping.values():
        mapping = {}

    seen: set[str] = set()
    for row in body:
        if len(result.rows) >= MAX_UPLOAD_ROWS:
            result.truncated = True
            break

        fields = {
            "email": "", "name": "", "company": "",
            "title": "", "industry": "", "location": "",
        }
        if mapping:
            for index, name in mapping.items():
                if index < len(row):
                    fields[name] = (row[index] or "").strip()
        if not fields["email"]:
            # No mapped email column: take the first cell that looks like one.
            fields["email"] = next(
                ((c or "").strip() for c in row if EMAIL_RE.match((c or "").strip())), ""
            )

        email = fields["email"].lower()
        if not EMAIL_RE.match(email):
            result.skipped_invalid += 1
            continue

        # An address seen earlier in this file is counted, but the row is still
        # returned - the person on it is real even when the address is shared,
        # and dropping them here is how a five-row file becomes two rows with
        # no explanation. Whether they can be mailed is decided on import.
        if email in seen:
            result.skipped_duplicate += 1
        seen.add(email)

        result.rows.append(
            ParsedRow(
                email=email,
                name=fields["name"][:255],
                company=fields["company"][:255],
                title=fields["title"][:255],
                industry=fields["industry"][:255],
                location=fields["location"][:255],
            )
        )
    return result


def parse_upload(filename: str, blob: bytes) -> ParseResult:
    """Read .xlsx, .csv or .txt into recipients."""
    lower = filename.lower()

    if lower.endswith((".xlsx", ".xlsm")):
        import openpyxl

        book = openpyxl.load_workbook(io.BytesIO(blob), read_only=True, data_only=True)
        sheet = book.active
        grid = [
            ["" if c is None else str(c) for c in row]
            for row in sheet.iter_rows(values_only=True)
        ]
        book.close()
        return _rows_from_grid(grid)

    if lower.endswith((".csv", ".txt", ".tsv")):
        text = blob.decode("utf-8-sig", errors="replace")
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        return _rows_from_grid(list(csv.reader(io.StringIO(text), dialect)))

    raise ValueError(
        "Upload a .xlsx, .csv or .txt file. "
        f"'{filename}' is not a format this can read."
    )


# --------------------------------------------------------------------------
# Exporting a list out
# --------------------------------------------------------------------------

EXPORT_MIME = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
    "csv": "text/csv",
}


def _ascii(text: str) -> str:
    """fpdf's built-in fonts are Latin-1 only, and a smart quote from a
    spreadsheet should not be what fails an export."""
    return (
        (text or "")
        .replace("’", "'").replace("‘", "'")
        .replace("“", '"').replace("”", '"')
        .replace("—", "-").replace("–", "-").replace("·", "-")
        .encode("latin-1", "replace")
        .decode("latin-1")
    )


def build_export(fmt: str, title: str, headers: list[str], rows: list[list[str]]) -> bytes:
    """One table, in whichever of the four formats was asked for."""
    if fmt == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(headers)
        writer.writerows(rows)
        return buffer.getvalue().encode("utf-8-sig")

    if fmt == "xlsx":
        import openpyxl
        from openpyxl.styles import Font
        from openpyxl.utils import get_column_letter

        book = openpyxl.Workbook()
        sheet = book.active
        sheet.title = title[:31] or "Export"
        sheet.append(headers)
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        for row in rows:
            sheet.append(row)
        sheet.freeze_panes = "A2"
        for index, header in enumerate(headers, start=1):
            widest = max(
                [len(header)] + [len(str(r[index - 1])) for r in rows if index <= len(r)]
                or [len(header)]
            )
            sheet.column_dimensions[get_column_letter(index)].width = min(52, widest + 3)
        out = io.BytesIO()
        book.save(out)
        return out.getvalue()

    if fmt == "docx":
        import docx
        from docx.shared import Pt

        document = docx.Document()
        document.add_heading(title, level=1)
        document.add_paragraph(
            f"{len(rows)} row{'s' if len(rows) != 1 else ''} · exported "
            f"{datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}"
        )
        table = document.add_table(rows=1, cols=len(headers))
        table.style = "Light Grid Accent 1"
        for cell, header in zip(table.rows[0].cells, headers):
            cell.text = header
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.bold = True
        for row in rows:
            cells = table.add_row().cells
            for cell, value in zip(cells, row):
                cell.text = str(value)
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        run.font.size = Pt(9)
        out = io.BytesIO()
        document.save(out)
        return out.getvalue()

    if fmt == "pdf":
        from fpdf import FPDF

        pdf = FPDF(orientation="L", unit="mm", format="A4")
        pdf.set_auto_page_break(auto=True, margin=12)
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 14)
        pdf.cell(0, 9, _ascii(title), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(110, 110, 110)
        pdf.cell(
            0, 6,
            _ascii(f"{len(rows)} rows - exported "
                   f"{datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}"),
            new_x="LMARGIN", new_y="NEXT",
        )
        pdf.set_text_color(0, 0, 0)
        pdf.ln(3)

        usable = pdf.w - 2 * pdf.l_margin
        widths = [usable * w for w in _column_weights(headers)]

        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(238, 240, 238)
        for header, width in zip(headers, widths):
            pdf.cell(width, 7, _ascii(header)[:60], border=0, fill=True)
        pdf.ln(7)

        pdf.set_font("Helvetica", "", 8)
        for index, row in enumerate(rows):
            if index % 2:
                pdf.set_fill_color(249, 250, 249)
                fill = True
            else:
                fill = False
            for value, width in zip(row, widths):
                text = _ascii(str(value))
                # Trim to what the column can actually show, rather than
                # letting fpdf wrap a cell and desynchronise the row.
                while text and pdf.get_string_width(text) > width - 3:
                    text = text[:-1]
                pdf.cell(width, 6, text, border=0, fill=fill)
            pdf.ln(6)
        return bytes(pdf.output())

    raise ValueError(f"Unsupported export format: {fmt}")


def _column_weights(headers: list[str]) -> list[float]:
    """Give the address column the room it needs; split the rest evenly."""
    wide = {"email", "detail", "subject", "reply", "message"}
    weights = [2.2 if h.strip().lower() in wide else 1.0 for h in headers]
    total = sum(weights)
    return [w / total for w in weights]


# --------------------------------------------------------------------------
# Whose turn it is
# --------------------------------------------------------------------------


def rotation_order(
    recipients: Sequence[BroadcastRecipient],
) -> list[BroadcastRecipient]:
    """The list as a circle: least-contacted first, oldest contact first.

    With fifteen people and batches of ten this produces 1-10, then 11-15
    followed by 1-5, then 6-15, and so on round the loop. Everyone gets their
    first message before anyone gets a second, which is the property that
    matters - the wrap-around is just what falls out of it.

    `sent_at` is the tie-break inside a round, so a batch that was cut short
    by the daily limit resumes exactly where it stopped rather than starting
    over at the top of the list.
    """
    return sorted(
        recipients,
        key=lambda r: (
            r.send_count,
            r.sent_at.timestamp() if r.sent_at else 0.0,
            r.created_at.timestamp() if r.created_at else 0.0,
        ),
    )


async def next_up(
    session, count: int, suppressed: set[str]
) -> list[BroadcastRecipient]:
    """The next `count` recipients, in the order they will be mailed.

    Suppressed addresses are dropped here rather than queued and skipped
    later, so asking for ten means ten messages go out - not ten slots, three
    of which quietly evaporate.
    """
    rows = list(
        (
            await session.execute(
                select(BroadcastRecipient).where(
                    BroadcastRecipient.duplicate_of_id.is_(None)
                )
            )
        )
        .scalars()
        .all()
    )
    eligible = [r for r in rotation_order(rows) if not _is_suppressed(r.email, suppressed)]
    return eligible[:count]


def _is_suppressed(address: str, suppressed: set[str]) -> bool:
    value = (address or "").strip().lower()
    if not value:
        return False
    if value in suppressed:
        return True
    return "@" in value and value.split("@", 1)[1] in suppressed


# --------------------------------------------------------------------------
# Pacing the send out
# --------------------------------------------------------------------------


def _today_utc():
    return datetime.now(timezone.utc).date()


def _blocked_reason(mailbox: Mailbox) -> str | None:
    """Why this mailbox cannot send right now, if it cannot.

    The daily ceiling is re-checked per message. There is deliberately no way
    to raise it from here: creating headroom to escape a limit mid-run is how
    a sending domain gets burned.
    """
    if not mailbox.is_active:
        return "That mailbox is disabled."
    if mailbox.status != "connected":
        return "That mailbox is not verified. Test the connection first."
    if mailbox.send_window_date != _today_utc():
        mailbox.send_window_date = _today_utc()
        mailbox.sent_today = 0
    if mailbox.sent_today >= mailbox.daily_limit:
        return (
            f"Daily limit reached for {mailbox.address} "
            f"({mailbox.sent_today}/{mailbox.daily_limit})."
        )
    return None


async def run_job(job_id: uuid.UUID, settings: Settings) -> None:
    """Work through one job, one message at a time, pausing between each.

    A fresh session per message on purpose: this loop can run for half an hour
    and holding one connection open across all of it is how you find out your
    database closed it twenty minutes ago.
    """
    maker = get_sessionmaker()
    logger.info("[Broadcast] job %s starting", job_id)

    while True:
        delay = 15
        async with maker() as session:
            job = await session.get(BroadcastJob, job_id)
            if job is None:
                return
            delay = max(0, job.delay_seconds)

            if job.status == "cancelling":
                job.status = "cancelled"
                job.finished_at = datetime.now(timezone.utc)
                await session.commit()
                logger.info("[Broadcast] job %s cancelled", job_id)
                return

            job.status = "running"

            # The batch was fixed when the job was created, and it runs in
            # exactly the order the screen showed.
            send = await session.scalar(
                select(BroadcastSend)
                .where(
                    BroadcastSend.job_id == job_id,
                    BroadcastSend.status == "pending",
                )
                .order_by(BroadcastSend.position)
                .limit(1)
            )
            recipient = (
                await session.get(BroadcastRecipient, send.recipient_id)
                if send is not None
                else None
            )
            if send is not None and recipient is None:
                # Removed from the list mid-run; drop the slot and continue.
                send.status = "skipped"
                send.detail = "Recipient was removed from the list."
                job.skipped += 1
                await session.commit()
                continue
            if send is None:
                job.status = "done"
                job.finished_at = datetime.now(timezone.utc)
                await session.commit()
                logger.info(
                    "[Broadcast] job %s done: %d sent, %d skipped, %d failed",
                    job_id, job.sent, job.skipped, job.failed,
                )
                return

            mailbox = await session.get(Mailbox, job.mailbox_id)
            if mailbox is None:
                job.status = "error"
                job.detail = "The sending mailbox was removed."
                job.finished_at = datetime.now(timezone.utc)
                await session.commit()
                return

            sent_ok = await _send_one(session, job, mailbox, send, recipient, settings)

            # Finish here rather than sleeping and coming back to discover the
            # queue is empty - otherwise the progress bar sits at 100% for a
            # whole delay period looking stuck.
            more = await session.scalar(
                select(func.count())
                .select_from(BroadcastSend)
                .where(
                    BroadcastSend.job_id == job_id,
                    BroadcastSend.status == "pending",
                )
            )
            if not more:
                job.status = "done"
                job.finished_at = datetime.now(timezone.utc)
            await session.commit()

            if not more:
                logger.info(
                    "[Broadcast] job %s done: %d sent, %d skipped, %d failed",
                    job_id, job.sent, job.skipped, job.failed,
                )
                return

        # Only pace between messages that actually went out.
        if sent_ok and delay:
            await asyncio.sleep(delay)


def _record(
    send: BroadcastSend,
    recipient: BroadcastRecipient,
    status: str,
    detail: str,
) -> None:
    """Write one outcome to both the send row and the recipient's summary."""
    send.status = status
    send.detail = detail[:500]
    recipient.status = status
    recipient.detail = detail[:500]


async def _send_one(
    session,
    job: BroadcastJob,
    mailbox: Mailbox,
    send: BroadcastSend,
    recipient: BroadcastRecipient,
    settings: Settings,
) -> bool:
    """One recipient. Returns True only if a message actually went out."""
    from .routers.mailboxes import credentials_for

    # Deterministic checks before the expensive one - suppression is read
    # fresh every time, so someone who opts out mid-run is dropped from the
    # rest of that same run.
    suppressed = {
        row[0] for row in (await session.execute(select(Suppression.value))).all()
    }
    if _is_suppressed(recipient.email, suppressed):
        _record(send, recipient, "skipped", "On the do-not-contact list.")
        job.skipped += 1
        return False

    blocked = _blocked_reason(mailbox)
    if blocked:
        _record(send, recipient, "skipped", blocked)
        job.skipped += 1
        return False

    subject = render(job.subject, recipient)
    body = render(job.body, recipient)

    mailbox.sent_today += 1  # claimed before the attempt, released on failure
    try:
        outcome = await send_message(
            credentials_for(mailbox, settings),
            to_address=recipient.email,
            subject=subject,
            body=body,
        )
    except (MailboxError, DecryptionError) as exc:
        mailbox.sent_today = max(0, mailbox.sent_today - 1)
        _record(send, recipient, "failed", str(exc))
        job.failed += 1
        logger.warning("[Broadcast] %s failed: %s", recipient.email, exc)
        return False

    session.add(
        EmailMessage(
            mailbox_id=mailbox.id,
            direction="outbound",
            message_id=outcome.message_id,
            thread_key=outcome.thread_key,
            from_address=mailbox.address,
            to_address=recipient.email,
            subject=subject,
            body=body,
            is_read=True,
            sent_at=datetime.now(timezone.utc),
        )
    )
    now = datetime.now(timezone.utc)
    _record(send, recipient, "sent", "")
    send.sent_at = now
    recipient.thread_key = outcome.thread_key
    recipient.sent_at = now
    # This is what moves them along the rotation, so it counts real sends
    # only - a skip or a bounce must not cost anyone their place in the queue.
    recipient.send_count += 1
    job.sent += 1
    return True
