"""SQLAlchemy models.

Column names are snake_case here and translated to the camelCase the frontend
expects in schemas.py, so the database stays idiomatic.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class User(Base):
    """A dashboard account. Passwords are stored as bcrypt hashes only."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    username: Mapped[str] = mapped_column(String(150), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # "admin" or "sales". Admins can spend money (Discover, bulk sends),
    # change configuration (mailboxes, templates, integrations) and manage
    # accounts. A sales executive can do everything needed to work a lead:
    # read the pipeline, edit contacts, move deals, send drafted outreach and
    # answer replies. Enforced by require_admin in auth.py, not by the UI.
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, default="sales", server_default="sales"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Company(Base):
    """A discovered account, plus where it sits on the pipeline board."""

    __tablename__ = "companies"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    industry: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    revenue: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    employees: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    icp_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)

    # Section C: a score without reasons is not usable.
    icp_reasons: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )

    recent_news: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # The research dossier the discovery agent assembles alongside the
    # firmographics. All of it is model-written, which is why the UI labels the
    # whole block rather than pretending any single field was sourced. The set
    # of fields is capped by the structured-output budget - see schemas.py.
    website: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    headquarters: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    founded: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    latest_launch: Mapped[str] = mapped_column(Text, nullable=False, default="")

    products: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    buying_signals: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    pain_points: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )

    # Filled in later by the enrichment agent, with its own honesty label.
    linkedin_data: Mapped[str | None] = mapped_column(Text)
    enrichment_type: Mapped[str | None] = mapped_column(String(16))
    enrichment_confidence: Mapped[int | None] = mapped_column(Integer)

    # Section K2: freshness drives whether re-verifying is worth money.
    last_verified: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    stage: Mapped[str] = mapped_column(String(32), nullable=False, default="lead", index=True)

    # The ICP that produced this account, kept for traceability.
    source_icp: Mapped[str] = mapped_column(Text, nullable=False, default="")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    decision_makers: Mapped[list["DecisionMaker"]] = relationship(
        back_populates="company",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="DecisionMaker.created_at",
    )
    campaigns: Mapped[list["OutreachCampaign"]] = relationship(
        back_populates="company",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class DecisionMaker(Base):
    __tablename__ = "decision_makers"

    id: Mapped[uuid.UUID] = _uuid_pk()
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    linkedin: Mapped[str] = mapped_column(String(512), nullable=False, default="")

    # Entered by a person, never generated. The discovery agent is given
    # neither field: an invented address or number that looks plausible would
    # mean mailing or calling a real stranger, so a contact without one is
    # simply unreachable on that channel until somebody types it in.
    email: Mapped[str] = mapped_column(String(320), nullable=False, default="", index=True)
    phone: Mapped[str] = mapped_column(String(64), nullable=False, default="")

    # The linkedin column above starts as the agent's guess. This flips once a
    # person has typed or confirmed it, which is what the "unverified" marker
    # in the client panel reads.
    linkedin_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    company: Mapped[Company] = relationship(back_populates="decision_makers")


class OutreachCampaign(Base):
    __tablename__ = "outreach_campaigns"

    id: Mapped[uuid.UUID] = _uuid_pk()
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    decision_maker_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("decision_makers.id", ondelete="CASCADE"), nullable=False
    )

    email_subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    email_body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    linkedin_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    call_script_head: Mapped[str] = mapped_column(Text, nullable=False, default="")
    objection_handling: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # The model's own honesty score on how specific this copy is.
    personalization_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    company: Mapped[Company] = relationship(back_populates="campaigns")


class ModelCall(Base):
    """One Claude call, priced.

    Section K: cost is what decides viability at volume, so every call is
    recorded rather than estimated afterwards.
    """

    __tablename__ = "model_calls"

    id: Mapped[uuid.UUID] = _uuid_pk()
    agent: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 6dp: a Haiku classification call costs a fraction of a cent, and
    # rounding those to zero is how cost dashboards start lying.
    cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 6), nullable=False, default=Decimal("0")
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )


class Suppression(Base):
    """Do-not-contact list.

    Section M: checked at send time, not at audience build time, so someone who
    opts out mid-campaign stops receiving mail immediately.
    """

    __tablename__ = "suppressions"

    id: Mapped[uuid.UUID] = _uuid_pk()

    # An email address, or a bare domain to suppress everyone there.
    value: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(100), nullable=False, default="manual")
    source: Mapped[str] = mapped_column(String(100), nullable=False, default="manual")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Mailbox(Base):
    """A real mailbox this workspace can send from and read replies out of.

    Credentials are stored encrypted (see crypto.py). Nothing here talks to a
    provider API - plain IMAP/SMTP, so any host works.
    """

    __tablename__ = "mailboxes"

    id: Mapped[uuid.UUID] = _uuid_pk()

    address: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")

    smtp_host: Mapped[str] = mapped_column(String(255), nullable=False)
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False, default=587)
    imap_host: Mapped[str] = mapped_column(String(255), nullable=False)
    imap_port: Mapped[int] = mapped_column(Integer, nullable=False, default=993)
    username: Mapped[str] = mapped_column(String(320), nullable=False)

    # Fernet ciphertext, never plaintext.
    password_encrypted: Mapped[str] = mapped_column(Text, nullable=False)

    # Deliverability is a function of restraint, so the ceiling is explicit and
    # the product never offers a way around it.
    daily_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=40)
    sent_today: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    send_window_date: Mapped[date | None] = mapped_column(Date)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="untested")
    status_detail: Mapped[str] = mapped_column(Text, nullable=False, default="")

    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_uid: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    messages: Mapped[list["EmailMessage"]] = relationship(
        back_populates="mailbox", cascade="all, delete-orphan"
    )


class EmailMessage(Base):
    """One sent or received message, threaded and linked to a prospect."""

    __tablename__ = "email_messages"

    id: Mapped[uuid.UUID] = _uuid_pk()
    mailbox_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mailboxes.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # "outbound" or "inbound".
    direction: Mapped[str] = mapped_column(String(12), nullable=False, index=True)

    # RFC message ids, so replies thread onto what we sent.
    message_id: Mapped[str | None] = mapped_column(String(512), index=True)
    in_reply_to: Mapped[str | None] = mapped_column(String(512), index=True)
    thread_key: Mapped[str] = mapped_column(String(512), nullable=False, index=True)

    from_address: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    to_address: Mapped[str] = mapped_column(String(320), nullable=False, default="", index=True)
    subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Reply triage, from the small model. Null until classified.
    classification: Mapped[str | None] = mapped_column(String(32), index=True)
    classification_confidence: Mapped[int | None] = mapped_column(Integer)
    classification_reason: Mapped[str | None] = mapped_column(Text)

    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL"), index=True
    )
    decision_maker_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("decision_makers.id", ondelete="SET NULL")
    )

    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    mailbox: Mapped[Mailbox] = relationship(back_populates="messages")


class BroadcastJob(Base):
    """One paced bulk send.

    Sending 100 messages with a 15-second gap takes 25 minutes, which is far
    longer than any HTTP request should live. So the request creates this row,
    hands off to a background task, and the UI polls it. The counters are
    written as the run progresses rather than at the end, because a job you
    cannot watch is a job you cannot trust.
    """

    __tablename__ = "broadcast_jobs"

    id: Mapped[uuid.UUID] = _uuid_pk()
    mailbox_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mailboxes.id", ondelete="CASCADE"), nullable=False
    )

    # Which of the two businesses this went out as.
    brand: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # queued | running | done | cancelling | cancelled | interrupted | error
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued", index=True)
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")

    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Pacing is deliverability, not decoration: a burst of 100 identical
    # messages from a cold domain is the single fastest way into a spam folder.
    delay_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=15)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BroadcastRecipient(Base):
    """One person on the list, and where they sit in the rotation.

    Deliberately separate from `decision_makers`: these are addresses a person
    brought with them, not people the pipeline discovered, and mixing the two
    would make it impossible to tell which is which later.

    THE ROTATION. The list is a circle, not a queue that empties. Fifteen
    people and a batch of ten sends 1-10; the next batch sends 11-15 and then
    wraps to 1-5. That falls out of ordering by (send_count, sent_at): whoever
    has been contacted least often, and longest ago, is always next. Nobody is
    picked twice inside one batch, so nobody can receive the same run twice.

    `status`, `detail`, `sent_at` and `thread_key` describe the MOST RECENT
    send. The per-send history lives in broadcast_sends.
    """

    __tablename__ = "broadcast_recipients"

    id: Mapped[uuid.UUID] = _uuid_pk()

    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    company: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    industry: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    location: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    # The file it arrived in, so a bad import can be found and removed.
    source_file: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    # Set when this row's address already belongs to an earlier contact.
    #
    # Lists routinely carry one shared inbox across several people - a team
    # info@, or a column somebody filled in with a placeholder. Dropping those
    # rows on import loses real people silently; keeping them and mailing them
    # sends the same inbox the same message several times in one batch. So the
    # row is kept and shown, and only the contact that owns the address is put
    # in the rotation.
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("broadcast_recipients.id", ondelete="SET NULL"),
        index=True,
    )

    # How many times this person has actually been emailed. This is what puts
    # them in the rotation, so it counts sends only - never skips or failures.
    send_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0", index=True
    )

    # The most recent outcome: pending (never contacted) | sent | skipped | failed
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")
    thread_key: Mapped[str] = mapped_column(String(512), nullable=False, default="", index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class BroadcastSend(Base):
    """One message a job intends to send, or has sent, to one recipient.

    The job's queue. Splitting this out of the recipient row is what lets the
    same person be mailed again in a later round without losing what happened
    the first time - and it is why a recipient can appear in many jobs but
    only ever once inside any single one.
    """

    __tablename__ = "broadcast_sends"

    id: Mapped[uuid.UUID] = _uuid_pk()
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("broadcast_jobs.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("broadcast_recipients.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # Where in this batch it sits, so the run happens in the order shown.
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Which round of the rotation this send belongs to (1 = first contact).
    round_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # pending | sent | skipped | failed
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Template(Base):
    """A reusable starting point. Personalization is applied on top, never instead."""

    __tablename__ = "templates"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    when_to_use: Mapped[str] = mapped_column(Text, nullable=False, default="")
    subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    uses: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class WorkspaceSettings(Base):
    """The defaults and policies an admin edits from the Settings screen.

    One row, id 1. Seeded from .env the first time anything reads it - the
    same arrangement the users table has with DASHBOARD_USERNAME - and the
    source of truth from then on. See workspace_settings.py.
    """

    __tablename__ = "workspace_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)

    # Shown under the signed-in name in the top bar.
    workspace_name: Mapped[str] = mapped_column(
        String(80), nullable=False, default="Revenue workspace"
    )

    # What Discover opens with. Every run can still change them.
    default_company_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    default_geo_scope: Mapped[str] = mapped_column(String(16), nullable=False, default="global")
    default_geo_value: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    default_industry_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="all")
    default_industry_value: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    # Qualification and the refresh policy - see freshness.py. These start
    # as the .env values and override them once saved.
    high_icp_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=75)
    refresh_days_high_icp_active: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    refresh_days_high_icp_dormant: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    refresh_days_mid_icp: Mapped[int] = mapped_column(Integer, nullable=False, default=180)

    # What Bulk Outreach and the mailbox form open with.
    default_batch_size: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    default_delay_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    default_daily_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=40)

    # See the note on allow_guessed_emails in config.py before turning it on.
    allow_guessed_emails: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    # A ceiling on the month's Claude spend. 0 means no ceiling.
    monthly_budget_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0"
    )

    # One sign-off per business, put on at send time - see signatures.py.
    signature_tech: Mapped[str] = mapped_column(Text, nullable=False, default="")
    signature_market_research: Mapped[str] = mapped_column(Text, nullable=False, default="")

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
