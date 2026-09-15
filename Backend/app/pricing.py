"""Model pricing and cost maths.

Section K of the architecture draft: cost is what decides whether this is
viable at volume, so every model call is priced and recorded rather than
estimated after the fact.

Prices are USD per million tokens, first-party Anthropic API rates.
"""

from __future__ import annotations

from decimal import Decimal

# model id -> (input $/MTok, output $/MTok)
MODEL_PRICING: dict[str, tuple[Decimal, Decimal]] = {
    "claude-opus-5": (Decimal("5.00"), Decimal("25.00")),
    "claude-opus-4-8": (Decimal("5.00"), Decimal("25.00")),
    "claude-sonnet-5": (Decimal("2.00"), Decimal("10.00")),
    "claude-haiku-4-5": (Decimal("1.00"), Decimal("5.00")),
}

# Charged when a model id is not in the table, so an unknown model shows up as
# expensive rather than free. Silent $0.00 is the dangerous failure here.
FALLBACK_PRICING = (Decimal("5.00"), Decimal("25.00"))

# Server-side web search, billed per search on top of the tokens the results
# cost once they land in the context window. $10 per 1,000 searches:
# platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
WEB_SEARCH_USD_PER_SEARCH = Decimal("0.010")

_MILLION = Decimal("1000000")


def price_for(model: str) -> tuple[Decimal, Decimal]:
    return MODEL_PRICING.get(model, FALLBACK_PRICING)


def is_priced(model: str) -> bool:
    return model in MODEL_PRICING


def call_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    web_searches: int = 0,
) -> Decimal:
    """USD for one model call, to 6 decimal places.

    A call that searched the web is billed for the searches as well as the
    tokens. Leaving that out would make discovery look cheaper than it is,
    which is the one direction this number must never be wrong in.
    """
    in_rate, out_rate = price_for(model)
    cost = (Decimal(input_tokens) * in_rate + Decimal(output_tokens) * out_rate) / _MILLION
    cost += Decimal(web_searches) * WEB_SEARCH_USD_PER_SEARCH
    return cost.quantize(Decimal("0.000001"))


def as_usd(amount: Decimal | float | int | None) -> str:
    """Human-readable, and honest about sub-cent amounts."""
    if amount is None:
        return "$0.00"
    value = Decimal(str(amount))
    if value == 0:
        return "$0.00"
    if value < Decimal("0.01"):
        return f"${value.quantize(Decimal('0.0001'))}"
    return f"${value.quantize(Decimal('0.01'))}"
