"""Application settings, loaded from the environment or a local .env file."""

import logging
import secrets
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("salesos.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Database ---------------------------------------------------------
    # postgresql://user:password@host:port/dbname
    database_url: str = ""

    # --- Claude ------------------------------------------------------------
    anthropic_api_key: str = ""

    # Section K3 of the architecture draft: route models by task, not by habit.
    # Scoring and classification are cheap and structured; research and
    # personalization are where quality shows up in reply rates.
    claude_model_large: str = "claude-opus-5"
    claude_model_small: str = "claude-haiku-4-5"

    # --- Contact finding ---------------------------------------------------
    # Optional. Without it, "Find email" falls back to pattern guesses checked
    # against the mail server, which is honest but has a lower hit rate.
    # Free tier at https://hunter.io/api-keys
    hunter_api_key: str = ""

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- Dashboard login -------------------------------------------------
    # Seeds the first row of the users table on an empty database. After that
    # the database is the source of truth; use scripts/manage_user.py to add
    # accounts or reset a password.
    dashboard_username: str = "admin"
    dashboard_password: str = ""
    # Signs the session tokens. Generated per-process if left blank, which
    # logs everyone out whenever the server restarts.
    session_secret: str = ""
    session_hours: int = 12

    max_concurrent_outreach: int = 4

    # The original AI Studio build padded these calls to make the simulated
    # integrations feel like real network work. Kept, but configurable.
    enrichment_delay_seconds: float = 1.5
    crm_sync_delay_seconds: float = 0.8

    # Refresh policy (section K2): a record is re-verified when its freshness
    # has decayed AND something depends on it. Days per ICP band.
    refresh_days_high_icp_active: int = 30
    refresh_days_high_icp_dormant: int = 90
    refresh_days_mid_icp: int = 180
    high_icp_threshold: int = 75

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def seed_login_configured(self) -> bool:
        return bool(self.dashboard_username and self.dashboard_password)

    @property
    def database_configured(self) -> bool:
        return bool(self.database_url)

    @property
    def claude_configured(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def hunter_configured(self) -> bool:
        return bool(self.hunter_api_key)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()

    if not settings.session_secret:
        settings.session_secret = secrets.token_urlsafe(32)
        logger.warning(
            "SESSION_SECRET is not set - generated a temporary one. "
            "Every restart will sign users out."
        )

    return settings
