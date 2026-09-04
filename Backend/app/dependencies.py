"""Shared FastAPI dependencies."""

from functools import lru_cache

from .agents import SalesAgents
from .config import get_settings


@lru_cache
def get_agents() -> SalesAgents:
    """One agent runner (and one Claude client) for the whole process."""
    return SalesAgents(get_settings())
