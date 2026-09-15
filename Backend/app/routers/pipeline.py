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
from ..contact_finder import ContactFinder, domain_resolves, normalise_domain
from ..auth import require_admin
from ..config import Settings
from ..db import get_session
from ..dependencies import get_agents
from ..models import User
from ..workspace_settings import enforce_budget, get_runtime_settings
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
    # An address the company publishes, found after research. Empty when it
    # publishes none, unless allow_guessed_emails is on.
    primary_email: str = ""
    email_is_guess: bool = False

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

    The real published address where one was found - which is what makes this
    check mean something, because it is the address that would actually be
    written to. Where none was found, a plausible one is derived from the
    company name so the check stays exercised rather than decorative.
    """
    if item.primary_email:
        return item.primary_email
    if not item.draft.decisionMakers:
        return ""
    slug = "".join(ch for ch in item.draft.name.lower() if ch.isalnum())
    first = item.draft.decisionMakers[0].name.split(" ")[0].lower()
    return f"{first}@{slug}.com" if slug else ""


@router.post("/run-pipeline", response_model=RunPipelineResponse)
async def run_pipeline(
    payload: RunPipelineRequest,
    agents: SalesAgents = Depends(get_agents),
    settings: Settings = Depends(get_runtime_settings),
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(require_admin),
) -> RunPipelineResponse:
    area = payload.location
    industry = payload.industry
    logger.info(
        "[Pipeline] Starting for ICP: %s (%s, %s)",
        payload.icp,
        area.as_label() if area else "worldwide",
        industry.as_label() if industry else "all industries",
    )
    run_usage = RunUsage()

    # The cheapest check of all comes first: whether this month may spend at all.
    await enforce_budget(session, settings, "Discover")

    # Deterministic work first, so the suppression list is loaded before any
    # money is spent on the contacts it might exclude.
    suppressed = await repository.suppressed_values(session)

    # What is already here, so the run adds to the list rather than repeating
    # it. Domains where a row has one; the name otherwise.
    existing = await repository.list_companies(session)
    known_domains = {
        normalise_domain(c.website) for c in existing if (c.website or "").strip()
    }
    known_names = {c.name.strip().lower() for c in existing if c.name.strip()}
    exclusions = sorted(known_domains) + sorted(
        c.name.strip() for c in existing if not (c.website or "").strip()
    )

    try:
        # Research more than was asked for. Only accounts with a found address
        # are kept, and roughly a third of real companies publish none - so
        # asking for exactly the number wanted would deliver fewer.
        research_count = _research_count(payload.companyCount)

        discovered = await agents.discover_companies(
            payload.icp,
            research_count,
            payload.location,
            payload.industry,
            exclude=exclusions,
        )
        run_usage.add(discovered.usage)

        # A run that finds nothing still costs money, and silently saving zero
        # accounts looks identical to a run that was never started. Say it.
        if not discovered.output.companies:
            raise AgentError(
                "The research agent searched but could not confirm a single "
                "company matching this brief. Try a wider area, a broader "
                "sector, or a less specific ICP."
            )

        prepared = [
            _PreparedCompany(
                draft=draft,
                decision_maker_ids=[uuid.uuid4() for _ in draft.decisionMakers],
            )
            for draft in discovered.output.companies
        ]

        # Check the domains before anything is written. The agent searches the
        # web for these, but a model asked for a website will still produce a
        # plausible one when the results gave it none - and an invented domain
        # is the failure that costs the most later, because every attempt to
        # find an address there fails with nothing to explain it.
        unresolved = await _drop_dead_domains([item.draft for item in prepared])
        if unresolved:
            logger.warning(
                "[Discovery] %d of %d accounts had a domain that does not "
                "resolve. Cleared it rather than storing a guess.",
                unresolved,
                len(prepared),
            )

        # The agent was told what is already here; this is for when it did not
        # listen. A repeat is dropped before any address lookup is spent on it.
        repeats = [
            item.draft.name
            for item in prepared
            if normalise_domain(item.draft.website or "") in known_domains
            or item.draft.name.strip().lower() in known_names
        ]
        if repeats:
            prepared = [item for item in prepared if item.draft.name not in repeats]
            logger.info(
                "[Discovery] Dropped %d already in the CRM: %s",
                len(repeats),
                ", ".join(repeats),
            )

        # Find a real address for each account before the suppression check, so
        # the check runs against the address that would actually be mailed.
        reachable = await _attach_published_emails(prepared, settings)
        logger.info(
            "[Discovery] %d of %d researched accounts have a published address.",
            reachable,
            len(prepared),
        )

        # Keep the ones that can be written to, up to the number asked for.
        # An account with nobody to mail is not a lead here, it is a dead row.
        dropped = [item.draft.name for item in prepared if not item.primary_email]
        prepared = [item for item in prepared if item.primary_email][: payload.companyCount]
        if dropped:
            logger.info(
                "[Discovery] Dropped %d without an address: %s",
                len(dropped),
                ", ".join(dropped),
            )
        if not prepared:
            raise AgentError(
                f"Researched {len(dropped)} real compan"
                f"{'y' if len(dropped) == 1 else 'ies'} but none of them publish "
                "an email address. Try a broader sector or area - or add a "
                "HUNTER_API_KEY to Backend/.env to look addresses up instead."
            )

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
            primary_email=item.primary_email,
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


async def _attach_published_emails(
    prepared: list[_PreparedCompany], settings: Settings
) -> int:
    """Give each account the address its company publishes. Returns how many.

    Only sourced addresses are taken - something printed on the company's own
    contact page, or held by Hunter. A pattern guess is never stored here: it
    would arrive looking exactly like a real address, and the first thing that
    happens to a stored address is a send, where a wrong one is a hard bounce
    and hard bounces are what cost a sending domain its deliverability.

    One lookup per account, run together, and a failure is just no address.
    """
    finder = ContactFinder(settings)

    async def attach(item: _PreparedCompany) -> None:
        draft = item.draft
        if not draft.website or not draft.decisionMakers:
            return
        try:
            candidates = await finder.find_published(
                full_name=draft.decisionMakers[0].name, domain=draft.website
            )
        except Exception as exc:  # noqa: BLE001 - one bad site stops one row
            logger.info("[Contact] %s: lookup failed (%s)", draft.name, type(exc).__name__)
            return
        if candidates:
            item.primary_email = candidates[0].email
            logger.info(
                "[Contact] %s -> %s (%s)",
                draft.name,
                candidates[0].email,
                candidates[0].source,
            )
            return

        # Nothing published anywhere. Only fill it in if this workspace has
        # said it would rather have a guess than a blank - see the note on
        # allow_guessed_emails in config.py.
        if not settings.allow_guessed_emails:
            return
        guess = finder.best_guess(
            full_name=draft.decisionMakers[0].name, domain=draft.website
        )
        if guess is not None:
            item.primary_email = guess.email
            item.email_is_guess = True
            logger.warning(
                "[Contact] %s -> %s (GUESSED - may bounce)", draft.name, guess.email
            )

    await asyncio.gather(*(attach(item) for item in prepared))
    guessed = sum(1 for item in prepared if item.email_is_guess)
    if guessed:
        logger.warning(
            "[Contact] %d address(es) are pattern guesses, not published "
            "addresses. Watch the bounce rate on the first send.",
            guessed,
        )
    return sum(1 for item in prepared if item.primary_email)


async def _drop_dead_domains(drafts: list[CompanyDraft]) -> int:
    """Clear any website that has no DNS behind it. Returns how many.

    Blanking beats keeping a guess: downstream, an empty website produces an
    honest "this client has no domain, add one" from the contact finder, where
    a wrong one produces six confident-looking address suggestions that can
    never be delivered to.
    """
    checks = await asyncio.gather(
        *(domain_resolves(d.website or "") for d in drafts)
    )
    cleared = 0
    for draft, resolves in zip(drafts, checks):
        if draft.website and not resolves:
            logger.info(
                "[Discovery] %s: %r does not resolve - cleared.",
                draft.name,
                draft.website,
            )
            draft.website = ""
            cleared += 1
        elif draft.website:
            # Store it in the shape the rest of the app expects.
            draft.website = normalise_domain(draft.website)
    return cleared


def _research_count(wanted: int) -> int:
    """How many accounts to research to end up with `wanted` reachable ones.

    Twice as many, within reason. Measured across real companies, about six
    in ten publish an address somewhere on their site, so double covers a
    normal run with room to spare - and the cap keeps a request for ten from
    becoming a twenty-company research bill.
    """
    return min(16, max(wanted + 2, wanted * 2))


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
