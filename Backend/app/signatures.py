"""Email signatures - one per business, chosen by which business the mail is for.

Two businesses send from this workspace. The ICP an account was found with
says which one is writing: a brief about market sizing or due diligence is
Introspective Market Research; a brief about building software or automation
is IMR Tech Solutions. The signature goes on at send time, not at drafting
time, so it is never left to the model and never goes stale in a stored draft.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Literal

Business = Literal["market_research", "tech"]

# The built-in sign-offs. These seed the workspace settings row, and from
# then on the admin-edited copies in Postgres are what `sign` is handed -
# see workspace_settings.effective_signatures.
SIGNATURES: dict[Business, str] = {
    "tech": (
        "Best regards,\n"
        "Akshay V. Patil\n"
        "Director\n"
        "IMR Tech Solutions\n"
        "+91 91753-37569 | contact@imrtechsolutions.com\n"
        "https://imrtechsolutions.com"
    ),
    "market_research": (
        "Best regards,\n"
        "Akshay V. Patil\n"
        "Business Development Head\n"
        "Introspective Market Research Pvt. Ltd.\n"
        "+91-74101-03736 | sales@introspectivemarketresearch.com\n"
        "https://introspectivemarketresearch.com"
    ),
}

# What each business's briefs talk about. Counted, not matched once, so a
# tech brief that mentions "the market" in passing does not flip.
_MARKET_RESEARCH_TERMS = (
    "market research", "market sizing", "market assessment", "due diligence",
    "primary research", "concept testing", "competitive intelligence",
    "syndicated", "forecasting", "focus groups", "in-depth interviews",
    "segmentation", "introspective",
)
_TECH_TERMS = (
    "software", "web app", "website", "automation", "internal tools",
    "internal platforms", "react", "python", "fastapi", "node.js", "aws",
    "llm", "imr tech",
)


def business_for(source_icp: str) -> Business:
    """Which business an account belongs to, from the brief it was found with."""
    text = (source_icp or "").lower()
    research = sum(text.count(term) for term in _MARKET_RESEARCH_TERMS)
    tech = sum(text.count(term) for term in _TECH_TERMS)
    return "market_research" if research > tech else "tech"


# The closing line a model writes, and the placeholder it leaves under it.
_CLOSING = re.compile(
    r"^\s*(best regards|kind regards|warm regards|warmest regards|regards|best|"
    r"all the best|thanks|many thanks|thank you|cheers|sincerely|yours truly|"
    r"yours sincerely|talk soon)[,.!]?\s*$",
    re.IGNORECASE,
)
_PLACEHOLDER = re.compile(
    r"^\s*[-–—]*\s*\[?\s*(your\s+)?(name|full name|sender|signature|sender name)"
    r"\s*\]?\s*$",
    re.IGNORECASE,
)


def strip_signoff(body: str) -> str:
    """The body without any closing line or name placeholder at the end.

    Peels from the bottom: blank lines, then a placeholder like "- [Name]",
    then a bare short name line, then a closing like "Best regards,". Whatever
    is left is the actual message, ready for the real signature.
    """
    lines = (body or "").rstrip().split("\n")

    def drop_blanks() -> None:
        while lines and not lines[-1].strip():
            lines.pop()

    drop_blanks()
    if lines and _PLACEHOLDER.match(lines[-1]):
        lines.pop()
        drop_blanks()

    # "Best regards,\nAkshay" - a short name line directly under a closing.
    if (
        len(lines) >= 2
        and _CLOSING.match(lines[-2])
        and len(lines[-1].split()) <= 4
        and not lines[-1].rstrip().endswith((".", "?", "!"))
    ):
        lines.pop()
        drop_blanks()

    if lines and _CLOSING.match(lines[-1]):
        lines.pop()

    return "\n".join(lines).rstrip()


def sign(
    body: str, source_icp: str, signatures: Mapping[Business, str] | None = None
) -> str:
    """The body with the right signature under it. Safe to call twice.

    `signatures` is the admin-edited table from Settings; the built-in blocks
    are the fallback. An empty signature means the body goes out as written.
    """
    table = signatures if signatures is not None else SIGNATURES
    signature = (table.get(business_for(source_icp)) or "").strip()
    if not signature:
        return body
    if signature in (body or ""):
        return body
    return f"{strip_signoff(body)}\n\n{signature}"
