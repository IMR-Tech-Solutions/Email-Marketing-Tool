"""Workspace settings - the one row an admin edits from the Settings screen.

.env seeds the row the first time anything reads it, the same arrangement the
users table has with DASHBOARD_USERNAME: after that the row is the source of
truth, and the .env values are what "Reset to defaults" restores.

Routes whose answers depend on these values take `get_runtime_settings`
instead of `get_settings`. It is the .env Settings object with the editable
fields overlaid from the row, so the rest of the code keeps reading
`settings.high_icp_threshold` and never knows the number came from Postgres.
"""

from __future__ import annotations

import json
import logging
from decimal import Decimal

from fastapi import Depends, HTTPException, status
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from . import repository
from .config import Settings, get_settings
from .db import get_session
from .models import WorkspaceSettings
from .schemas import WorkspaceSettingsValues
from .signatures import SIGNATURES, Business

logger = logging.getLogger("salesos.settings")

# There is exactly one row, and this is its id.
ROW_ID = 1

# Schema field -> column. One table for both directions, so a field can never
# be read from one column and written to another.
_COLUMNS: dict[str, str] = {
    "workspaceName": "workspace_name",
    "defaultCompanyCount": "default_company_count",
    "defaultAreas": "default_areas",
    "defaultSectors": "default_sectors",
    "highIcpThreshold": "high_icp_threshold",
    "refreshDaysHighIcpActive": "refresh_days_high_icp_active",
    "refreshDaysHighIcpDormant": "refresh_days_high_icp_dormant",
    "refreshDaysMidIcp": "refresh_days_mid_icp",
    "defaultBatchSize": "default_batch_size",
    "defaultDelaySeconds": "default_delay_seconds",
    "defaultDailyLimit": "default_daily_limit",
    "allowGuessedEmails": "allow_guessed_emails",
    "monthlyBudgetUsd": "monthly_budget_usd",
    "signatureTech": "signature_tech",
    "signatureMarketResearch": "signature_market_research",
}


def env_defaults(settings: Settings) -> WorkspaceSettingsValues:
    """What a fresh workspace starts with, and what Reset restores."""
    return WorkspaceSettingsValues(
        workspaceName="Revenue workspace",
        # Discover opens on one account: that is what a new brief costs to
        # try. Raise it here once the brief has proven itself.
        defaultCompanyCount=1,
        defaultAreas=[],
        defaultSectors=[],
        highIcpThreshold=settings.high_icp_threshold,
        refreshDaysHighIcpActive=settings.refresh_days_high_icp_active,
        refreshDaysHighIcpDormant=settings.refresh_days_high_icp_dormant,
        refreshDaysMidIcp=settings.refresh_days_mid_icp,
        defaultBatchSize=10,
        defaultDelaySeconds=15,
        defaultDailyLimit=40,
        allowGuessedEmails=settings.allow_guessed_emails,
        monthlyBudgetUsd=settings.monthly_budget_usd,
        signatureTech=SIGNATURES["tech"],
        signatureMarketResearch=SIGNATURES["market_research"],
    )


# Stored as JSON text - see the note on the columns in models.py.
_JSON_FIELDS = ("defaultAreas", "defaultSectors")


def _stored(field: str, value: object) -> object:
    """The column value for one field."""
    if field not in _JSON_FIELDS:
        return value
    items = [v.model_dump() if hasattr(v, "model_dump") else v for v in value]  # type: ignore[union-attr]
    return json.dumps(items)


def _loaded(field: str, raw: object) -> object:
    """The field value for one column. A corrupt list reads as empty."""
    if field not in _JSON_FIELDS:
        return raw
    try:
        parsed = json.loads(raw or "[]")  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def to_values(row: WorkspaceSettings) -> WorkspaceSettingsValues:
    data = {field: _loaded(field, getattr(row, column)) for field, column in _COLUMNS.items()}
    data["monthlyBudgetUsd"] = float(row.monthly_budget_usd or 0)
    return WorkspaceSettingsValues(**data)


def apply_values(row: WorkspaceSettings, values: WorkspaceSettingsValues) -> None:
    for field, column in _COLUMNS.items():
        setattr(row, column, _stored(field, getattr(values, field)))


async def load(session: AsyncSession, settings: Settings) -> WorkspaceSettings:
    """The row, created from .env if this is the first time anything asked.

    The frontend fires a dozen requests the moment someone signs in, so the
    first read after an upgrade is a race. ON CONFLICT DO NOTHING lets every
    request try the insert and exactly one of them win.
    """
    row = await session.get(WorkspaceSettings, ROW_ID)
    if row is not None:
        return row

    defaults = env_defaults(settings)
    stmt = (
        pg_insert(WorkspaceSettings)
        .values(
            id=ROW_ID,
            **{column: _stored(field, getattr(defaults, field)) for field, column in _COLUMNS.items()},
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    result = await session.execute(stmt)
    if result.rowcount:
        logger.info(
            "Seeded workspace settings from .env. The database is the source of "
            "truth from now on; Settings > Data > Reset restores these values."
        )

    row = await session.get(WorkspaceSettings, ROW_ID)
    if row is None:  # pragma: no cover - the insert above guarantees a row
        raise RuntimeError("The workspace_settings row could not be created.")
    return row


async def get_runtime_settings(
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Settings:
    """The .env settings with the admin-editable fields overlaid from the row."""
    row = await load(session, settings)
    return settings.model_copy(
        update={
            "high_icp_threshold": row.high_icp_threshold,
            "refresh_days_high_icp_active": row.refresh_days_high_icp_active,
            "refresh_days_high_icp_dormant": row.refresh_days_high_icp_dormant,
            "refresh_days_mid_icp": row.refresh_days_mid_icp,
            "allow_guessed_emails": row.allow_guessed_emails,
            "monthly_budget_usd": float(row.monthly_budget_usd or 0),
        }
    )


async def effective_signatures(
    session: AsyncSession, settings: Settings
) -> dict[Business, str]:
    """The sign-off for each business, as the admin last saved it."""
    row = await load(session, settings)
    return {
        "tech": row.signature_tech,
        "market_research": row.signature_market_research,
    }


async def enforce_budget(session: AsyncSession, settings: Settings, what: str) -> None:
    """Refuse a model call once the month's recorded spend has reached the cap.

    Checked before the call, against what has actually been recorded - so a
    run that starts just under the cap still finishes, and it is the next one
    that gets refused. A cap of 0 means no cap.
    """
    cap = Decimal(str(settings.monthly_budget_usd or 0))
    if cap <= 0:
        return
    spent = await repository.month_to_date_cost(session)
    if spent >= cap:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"This month's AI budget is spent: ${spent:.2f} of the ${cap:.2f} cap. "
                f"{what} is paused until an admin raises the cap in Settings or the "
                "month rolls over."
            ),
        )
