"""Templates, priority queue, retouch centre and the agent roster."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import freshness, repository
from ..auth import get_current_user, require_admin
from ..config import Settings
from ..db import get_session
from ..dependencies import get_agents
from ..models import Company, EmailMessage, ModelCall, Template, User
from ..pricing import call_cost
from ..workspace_settings import get_runtime_settings
from ..schemas import (
    AgentsResponse,
    AgentStatus,
    PriorityQueueResponse,
    QueueItem,
    RefreshRule,
    RetouchIssue,
    RetouchResponse,
    TemplateIn,
    TemplateListResponse,
    TemplateOut,
)

logger = logging.getLogger("salesos.workspace")

router = APIRouter(prefix="/api", tags=["workspace"])

SUPPORTED_VARIABLES = [
    "first_name",
    "last_name",
    "company_name",
    "job_title",
    "industry",
    "employee_band",
    "location",
    "trigger_event",
    "research_snippet",
]

_VARIABLE_RE = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")

# A typical enrichment call on the small model, used for the batch estimate.
_ESTIMATE_INPUT_TOKENS = 320
_ESTIMATE_OUTPUT_TOKENS = 140


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------


def _template_out(template: Template) -> TemplateOut:
    found = _VARIABLE_RE.findall(f"{template.subject} {template.body}")
    return TemplateOut(
        id=str(template.id),
        name=template.name,
        whenToUse=template.when_to_use,
        subject=template.subject,
        body=template.body,
        uses=template.uses,
        variables=sorted(set(found)),
        updatedAt=template.updated_at.isoformat() if template.updated_at else "",
    )


@router.get("/templates", response_model=TemplateListResponse)
async def list_templates(
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> TemplateListResponse:
    result = await session.execute(select(Template).order_by(Template.name))
    return TemplateListResponse(
        templates=[_template_out(t) for t in result.scalars().all()],
        supportedVariables=SUPPORTED_VARIABLES,
    )


@router.post("/templates", response_model=TemplateOut, status_code=201)
async def create_template(
    payload: TemplateIn,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(require_admin),
) -> TemplateOut:
    unknown = {
        v
        for v in _VARIABLE_RE.findall(f"{payload.subject} {payload.body}")
        if v not in SUPPORTED_VARIABLES
    }
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Unknown variable(s): {', '.join(sorted(unknown))}. "
                "A template that references a variable nothing fills would send "
                "a sentence with a hole in it."
            ),
        )

    existing = await session.scalar(select(Template).where(Template.name == payload.name.strip()))
    if existing is not None:
        raise HTTPException(status_code=409, detail="A template with that name exists.")

    template = Template(
        name=payload.name.strip(),
        when_to_use=payload.whenToUse.strip(),
        subject=payload.subject,
        body=payload.body,
    )
    session.add(template)
    await session.commit()
    return _template_out(template)


@router.put("/templates/{template_id}", response_model=TemplateOut)
async def update_template(
    template_id: str,
    payload: TemplateIn,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(require_admin),
) -> TemplateOut:
    try:
        parsed = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Template not found.") from None

    template = await session.get(Template, parsed)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found.")

    template.name = payload.name.strip()
    template.when_to_use = payload.whenToUse.strip()
    template.subject = payload.subject
    template.body = payload.body
    await session.commit()
    return _template_out(template)


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(
    template_id: str,
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(require_admin),
) -> None:
    try:
        parsed = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Template not found.") from None

    template = await session.get(Template, parsed)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found.")
    await session.delete(template)
    await session.commit()


# --------------------------------------------------------------------------
# Priority queue
# --------------------------------------------------------------------------


@router.get("/priority-queue", response_model=PriorityQueueResponse)
async def priority_queue(
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    _user: User = Depends(get_current_user),
) -> PriorityQueueResponse:
    """Who deserves attention now, and why.

    The reasoning is shown on every row on purpose: a queue you cannot argue
    with is a queue nobody uses.
    """
    companies = await repository.list_companies(session)

    # Threads where the prospect spoke last are the strongest signal there is.
    awaiting = await session.execute(
        select(EmailMessage.company_id, func.max(EmailMessage.sent_at))
        .where(EmailMessage.direction == "inbound", EmailMessage.company_id.is_not(None))
        .group_by(EmailMessage.company_id)
    )
    awaiting_ids = {str(cid): at for cid, at in awaiting.all()}

    positive = await session.execute(
        select(EmailMessage.company_id)
        .where(
            EmailMessage.direction == "inbound",
            EmailMessage.classification.in_(["positive", "referral"]),
            EmailMessage.company_id.is_not(None),
        )
        .distinct()
    )
    positive_ids = {str(row[0]) for row in positive.all()}

    contacted = await session.execute(
        select(EmailMessage.company_id)
        .where(EmailMessage.direction == "outbound", EmailMessage.company_id.is_not(None))
        .distinct()
    )
    contacted_ids = {str(row[0]) for row in contacted.all()}

    items: list[QueueItem] = []
    for company in companies:
        schema = repository.to_company_schema(company, settings)
        cid = schema.id
        score = 0
        reasons: list[str] = []
        action, view = "Open account", "companies"

        if cid in positive_ids:
            score += 50
            reasons.append("Replied positively")
            action, view = "Open the thread", "inbox"

        if cid in awaiting_ids:
            score += 30
            reasons.append("Waiting on your reply")
            action, view = "Open the thread", "inbox"

        if schema.icpScore >= settings.high_icp_threshold:
            score += 20
            reasons.append(f"High ICP ({schema.icpScore})")

        if cid not in contacted_ids and schema.icpScore >= settings.high_icp_threshold:
            score += 15
            reasons.append("Qualified but never contacted")
            action, view = "Send outreach", "outreach"

        if schema.needsRetouch:
            score += 10
            reasons.append(f"Data decayed ({schema.freshnessDays}d)")

        if schema.stage in {"engaged", "proposal"}:
            score += 12
            reasons.append(f"Active deal at {schema.stage}")

        if not schema.linkedinData and schema.icpScore >= settings.high_icp_threshold:
            score += 5
            reasons.append("No enrichment yet")

        if score == 0:
            continue

        contact = schema.decisionMakers[0] if schema.decisionMakers else None
        items.append(
            QueueItem(
                companyId=cid,
                company=schema.name,
                contact=contact.name if contact else "-",
                contactTitle=contact.title if contact else "",
                icpScore=schema.icpScore,
                stage=schema.stage,
                score=min(100, score),
                reasons=reasons,
                action=action,
                view=view,
            )
        )

    items.sort(key=lambda i: (-i.score, -i.icpScore))

    return PriorityQueueResponse(
        items=items[:25],
        generatedAt=datetime.now(timezone.utc).isoformat(),
        weighting=[
            "A positive reply outranks everything else",
            "An unanswered message from a prospect",
            "High ICP score",
            "Qualified but never contacted",
            "An active deal in progress",
            "Data that has decayed past its refresh interval",
        ],
    )


# --------------------------------------------------------------------------
# Retouch centre
# --------------------------------------------------------------------------


@router.get("/retouch", response_model=RetouchResponse)
async def retouch(
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    _user: User = Depends(get_current_user),
) -> RetouchResponse:
    """The decayed-record queue, priced before you approve anything."""
    companies = await repository.list_companies(session)
    agents = get_agents()

    flagged = 0
    stale_high_icp = 0
    missing_enrichment = 0
    critical = 0

    for company in companies:
        schema = repository.to_company_schema(company, settings)
        if schema.needsRetouch:
            flagged += 1
            if schema.icpScore >= settings.high_icp_threshold:
                stale_high_icp += 1
        if not schema.linkedinData and schema.icpScore >= settings.high_icp_threshold:
            missing_enrichment += 1
        if schema.freshness == "critical":
            critical += 1

    per_record = call_cost(agents.model_small, _ESTIMATE_INPUT_TOKENS, _ESTIMATE_OUTPUT_TOKENS)
    estimated = per_record * flagged

    # What a blanket refresh of everything would have cost instead.
    full_refresh = per_record * len(companies)

    issues = [
        RetouchIssue(
            issue="High-ICP records past their refresh interval",
            count=stale_high_icp,
            severity="high",
            resolution="Re-enrich - these are attached to something you are doing",
        ),
        RetouchIssue(
            issue="Qualified accounts with no enrichment at all",
            count=missing_enrichment,
            severity="medium",
            resolution="Run enrichment on the small model",
        ),
        RetouchIssue(
            issue="Records not verified in over a year",
            count=critical,
            severity="medium",
            resolution="Re-verify only if ICP or a campaign depends on them",
        ),
        RetouchIssue(
            issue="Low-ICP records that have never engaged",
            count=max(0, len(companies) - flagged - missing_enrichment),
            severity="low",
            resolution="Leave alone - on demand only",
        ),
    ]

    return RetouchResponse(
        totalRecords=len(companies),
        flagged=flagged,
        issues=[i for i in issues if i.count > 0],
        estimatedCostUsd=float(estimated),
        costPerRecordUsd=float(per_record),
        savedVersusFullRefreshUsd=float(max(full_refresh - estimated, 0)),
        smallModel=agents.model_small,
        refreshPolicy=[
            RefreshRule(band=band, interval=interval)
            for band, interval in freshness.refresh_policy(settings)
        ],
    )


# --------------------------------------------------------------------------
# Agent roster
# --------------------------------------------------------------------------

AGENT_DEFS: list[tuple[str, str, str, str, str, str]] = [
    (
        "discovery",
        "Discovery & research",
        "large",
        "You run Discover",
        "Cost preview before the run",
        "Finds accounts matching the ICP, scores them, and names decision makers",
    ),
    (
        "personalization",
        "Outreach & personalization",
        "large",
        "A discovery run completes",
        "Nothing sends without you pressing send",
        "Writes the email, LinkedIn note, call opener and objection handling",
    ),
    (
        "enrichment",
        "Enrichment",
        "small",
        "You enrich an account",
        "None - output is labelled, never quotable",
        "Adds an intelligence note tagged data, inference or generation",
    ),
    (
        "reply_triage",
        "Reply triage",
        "small",
        "An inbox sync finds a new reply",
        "Auto-acts only on unsubscribe",
        "Classifies replies and suppresses opt-outs automatically",
    ),
]


@router.get("/agents", response_model=AgentsResponse)
async def agent_roster(
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> AgentsResponse:
    """Every agent, what triggers it, what it costs, and who approves it."""
    agents = get_agents()

    stats = await session.execute(
        select(
            ModelCall.agent,
            func.count(),
            func.coalesce(func.sum(ModelCall.cost_usd), 0),
            func.max(ModelCall.created_at),
        ).group_by(ModelCall.agent)
    )
    by_agent = {
        row[0]: {"calls": row[1], "cost": float(row[2]), "last": row[3]} for row in stats.all()
    }

    roster: list[AgentStatus] = []
    for key, name, tier, trigger, approval, role in AGENT_DEFS:
        stat = by_agent.get(key, {"calls": 0, "cost": 0.0, "last": None})
        calls = stat["calls"]
        roster.append(
            AgentStatus(
                name=name,
                role=role,
                tier=tier,  # type: ignore[arg-type]
                model=agents.model_large if tier == "large" else agents.model_small,
                trigger=trigger,
                approval=approval,
                calls=calls,
                costUsd=round(stat["cost"], 6),
                avgCostUsd=round(stat["cost"] / calls, 6) if calls else 0.0,
                lastRunAt=stat["last"].isoformat() if stat["last"] else None,
            )
        )

    return AgentsResponse(
        agents=roster,
        modelLarge=agents.model_large,
        modelSmall=agents.model_small,
        totalCostUsd=round(sum(a.costUsd for a in roster), 6),
        orchestratorPolicy=[
            "Deterministic checks run before any model call - suppression and "
            "duplicate lookups are code, not inference",
            "Small models handle classification and scoring; large models are "
            "reserved for research and personalization",
            "No email leaves the system without a person pressing send",
            "An unsubscribe reply suppresses the sender automatically, and that "
            "is the only action taken without asking",
        ],
    )
