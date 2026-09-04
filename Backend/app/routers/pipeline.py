"""Run the agent chain, price it, and persist the results."""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import repository
from ..agents import AgentError, RunUsage, SalesAgents
from ..auth import get_current_user
from ..config import Settings, get_settings
from ..db import get_session
from ..dependencies import get_agents
from ..models import User
from ..schemas import (
    CompanyDraft,
    SearchArea,
    CrmConfig,
    OutreachDraft,
    RunPipelineRequest,
    RunPipelineResponse,
)

logger = logging.getLogger("salesos.pipeline")

router = APIRouter(prefix="/api", tags=["pipeline"])


@dataclass
class _PreparedCompany:
    """One account with its ids fixed before anything is written."""

    draft: CompanyDraft
    company_id: uuid.UUID = field(default_factory=uuid.uuid4)
    decision_maker_ids: list[uuid.UUID] = field(default_factory=list)
    outreach: OutreachDraft | None = None
    suppressed: bool = False

    @property
    def primary_decision_maker_id(self) -> uuid.UUID | None:
        return self.decision_maker_ids[0] if self.decision_maker_ids else None


async def _sync_to_crm(crm_config: CrmConfig | None, count: int, settings: Settings) -> bool:
    """Simulated CRM push. No record leaves this process."""
    if not (crm_config and crm_config.enabled and crm_config.status == "connected"):
        return False

    provider = crm_config.provider or "CRM"
    logger.info("[CRM] Pushing %d records to %s...", count, provider)
    await asyncio.sleep(settings.crm_sync_delay_seconds)
    logger.info("[CRM] Pushed to %s.", provider)
    return True


async def _draft_outreach(
    agents: SalesAgents,
    icp: str,
    prepared: list[_PreparedCompany],
    settings: Settings,
    run_usage: RunUsage,
) -> None:
    """Fill in `outreach` on each account, a few at a time.

    Suppressed contacts are skipped before the model is called - section K1,
    deterministic before probabilistic. There is no point paying to personalize
    a message that may never be sent.
    """
    targets = [p for p in prepared if p.draft.decisionMakers and not p.suppressed]
    if not targets:
        return

    semaphore = asyncio.Semaphore(max(1, settings.max_concurrent_outreach))

    async def draft(item: _PreparedCompany) -> None:
        async with semaphore:
            try:
                result = await agents.write_outreach(
                    icp, item.draft, item.draft.decisionMakers[0]
                )
            except AgentError:
                # One failed draft should not sink the whole run.
                logger.warning("[Personalization] Skipped %s", item.draft.name)
                return
            item.outreach = result.output
            run_usage.add(result.usage)

    await asyncio.gather(*(draft(item) for item in targets))


def _contact_target(item: _PreparedCompany) -> str:
    """What the suppression list is checked against.

    The prototype has no verified email addresses, so a plausible one is
    derived from the company name purely so the suppression check is real and
    testable rather than decorative.
    """
    if not item.draft.decisionMakers:
        return ""
    slug = "".join(ch for ch in item.draft.name.lower() if ch.isalnum())
    first = item.draft.decisionMakers[0].name.split(" ")[0].lower()
    return f"{first}@{slug}.com" if slug else ""


@router.post("/run-pipeline", response_model=RunPipelineResponse)
async def run_pipeline(
    payload: RunPipelineRequest,
    agents: SalesAgents = Depends(get_agents),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> RunPipelineResponse:
    area = payload.location
    logger.info(
        "[Pipeline] Starting for ICP: %s (%s)",
        payload.icp,
        area.as_label() if area else "worldwide",
    )
    run_usage = RunUsage()

    # Deterministic work first, so the suppression list is loaded before any
    # money is spent on the contacts it might exclude.
    suppressed = await repository.suppressed_values(session)

    try:
        discovered = await agents.discover_companies(
            payload.icp, payload.companyCount, payload.location
        )
        run_usage.add(discovered.usage)

        prepared = [
            _PreparedCompany(
                draft=draft,
                decision_maker_ids=[uuid.uuid4() for _ in draft.decisionMakers],
            )
            for draft in discovered.output.companies
        ]

        for item in prepared:
            item.suppressed = repository.is_suppressed(_contact_target(item), suppressed)

        skipped = sum(1 for item in prepared if item.suppressed)
        if skipped:
            logger.info("[Suppression] Skipped outreach for %d contact(s).", skipped)

        await _draft_outreach(agents, payload.icp, prepared, settings, run_usage)
    except AgentError as exc:
        # Record what was already spent before the failure - a run that dies
        # halfway still cost money, and hiding that makes the dashboard lie.
        await _record_usage(session, run_usage)
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc

    for item in prepared:
        await repository.save_company(
            session,
            item.draft,
            payload.icp,
            company_id=item.company_id,
            decision_maker_ids=item.decision_maker_ids,
        )

        dm_id = item.primary_decision_maker_id
        if item.outreach is not None and dm_id is not None:
            await repository.save_campaign(session, item.outreach, item.company_id, dm_id)

    await _record_usage(session, run_usage)
    await session.commit()

    logger.info(
        "[Pipeline] Saved %d accounts. Run cost $%s.", len(prepared), run_usage.total_cost
    )

    crm_synced = await _sync_to_crm(payload.crmConfig, len(prepared), settings)

    companies = await repository.list_companies(session)
    campaigns = await repository.list_campaigns(session)

    off_target = _off_target([item.draft for item in prepared], payload.location)
    if off_target:
        logger.warning(
            "[Discovery] %d of %d accounts are outside %s.",
            off_target, len(prepared), payload.location.as_label(),  # type: ignore[union-attr]
        )

    return RunPipelineResponse(
        companies=[repository.to_company_schema(c, settings) for c in companies],
        outreachCampaigns=[repository.to_campaign_schema(c) for c in campaigns],
        crmSynced=crm_synced,
        newCompanies=len(prepared),
        suppressedContacts=sum(1 for item in prepared if item.suppressed),
        runCostUsd=float(run_usage.total_cost),
        offTarget=off_target,
        searchedArea=payload.location.as_label() if payload.location else "",
    )


def _off_target(drafts, area: SearchArea | None) -> int:
    """How many accounts came back from outside the area that was asked for.

    A substring check against `headquarters`, which is crude but catches the
    failure that matters: asking for Pune and being handed Bengaluru. The
    prompt tells the model to return fewer rather than drift, and this is what
    tells you whether it listened - silently accepting drift would make the
    filter worse than not having one.
    """
    if area is None or not area.is_set:
        return 0
    needle = area.value.strip().lower()
    return sum(1 for d in drafts if needle not in (d.headquarters or "").lower())


async def _record_usage(session: AsyncSession, run_usage: RunUsage) -> None:
    for call in run_usage.calls:
        await repository.record_model_call(
            session,
            agent=call.agent,
            model=call.model,
            input_tokens=call.input_tokens,
            output_tokens=call.output_tokens,
            cost_usd=call.cost_usd,
        )
