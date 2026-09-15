"""Dashboard, cost and compliance endpoints.

Sections F, K and M of the architecture draft.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import freshness, repository
from ..auth import get_current_user, require_admin
from ..config import Settings
from ..db import get_session
from ..dependencies import get_agents
from ..models import User
from ..workspace_settings import get_runtime_settings
from ..schemas import (
    ActionItem,
    AddSuppressionRequest,
    AgentSpend,
    CampaignRow,
    CostResponse,
    DashboardResponse,
    FreshnessBucket,
    GrowthPoint,
    RefreshRule,
    SuppressionEntry,
    SuppressionListResponse,
)

logger = logging.getLogger("salesos.insights")

router = APIRouter(prefix="/api", tags=["insights"])


MONTH_INITIALS = "JFMAMJJASOND"


def _safe_divide(total: float, count: int) -> float:
    return round(total / count, 6) if count else 0.0


def _last_months(count: int = 12) -> list[tuple[str, str]]:
    """(YYYY-MM, single-letter label) for the last `count` months, oldest first."""
    now = datetime.now(timezone.utc)
    months = []
    year, month = now.year, now.month
    for _ in range(count):
        months.append((f"{year:04d}-{month:02d}", MONTH_INITIALS[month - 1]))
        month -= 1
        if month == 0:
            month, year = 12, year - 1
    return list(reversed(months))


async def _build_actions(session, settings, needs_retouch: int, suppressed: int) -> list[ActionItem]:
    """What the workspace thinks deserves attention, with the reason shown.

    A queue you cannot argue with is a queue nobody uses, so every row says why
    it is there.
    """
    threshold = settings.high_icp_threshold
    actions: list[ActionItem] = []

    if needs_retouch:
        actions.append(
            ActionItem(
                id="retouch",
                title=f"{needs_retouch} record{'s' if needs_retouch != 1 else ''} are due a retouch",
                why=(
                    "Their freshness has decayed and something depends on them - "
                    "a high ICP score or an active deal. Everything else waits."
                ),
                action="Review accounts",
                view="companies",
                severity="warning",
            )
        )

    unenriched = await repository.companies_missing_enrichment(session, threshold)
    if unenriched:
        actions.append(
            ActionItem(
                id="enrich",
                title=f"{unenriched} qualified account{'s' if unenriched != 1 else ''} have no enrichment",
                why=(
                    f"ICP {threshold} or above with nothing beyond the original research. "
                    "Enrichment runs on the small model, so this is cheap."
                ),
                action="Open deal board",
                view="crm_board",
                severity="info",
            )
        )

    no_campaign = await repository.companies_without_campaign(session, threshold)
    if no_campaign:
        actions.append(
            ActionItem(
                id="no-campaign",
                title=f"{no_campaign} qualified account{'s' if no_campaign != 1 else ''} have no outreach",
                why=(
                    "They cleared the ICP bar but no copy was drafted - usually because "
                    "the contact is suppressed, or a draft failed mid-run."
                ),
                action="Run discovery",
                view="run",
                severity="info",
            )
        )

    if suppressed:
        actions.append(
            ActionItem(
                id="suppression",
                title=f"{suppressed} address{'es' if suppressed != 1 else ''} on the do-not-contact list",
                why=(
                    "Checked before any outreach is generated, so you never pay to "
                    "write a message that must not be sent."
                ),
                action="Review list",
                view="compliance",
                severity="info",
            )
        )

    if not actions:
        actions.append(
            ActionItem(
                id="clear",
                title="Nothing needs your attention",
                why="No decayed records, no unworked qualified accounts.",
                action="Run discovery",
                view="run",
                severity="info",
            )
        )

    return actions


@router.get("/dashboard", response_model=DashboardResponse)
async def dashboard(
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    _user: User = Depends(get_current_user),
) -> DashboardResponse:
    """The numbers the morning queue is judged on."""
    companies = await repository.list_companies(session)
    campaigns = await repository.list_campaigns(session)

    buckets: dict[str, int] = {band: 0 for band, _, _ in freshness.BANDS}
    needs_retouch = 0
    schemas_by_id = {}

    for company in companies:
        schema = repository.to_company_schema(company, settings)
        schemas_by_id[schema.id] = schema
        buckets[schema.freshness] += 1
        if schema.needsRetouch:
            needs_retouch += 1

    threshold = settings.high_icp_threshold
    qualified = await repository.count_qualified(session, threshold)
    total = len(companies)
    cost = float(await repository.total_cost(session))

    # Growth series, real, from created_at / last_verified.
    activity = await repository.monthly_activity(session)
    months = _last_months(12)
    growth = [
        GrowthPoint(
            month=key,
            label=label,
            added=activity["added"].get(key, 0),
            retouched=activity["retouched"].get(key, 0),
        )
        for key, label in months
    ]
    added_this_month = growth[-1].added if growth else 0

    suppressed = len(await repository.list_suppressions(session))
    actions = await _build_actions(session, settings, needs_retouch, suppressed)

    # Campaign performance: one row per drafted campaign, best first.
    scores = {str(c.company_id): c.personalization_score for c in campaigns}
    rows = [
        CampaignRow(
            companyId=cid,
            company=schema.name,
            icpScore=schema.icpScore,
            stage=schema.stage,
            personalization=scores.get(cid, 0),
            enriched=bool(schema.linkedinData),
        )
        for cid, schema in schemas_by_id.items()
        if cid in scores
    ]
    rows.sort(key=lambda r: (-r.personalization, -r.icpScore))

    return DashboardResponse(
        totalCompanies=total,
        qualifiedCompanies=qualified,
        qualifiedThreshold=threshold,
        totalContacts=await repository.count_contacts(session),
        campaigns=len(campaigns),
        averageIcp=await repository.average_icp(session),
        needsRetouch=needs_retouch,
        freshness=[
            FreshnessBucket(band=band, label=label, count=buckets[band])
            for band, label, _ in freshness.BANDS
        ],
        stages=await repository.stage_counts(session),
        totalCostUsd=cost,
        costPerCompany=_safe_divide(cost, total),
        costPerQualified=_safe_divide(cost, qualified),
        addedThisMonth=added_this_month,
        growth=growth,
        actions=actions,
        campaignRows=rows[:6],
    )


@router.get("/cost", response_model=CostResponse)
async def cost(
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    _user: User = Depends(get_current_user),
) -> CostResponse:
    """Where the money goes, per agent and per model."""
    rows = await repository.spend_by_agent(session)
    agents = get_agents()

    by_agent = [
        AgentSpend(
            agent=agent,
            model=model,
            calls=calls,
            inputTokens=int(input_tokens),
            outputTokens=int(output_tokens),
            costUsd=float(spend),
        )
        for agent, model, calls, input_tokens, output_tokens, spend in rows
    ]

    total_cost = sum(item.costUsd for item in by_agent)
    total_companies = await repository.count_companies(session)
    qualified = await repository.count_qualified(session, settings.high_icp_threshold)

    return CostResponse(
        totalCostUsd=round(total_cost, 6),
        totalCalls=sum(item.calls for item in by_agent),
        inputTokens=sum(item.inputTokens for item in by_agent),
        outputTokens=sum(item.outputTokens for item in by_agent),
        byAgent=by_agent,
        costPerCompany=_safe_divide(total_cost, total_companies),
        costPerQualified=_safe_divide(total_cost, qualified),
        modelLarge=agents.model_large,
        modelSmall=agents.model_small,
        refreshPolicy=[
            RefreshRule(band=band, interval=interval)
            for band, interval in freshness.refresh_policy(settings)
        ],
    )


@router.get("/suppression", response_model=SuppressionListResponse)
async def list_suppression(
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> SuppressionListResponse:
    entries = await repository.list_suppressions(session)
    return SuppressionListResponse(
        entries=[repository.to_suppression_schema(e) for e in entries],
        total=len(entries),
    )


@router.post("/suppression", response_model=SuppressionEntry, status_code=201)
async def add_suppression(
    payload: AddSuppressionRequest,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> SuppressionEntry:
    """Add an address, or a bare domain to suppress everyone there."""
    entry = await repository.add_suppression(session, payload.value, payload.reason)

    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That address or domain is already suppressed.",
        )

    await session.commit()
    logger.info("Suppressed %r (%s)", entry.value, entry.reason)
    return repository.to_suppression_schema(entry)


@router.delete("/suppression/{entry_id}", status_code=204)
async def remove_suppression(
    entry_id: str,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(require_admin),
) -> None:
    try:
        parsed = uuid.UUID(entry_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Entry not found.") from None

    if not await repository.remove_suppression(session, parsed):
        raise HTTPException(status_code=404, detail="Entry not found.")

    await session.commit()
