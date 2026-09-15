"""Reading and editing the saved pipeline."""

from __future__ import annotations

import logging
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from .. import repository
from ..agents import AgentError, SalesAgents
from ..auth import get_current_user, require_admin
from ..config import Settings
from ..contact_finder import ContactFinder, FinderError
from ..db import get_session
from ..dependencies import get_agents
from ..models import Mailbox, User
from ..models import DecisionMaker
from ..workspace_settings import enforce_budget, get_runtime_settings
from ..schemas import (
    Company,
    DeleteAllResponse,
    EmailCandidate,
    EnrichCompanyResponse,
    FindEmailRequest,
    FindEmailResponse,
    PipelineState,
    UpdateContactRequest,
    UpdateStageRequest,
)

logger = logging.getLogger("salesos.companies")

_PHONE_DIGITS = re.compile(r"\d")

router = APIRouter(prefix="/api/companies", tags=["companies"])


def _parse_id(company_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(company_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Company not found."
        ) from None


async def _load(session: AsyncSession, company_id: str):
    company = await repository.get_company(session, _parse_id(company_id))
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Company not found."
        )
    return company


async def _load_contact(session: AsyncSession, company, contact_id: str) -> DecisionMaker:
    try:
        parsed = uuid.UUID(contact_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Contact not found.") from None

    contact = await session.get(DecisionMaker, parsed)
    if contact is None or contact.company_id != company.id:
        raise HTTPException(status_code=404, detail="Contact not found.")
    return contact


def _dossier_lines(company) -> str:
    """The discovery research for one account, as prompt context.

    Empty fields are dropped rather than sent as blank headings - see the note
    in agents.write_outreach for why that matters.
    """
    rows = (
        ("Sells", ", ".join(company.products or [])),
        ("Latest launch", company.latest_launch or ""),
        ("Buying signals", "; ".join(company.buying_signals or [])),
        ("Likely pain points", "; ".join(company.pain_points or [])),
    )
    return "\n".join(f"{label}: {value}" for label, value in rows if value.strip())


@router.get("", response_model=PipelineState)
async def get_pipeline(
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    _user: User = Depends(get_current_user),
) -> PipelineState:
    """The whole saved board - what the dashboard loads on sign-in."""
    companies = await repository.list_companies(session)
    campaigns = await repository.list_campaigns(session)

    return PipelineState(
        companies=[repository.to_company_schema(c, settings) for c in companies],
        outreachCampaigns=[repository.to_campaign_schema(c) for c in campaigns],
    )


@router.patch("/{company_id}", response_model=Company)
async def update_company_stage(
    company_id: str,
    payload: UpdateStageRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    _user: User = Depends(get_current_user),
) -> Company:
    """Persist a drag-and-drop on the pipeline board."""
    company = await _load(session, company_id)
    await repository.update_stage(session, company, payload.stage)
    await session.commit()

    logger.info("Moved %r to stage %r", company.name, payload.stage)
    return repository.to_company_schema(company, settings)


@router.post("/{company_id}/enrich", response_model=EnrichCompanyResponse)
async def enrich_company(
    company_id: str,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    agents: SalesAgents = Depends(get_agents),
    _user: User = Depends(get_current_user),
) -> EnrichCompanyResponse:
    """Enrich one saved account and store the result with its statement type."""
    company = await _load(session, company_id)
    await enforce_budget(session, settings, "Enrichment")

    try:
        result = await agents.enrich_company(
            company.name,
            company.industry,
            company.description,
            _dossier_lines(company),
        )
    except AgentError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc

    await repository.record_model_call(
        session,
        agent=result.usage.agent,
        model=result.usage.model,
        input_tokens=result.usage.input_tokens,
        output_tokens=result.usage.output_tokens,
        cost_usd=result.usage.cost_usd,
    )
    await repository.update_enrichment(
        session,
        company,
        result.output.linkedinData,
        result.output.statementType,
        result.output.confidence,
    )
    await session.commit()

    return EnrichCompanyResponse(
        linkedinData=result.output.linkedinData,
        company=repository.to_company_schema(company, settings),
        costUsd=float(result.usage.cost_usd),
    )


@router.delete("", response_model=DeleteAllResponse)
async def clear_pipeline(
    session: AsyncSession = Depends(get_session),
    _user: User = Depends(require_admin),
) -> DeleteAllResponse:
    """Wipe every saved account. Decision makers and campaigns cascade.

    Users, the suppression list and the cost ledger are untouched.
    """
    deleted = await repository.delete_all_companies(session)
    await session.commit()

    logger.info("Cleared %d saved accounts.", deleted)
    return DeleteAllResponse(deleted=deleted)


def _clean_email(value: str) -> str:
    email = value.strip().lower()
    if email and ("@" not in email or "." not in email.split("@")[-1]):
        raise HTTPException(
            status_code=400, detail="That does not look like an email address."
        )
    return email


def _clean_phone(value: str) -> str:
    """Permissive on purpose: extensions, country codes and spacing all differ,
    and a validator strict enough to be useful would reject real numbers."""
    phone = " ".join(value.split())
    if phone and len(_PHONE_DIGITS.findall(phone)) < 6:
        raise HTTPException(
            status_code=400, detail="That does not look like a phone number."
        )
    return phone


def _clean_linkedin(value: str) -> str:
    """Accepts a full URL or a bare 'in/name' handle, stores a full URL."""
    handle = value.strip().rstrip("/")
    if not handle:
        return ""
    if handle.startswith(("http://", "https://")):
        if "linkedin.com" not in handle.lower():
            raise HTTPException(
                status_code=400, detail="That is not a LinkedIn URL."
            )
        return handle
    return f"https://www.linkedin.com/{handle.lstrip('/')}"


@router.post(
    "/{company_id}/contacts/{contact_id}/find-email",
    response_model=FindEmailResponse,
)
async def find_contact_email(
    company_id: str,
    contact_id: str,
    payload: FindEmailRequest | None = None,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    _user: User = Depends(get_current_user),
) -> FindEmailResponse:
    """Look up candidate addresses for one contact. Saves nothing.

    Returns every candidate with its provenance and the recipient mail
    server's verdict, and a person picks one - which then goes in through the
    PATCH endpoint below like any hand-typed address. Keeping the two steps
    apart is the point: a lookup is a suggestion, and only a person turns a
    suggestion into something this app will send mail to.
    """
    company = await _load(session, company_id)
    contact = await _load_contact(session, company, contact_id)

    domain = (payload.domain if payload else "") or company.website
    finder = ContactFinder(settings)

    # A probe that identifies itself with a real, deliverable address gets an
    # answer far more often than one from a made-up sender.
    probe_sender = await session.scalar(
        select(Mailbox.address)
        .where(Mailbox.is_active.is_(True), Mailbox.status == "connected")
        .limit(1)
    )

    try:
        result = await finder.find(
            full_name=contact.name, domain=domain, probe_sender=probe_sender or ""
        )
    except FinderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Looked up %s at %s: %d candidate(s), mail server %s",
        contact.name,
        result.domain,
        len(result.candidates),
        "reachable" if result.mailServerReachable else "unreachable",
    )

    return FindEmailResponse(
        domain=result.domain,
        candidates=[EmailCandidate(**vars(c)) for c in result.candidates],
        note=result.note,
        mailServerReachable=result.mailServerReachable,
        hunterConfigured=finder.hunter_configured,
    )


@router.patch("/{company_id}/contacts/{contact_id}", response_model=Company)
async def update_contact(
    company_id: str,
    contact_id: str,
    payload: UpdateContactRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_runtime_settings),
    _user: User = Depends(get_current_user),
) -> Company:
    """Set the channels a person can be reached on.

    This is the only way an address or a number enters the system. The
    discovery agent is given neither field, so nothing sendable or dialable
    here was invented by a model - which matters, because the next thing that
    happens to them is a real send or a real call.

    LinkedIn is the exception: the agent guesses one, and editing it here is
    what marks it as checked by a person.

    A field left out of the payload is left as it was, so the panel can save
    one channel without clearing the other two.
    """
    company = await _load(session, company_id)
    contact = await _load_contact(session, company, contact_id)

    await repository.update_contact_channels(
        session,
        contact,
        email=None if payload.email is None else _clean_email(payload.email),
        phone=None if payload.phone is None else _clean_phone(payload.phone),
        linkedin=(
            None if payload.linkedin is None else _clean_linkedin(payload.linkedin)
        ),
    )
    await session.commit()
    await session.refresh(company)

    changed = [
        name
        for name, value in (
            ("email", payload.email),
            ("phone", payload.phone),
            ("linkedin", payload.linkedin),
        )
        if value is not None
    ]
    logger.info("Updated %s on a contact at %s", ", ".join(changed) or "nothing", company.name)
    return repository.to_company_schema(company, settings)
