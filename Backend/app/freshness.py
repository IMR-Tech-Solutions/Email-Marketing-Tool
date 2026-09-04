"""Freshness bands and the refresh policy.

Section K2 of the architecture draft: refresh on dependency, not on schedule.

A record is worth re-verifying only when its freshness has decayed AND
something depends on it - an active campaign, or a high ICP score. Everything
else waits. Re-enriching the whole database on a calendar is the expensive way
to be wrong.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .config import Settings
from .schemas import FreshnessBand

# Upper bound in days for each band. Section: Database health on the dashboard.
BANDS: list[tuple[FreshnessBand, str, int | None]] = [
    ("fresh", "Fresh - 0-30 days", 30),
    ("good", "Good - 31-90 days", 90),
    ("aging", "Aging - 91-180 days", 180),
    ("stale", "Stale - 181-365 days", 365),
    ("critical", "Critical - 365+ days", None),
]

BAND_LABELS: dict[FreshnessBand, str] = {band: label for band, label, _ in BANDS}


def age_in_days(last_verified: datetime | None) -> int:
    if last_verified is None:
        return 0
    now = datetime.now(timezone.utc)
    if last_verified.tzinfo is None:
        last_verified = last_verified.replace(tzinfo=timezone.utc)
    return max(0, (now - last_verified).days)


def band_for(days: int) -> FreshnessBand:
    for band, _, upper in BANDS:
        if upper is None or days <= upper:
            return band
    return "critical"


def needs_retouch(
    days: int, icp_score: int, in_campaign: bool, settings: Settings
) -> bool:
    """The dependency rule, in one function.

    High ICP and in a campaign: 30 days. High ICP but dormant: 90. Mid ICP: 180.
    Low ICP that never engaged: on demand only, so never automatically.
    """
    high_icp = icp_score >= settings.high_icp_threshold

    if high_icp and in_campaign:
        return days >= settings.refresh_days_high_icp_active
    if high_icp:
        return days >= settings.refresh_days_high_icp_dormant
    if icp_score >= settings.high_icp_threshold // 2:
        return days >= settings.refresh_days_mid_icp

    # Low ICP, never engaged: on demand only.
    return False


def refresh_policy(settings: Settings) -> list[tuple[str, str]]:
    """The policy as displayable rows, so the UI never hardcodes the numbers."""
    return [
        ("High ICP, in a campaign", f"every {settings.refresh_days_high_icp_active} days"),
        ("High ICP, dormant", f"every {settings.refresh_days_high_icp_dormant} days"),
        ("Mid ICP", f"every {settings.refresh_days_mid_icp} days"),
        ("Low ICP, never engaged", "on demand only"),
    ]
