"""Database reads and writes, and the ORM -> API translation.

Everything the routers need from Postgres lives here, so the endpoints stay
about HTTP and the models stay about storage.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import freshness
from .config import Settings
from .models import Company, DecisionMaker, ModelCall, OutreachCampaign, Suppression
from .schemas import Company as CompanySchema
from .schemas import CompanyDraft
from .schemas import ContactOut
from .schemas import OutreachCampaign as OutreachCampaignSchema
from .schemas import OutreachDraft, SuppressionEntry

# --------------------------------------------------------------------------
# ORM -> API
# --------------------------------------------------------------------------


def to_company_schema(company: Company, settings: Settings) -> CompanySchema:
    days = freshness.age_in_days(company.last_verified)
    in_campaign = bool(company.campaigns) or company.stage != "lead"

    return CompanySchema(
        id=str(company.id),
        name=company.name,
        industry=company.industry,
        revenue=company.revenue,
        employees=company.employees,
        description=company.description,
        recentNews=company.recent_news,
        website=company.website or "",
        headquarters=company.headquarters or "",
        founded=company.founded or "",
        latestLaunch=company.latest_launch or "",
        products=list(company.products or []),
        buyingSignals=list(company.buying_signals or []),
        painPoints=list(company.pain_points or []),
        icpScore=company.icp_score,
        icpReasons=list(company.icp_reasons or []),
        stage=company.stage,  # type: ignore[arg-type]
        linkedinData=company.linkedin_data,
        enrichmentType=company.enrichment_type,  # type: ignore[arg-type]
        enrichmentConfidence=company.enrichment_confidence,
        freshness=freshness.band_for(days),
        freshnessDays=days,
        needsRetouch=freshness.needs_retouch(
            days, company.icp_score, in_campaign, settings
        ),
        lastVerified=company.last_verified.isoformat() if company.last_verified else None,
        decisionMakers=[
            ContactOut(
                id=str(dm.id),
                name=dm.name,
                title=dm.title,
                linkedin=dm.linkedin,
                linkedinVerified=bool(dm.linkedin_verified),
                email=dm.email,
                phone=dm.phone or "",
            )
            for dm in company.decision_makers
        ],
    )


def to_campaign_schema(campaign: OutreachCampaign) -> OutreachCampaignSchema:
    return OutreachCampaignSchema(
        companyId=str(campaign.company_id),
        decisionMakerId=str(campaign.decision_maker_id),
        emailSubject=campaign.email_subject,
        emailBody=campaign.email_body,
        linkedinMessage=campaign.linkedin_message,
        callScriptHead=campaign.call_script_head,
        objectionHandling=campaign.objection_handling,
        personalizationScore=campaign.personalization_score,
    )


def to_suppression_schema(entry: Suppression) -> SuppressionEntry:
    return SuppressionEntry(
        id=str(entry.id),
        value=entry.value,
        reason=entry.reason,
        source=entry.source,
        createdAt=entry.created_at.isoformat() if entry.created_at else "",
    )


# --------------------------------------------------------------------------
# Reads
# --------------------------------------------------------------------------


async def list_companies(session: AsyncSession) -> Sequence[Company]:
    """Newest first, with decision makers and campaigns eagerly loaded."""
    result = await session.execute(
        select(Company).order_by(Company.created_at.desc(), Company.name)
    )
    return result.scalars().unique().all()


async def get_company(session: AsyncSession, company_id: uuid.UUID) -> Company | None:
    return await session.get(Company, company_id)


async def list_campaigns(session: AsyncSession) -> Sequence[OutreachCampaign]:
    result = await session.execute(
        select(OutreachCampaign).order_by(OutreachCampaign.created_at.desc())
    )
    return result.scalars().all()


async def count_companies(session: AsyncSession) -> int:
    return await session.scalar(select(func.count()).select_from(Company)) or 0


async def count_qualified(session: AsyncSession, threshold: int) -> int:
    return (
        await session.scalar(
            select(func.count()).select_from(Company).where(Company.icp_score >= threshold)
        )
        or 0
    )


async def count_contacts(session: AsyncSession) -> int:
    return await session.scalar(select(func.count()).select_from(DecisionMaker)) or 0


async def count_campaigns(session: AsyncSession) -> int:
    return await session.scalar(select(func.count()).select_from(OutreachCampaign)) or 0


async def average_icp(session: AsyncSession) -> int:
    value = await session.scalar(select(func.avg(Company.icp_score)))
    return int(round(float(value))) if value is not None else 0


async def monthly_activity(session: AsyncSession, months: int = 12) -> dict:
    """Records added and re-verified per month, keyed "YYYY-MM" in UTC.

    "Retouched" means last_verified moved after the row was created - i.e. an
    enrichment pass, not the original discovery.

    The month key is formatted in SQL rather than in Python on purpose. These
    are timestamptz columns, and the driver hands back every value converted to
    UTC: date_trunc in a +05:30 session yields midnight local, which is the
    *previous* month once it reaches Python as UTC. Truncating to UTC here and
    formatting server-side keeps both ends on the same calendar.
    """
    bucket_created = func.to_char(
        func.date_trunc("month", func.timezone("UTC", Company.created_at)), "YYYY-MM"
    )
    bucket_verified = func.to_char(
        func.date_trunc("month", func.timezone("UTC", Company.last_verified)), "YYYY-MM"
    )

    added = await session.execute(
        select(bucket_created.label("m"), func.count()).group_by("m")
    )
    retouched = await session.execute(
        select(bucket_verified.label("m"), func.count())
        .where(Company.last_verified > Company.created_at)
        .group_by("m")
    )
    return {
        "added": {row[0]: row[1] for row in added.all() if row[0]},
        "retouched": {row[0]: row[1] for row in retouched.all() if row[0]},
    }


async def companies_missing_enrichment(session: AsyncSession, threshold: int) -> int:
    """High-ICP accounts nobody has enriched yet."""
    return (
        await session.scalar(
            select(func.count())
            .select_from(Company)
            .where(Company.icp_score >= threshold, Company.linkedin_data.is_(None))
        )
        or 0
    )


async def companies_without_campaign(session: AsyncSession, threshold: int) -> int:
    """High-ICP accounts with no outreach drafted."""
    sub = select(OutreachCampaign.company_id)
    return (
        await session.scalar(
            select(func.count())
            .select_from(Company)
            .where(Company.icp_score >= threshold, Company.id.not_in(sub))
        )
        or 0
    )


async def stage_counts(session: AsyncSession) -> dict[str, int]:
    result = await session.execute(
        select(Company.stage, func.count()).group_by(Company.stage)
    )
    return {stage: count for stage, count in result.all()}


# --------------------------------------------------------------------------
# Cost
# --------------------------------------------------------------------------


async def record_model_call(
    session: AsyncSession,
    *,
    agent: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: Decimal,
) -> ModelCall:
    call = ModelCall(
        agent=agent,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost_usd,
    )
    session.add(call)
    return call


async def total_cost(session: AsyncSession) -> Decimal:
    value = await session.scalar(select(func.coalesce(func.sum(ModelCall.cost_usd), 0)))
    return Decimal(str(value or 0))


async def spend_by_agent(session: AsyncSession) -> list[tuple]:
    result = await session.execute(
        select(
            ModelCall.agent,
            ModelCall.model,
            func.count(),
            func.coalesce(func.sum(ModelCall.input_tokens), 0),
            func.coalesce(func.sum(ModelCall.output_tokens), 0),
            func.coalesce(func.sum(ModelCall.cost_usd), 0),
        )
        .group_by(ModelCall.agent, ModelCall.model)
        .order_by(func.coalesce(func.sum(ModelCall.cost_usd), 0).desc())
    )
    return list(result.all())


# --------------------------------------------------------------------------
# Suppression
# --------------------------------------------------------------------------


def _normalise(value: str) -> str:
    return value.strip().lower()


async def list_suppressions(session: AsyncSession) -> Sequence[Suppression]:
    result = await session.execute(
        select(Suppression).order_by(Suppression.created_at.desc())
    )
    return result.scalars().all()


async def suppressed_values(session: AsyncSession) -> set[str]:
    result = await session.execute(select(Suppression.value))
    return {row[0] for row in result.all()}


def is_suppressed(target: str, suppressed: set[str]) -> bool:
    """Match the address itself, or its whole domain.

    Section M: a complaint stops automated contact with the domain, not just
    that one address.
    """
    value = _normalise(target)
    if not value:
        return False
    if value in suppressed:
        return True
    if "@" in value:
        return value.split("@", 1)[1] in suppressed
    return False


async def add_suppression(
    session: AsyncSession, value: str, reason: str, source: str = "manual"
) -> Suppression | None:
    """Returns None when the value is already suppressed."""
    normalised = _normalise(value)
    existing = await session.scalar(
        select(Suppression).where(Suppression.value == normalised)
    )
    if existing is not None:
        return None

    entry = Suppression(value=normalised, reason=reason, source=source)
    session.add(entry)
    await session.flush()
    return entry


async def remove_suppression(session: AsyncSession, entry_id: uuid.UUID) -> bool:
    entry = await session.get(Suppression, entry_id)
    if entry is None:
        return False
    await session.delete(entry)
    return True


# --------------------------------------------------------------------------
# Writes
# --------------------------------------------------------------------------


async def save_company(
    session: AsyncSession,
    draft: CompanyDraft,
    source_icp: str,
    *,
    company_id: uuid.UUID,
    decision_maker_ids: Sequence[uuid.UUID],
) -> Company:
    """Persist one discovered account.

    Ids are passed in rather than generated here: the outreach agent needs them
    before anything is written, so the whole run can be saved in one short
    transaction instead of holding one open across slow model calls.

    Any ids the model invented are discarded - these UUIDs are what the
    frontend and the campaign rows reference.
    """
    company = Company(
        id=company_id,
        name=draft.name,
        industry=draft.industry,
        revenue=draft.revenue,
        employees=draft.employees,
        description=draft.description,
        icp_score=draft.icpScore,
        icp_reasons=list(draft.icpReasons or []),
        recent_news=draft.recentNews,
        website=draft.website.strip(),
        headquarters=draft.headquarters.strip(),
        founded=draft.founded.strip(),
        latest_launch=draft.latestLaunch.strip(),
        products=list(draft.products or []),
        buying_signals=list(draft.buyingSignals or []),
        pain_points=list(draft.painPoints or []),
        source_icp=source_icp,
        stage="lead",
        last_verified=datetime.now(timezone.utc),
        decision_makers=[
            DecisionMaker(id=dm_id, name=dm.name, title=dm.title, linkedin=dm.linkedin)
            for dm_id, dm in zip(decision_maker_ids, draft.decisionMakers)
        ],
    )
    session.add(company)
    return company


async def save_campaign(
    session: AsyncSession,
    draft: OutreachDraft,
    company_id: uuid.UUID,
    decision_maker_id: uuid.UUID,
) -> OutreachCampaign:
    campaign = OutreachCampaign(
        company_id=company_id,
        decision_maker_id=decision_maker_id,
        email_subject=draft.emailSubject,
        email_body=draft.emailBody,
        linkedin_message=draft.linkedinMessage,
        call_script_head=draft.callScriptHead,
        objection_handling=draft.objectionHandling,
        personalization_score=draft.personalizationScore,
    )
    session.add(campaign)
    return campaign


async def update_stage(session: AsyncSession, company: Company, stage: str) -> Company:
    company.stage = stage
    await session.flush()
    return company


async def update_contact_channels(
    session: AsyncSession,
    contact: DecisionMaker,
    *,
    email: str | None = None,
    phone: str | None = None,
    linkedin: str | None = None,
) -> DecisionMaker:
    """Set the channels a person typed in. None means "leave this one alone".

    Editing the LinkedIn URL is what promotes it out of "agent's guess" - the
    marker in the UI is driven by this flag, not by whether the string is
    non-empty, because the agent always fills something in.
    """
    if email is not None:
        contact.email = email
    if phone is not None:
        contact.phone = phone
    if linkedin is not None:
        contact.linkedin = linkedin
        contact.linkedin_verified = bool(linkedin)

    await session.flush()
    return contact


async def update_enrichment(
    session: AsyncSession,
    company: Company,
    linkedin_data: str,
    statement_type: str,
    confidence: int,
) -> Company:
    company.linkedin_data = linkedin_data
    company.enrichment_type = statement_type
    company.enrichment_confidence = confidence
    # Re-verifying is what enrichment does, so the clock resets.
    company.last_verified = datetime.now(timezone.utc)
    await session.flush()
    return company


async def delete_all_companies(session: AsyncSession) -> int:
    """Wipes companies; decision makers and campaigns cascade.

    Users, the suppression list and the cost ledger are kept - a do-not-contact
    entry that could be cleared by a button is not a do-not-contact list.
    """
    result = await session.execute(delete(Company))
    return result.rowcount or 0
