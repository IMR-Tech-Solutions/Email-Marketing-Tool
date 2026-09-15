"""Workspace settings - read by everyone, written by admins.

Everything here is a default or a policy the rest of the app reads: what
Discover opens with, when a record counts as qualified, how a bulk send is
paced, which signature goes under a campaign email, and how much the month
may cost. Secrets and model ids stay in .env - they are reported here so
nobody hunts for a control that is not there, but never edited.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import repository
from .. import workspace_settings as ws
from ..auth import get_current_user, require_admin
from ..config import Settings, get_settings
from ..db import get_session
from ..dependencies import get_agents
from ..models import User, WorkspaceSettings
from ..schemas import (
    WorkspaceSettingsResponse,
    WorkspaceSettingsUpdate,
    WorkspaceSettingsValues,
)

logger = logging.getLogger("salesos.settings")

router = APIRouter(prefix="/api/settings", tags=["settings"])


async def _response(
    session: AsyncSession, settings: Settings, row: WorkspaceSettings
) -> WorkspaceSettingsResponse:
    agents = get_agents()
    return WorkspaceSettingsResponse(
        settings=ws.to_values(row),
        envDefaults=ws.env_defaults(settings),
        spentThisMonthUsd=float(await repository.month_to_date_cost(session)),
        modelLarge=agents.model_large,
        modelSmall=agents.model_small,
        claudeConfigured=agents.is_configured,
        hunterConfigured=settings.hunter_configured,
        sessionHours=settings.session_hours,
        updatedAt=row.updated_at.isoformat() if row.updated_at else None,
    )


def _tidy(values: WorkspaceSettingsValues) -> WorkspaceSettingsValues:
    """Trim the free-text fields. A signature is stored bare; the blank line
    above it is added at send time."""
    return values.model_copy(
        update={
            "workspaceName": values.workspaceName.strip(),
            "defaultGeoValue": values.defaultGeoValue.strip(),
            "defaultIndustryValue": values.defaultIndustryValue.strip(),
            "signatureTech": values.signatureTech.strip(),
            "signatureMarketResearch": values.signatureMarketResearch.strip(),
        }
    )


def _check(values: WorkspaceSettingsValues) -> None:
    """The cross-field rules a per-field bound cannot express."""
    if not values.workspaceName:
        raise HTTPException(status_code=400, detail="Give the workspace a name.")
    if values.defaultGeoScope != "global" and not values.defaultGeoValue:
        raise HTTPException(
            status_code=400,
            detail="Name the default city, state or country, or set the area to Worldwide.",
        )
    if values.defaultIndustryMode != "all" and not values.defaultIndustryValue:
        raise HTTPException(
            status_code=400,
            detail="Name the default sector, or set it to All industries.",
        )
    ordered = (
        values.refreshDaysHighIcpActive
        <= values.refreshDaysHighIcpDormant
        <= values.refreshDaysMidIcp
    )
    if not ordered:
        raise HTTPException(
            status_code=400,
            detail=(
                "Refresh intervals must get longer as the dependency weakens: "
                "in a campaign <= dormant <= mid ICP."
            ),
        )


@router.get("", response_model=WorkspaceSettingsResponse)
async def get_workspace_settings(
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    _user: User = Depends(get_current_user),
) -> WorkspaceSettingsResponse:
    """Both roles read these - a rep's Discover and Bulk screens open with them."""
    row = await ws.load(session, settings)
    return await _response(session, settings, row)


@router.put("", response_model=WorkspaceSettingsResponse)
async def update_workspace_settings(
    payload: WorkspaceSettingsUpdate,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    admin: User = Depends(require_admin),
) -> WorkspaceSettingsResponse:
    """Change some fields. Anything not sent is left exactly as it was."""
    row = await ws.load(session, settings)

    changes = {
        key: value
        for key, value in payload.model_dump(exclude_unset=True).items()
        if value is not None
    }
    if not changes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to change.")

    merged = _tidy(ws.to_values(row).model_copy(update=changes))
    _check(merged)

    ws.apply_values(row, merged)
    await session.commit()
    await session.refresh(row)

    logger.info("%r changed workspace settings: %s", admin.username, ", ".join(sorted(changes)))
    return await _response(session, settings, row)


@router.post("/reset", response_model=WorkspaceSettingsResponse)
async def reset_workspace_settings(
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    admin: User = Depends(require_admin),
) -> WorkspaceSettingsResponse:
    """Back to the .env values - or the built-in ones where .env is silent."""
    row = await ws.load(session, settings)
    ws.apply_values(row, ws.env_defaults(settings))
    await session.commit()
    await session.refresh(row)

    logger.info("%r reset workspace settings to the .env defaults", admin.username)
    return await _response(session, settings, row)
