"""The sales agents, running on Claude.

Section C of the architecture draft. Two rules shape this file:

  Model tiering (K3)    Scoring and classification go to the small model;
                        research and personalization go to the large one.

  Statement typing (C)  Every agent emits data (observed and sourced),
                        inference (derived, derivation shown) or generation
                        (written by a model), and they are never mixed.
                        Only DATA may be quoted back to a prospect.

Every call returns its token usage so the caller can price it. Nothing here
touches the database; persistence is the router's job.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Generic, TypeVar

import anthropic
from pydantic import BaseModel

from .config import Settings
from .pricing import call_cost
from .schemas import (
    CompanyDraft,
    CompanyList,
    DecisionMaker,
    EnrichmentDraft,
    OutreachDraft,
    ReplyClassification,
    SearchArea,
)

logger = logging.getLogger("salesos.agents")


def _area_rule(area: "SearchArea | None") -> str:
    """The geography instruction, or nothing at all.

    Written to bind hard. Asked for Pune and given ten companies, a model will
    happily drift to Mumbai and Bengaluru to fill the quota - which is the one
    outcome that makes a location filter worse than no filter, because the
    list looks right until you read the addresses. Returning fewer is the
    correct answer, and it has to be said explicitly.
    """
    if area is None or not area.is_set:
        return ""

    noun = {
        "city": "the city of",
        "state": "the state or region of",
        "country": "the country of",
    }.get(area.scope, "")

    return (
        f"\n\nGEOGRAPHY. Every company must be headquartered in {noun} "
        f"{area.value.strip()}, and its `headquarters` field must say so.\n"
        "This is a hard filter, not a preference. If you cannot find enough "
        "companies there that fit the profile, RETURN FEWER. Do not pad the "
        "list with companies from nearby cities, regions or countries - a "
        "short accurate list is useful and a padded one is not.\n"
        "Geography is also part of the ICP score: an account that fits the "
        "profile but sits outside this area does not belong in the results at "
        "all."
    )

T = TypeVar("T", bound=BaseModel)

# Non-streaming calls, so keep this well under the SDK's HTTP timeout.
MAX_TOKENS = 16000


class AgentError(RuntimeError):
    """Raised when an agent cannot produce usable output."""


@dataclass
class Usage:
    """What one agent call cost."""

    agent: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def cost_usd(self) -> Decimal:
        return call_cost(self.model, self.input_tokens, self.output_tokens)


@dataclass
class AgentResult(Generic[T]):
    """Agent output plus what it cost to produce."""

    output: T
    usage: Usage


@dataclass
class RunUsage:
    """Accumulates usage across a whole pipeline run."""

    calls: list[Usage] = field(default_factory=list)

    def add(self, usage: Usage) -> None:
        self.calls.append(usage)

    @property
    def total_cost(self) -> Decimal:
        return sum((call.cost_usd for call in self.calls), Decimal("0"))


class SalesAgents:
    """Thin wrapper around the Claude client holding the agent prompts."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: anthropic.AsyncAnthropic | None = None

    # ------------------------------------------------------------------
    # Plumbing
    # ------------------------------------------------------------------

    @property
    def model_large(self) -> str:
        return self._settings.claude_model_large

    @property
    def model_small(self) -> str:
        return self._settings.claude_model_small

    @property
    def is_configured(self) -> bool:
        return bool(self._settings.anthropic_api_key)

    @property
    def client(self) -> anthropic.AsyncAnthropic:
        if self._client is None:
            if not self.is_configured:
                raise AgentError(
                    "ANTHROPIC_API_KEY is not set. Add your Claude API key to "
                    "Backend/.env - see .env.example."
                )
            self._client = anthropic.AsyncAnthropic(
                api_key=self._settings.anthropic_api_key
            )
        return self._client

    async def _parse(
        self,
        *,
        agent: str,
        model: str,
        system: str,
        prompt: str,
        schema: type[T],
    ) -> AgentResult[T]:
        """Run one structured-output Claude call and price it."""
        try:
            response = await self.client.messages.parse(
                model=model,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                output_format=schema,
            )
        except anthropic.AuthenticationError as exc:
            raise AgentError(
                "Claude rejected the API key. Check ANTHROPIC_API_KEY in Backend/.env."
            ) from exc
        except anthropic.RateLimitError as exc:
            raise AgentError("Claude rate limit reached. Try again shortly.") from exc
        except anthropic.APIStatusError as exc:
            logger.exception("[%s] Claude returned %s", agent, exc.status_code)
            raise AgentError(f"{agent}: Claude returned {exc.status_code}.") from exc
        except anthropic.APIConnectionError as exc:
            raise AgentError(
                f"{agent}: could not reach Claude. Check the connection."
            ) from exc

        usage = Usage(
            agent=agent,
            model=model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )

        parsed = response.parsed_output
        if parsed is None:
            logger.error("[%s] Claude returned no parseable output", agent)
            raise AgentError(f"{agent}: the model did not return usable output.")

        logger.info(
            "[%s] %s | %d in / %d out | $%s",
            agent,
            model,
            usage.input_tokens,
            usage.output_tokens,
            usage.cost_usd,
        )
        return AgentResult(output=parsed, usage=usage)

    # ------------------------------------------------------------------
    # Discovery + research
    # ------------------------------------------------------------------

    async def discover_companies(
        self, icp: str, company_count: int, area: SearchArea | None = None
    ) -> AgentResult[CompanyList]:
        """Large tier: this is research, and it sets up everything downstream.

        `area` narrows the search to a city, state or country. It goes in the
        prompt rather than the output schema, so it costs nothing against the
        structured-output complexity budget - see the note in schemas.py.
        """
        where = area.as_label() if area else "worldwide"
        logger.info("[Discovery] Finding %d companies in %s...", company_count, where)

        system = (
            "You are a B2B lead discovery and company research agent.\n"
            "You produce realistic prospect records for a sales prototype. The "
            "companies you return are illustrative examples, not claims about "
            "real businesses.\n\n"
            "Every company needs an icpScore from 0-100 AND icpReasons: two to "
            "four short reason codes explaining that score, such as "
            "[employee band matches, no buying signal, wrong geography]. "
            "A score without reasons is not usable - the reasons are what let "
            "a human argue with the number.\n\n"
            "You are writing the dossier a rep opens before a call, so be "
            "specific. 'Manufacturing software' is not a product line; "
            "'CNC tool-path simulation for 5-axis mills' is. The same goes for "
            "the launch, the signals and the pain points: name the thing.\n\n"
            "Leave a field empty rather than padding it. An empty "
            "latestLaunch reads fine; a guessed one sends a rep into a call "
            "with a wrong fact in their mouth.\n\n"
            "You have no contact database. Give each decision maker a "
            "plausible LinkedIn URL and nothing else - no email address and no "
            "phone number, in any field. Those are typed in by the person who "
            "owns the relationship, because the next thing that happens to an "
            "address or a number is a real send or a real call."
            + _area_rule(area)
        )

        prompt = (
            f"Find {company_count} B2B companies "
            + (f"in {area.as_label()} " if area and area.is_set else "")
            + f"matching this Ideal Customer Profile:\n\n{icp}\n\n"
            "For each one, fill in every field:\n"
            "  name, industry, revenue  - a band such as '$14.5M' is fine\n"
            "  employees                - headcount, as a number\n"
            "  website                  - the bare domain, no scheme\n"
            "  headquarters             - city and country, and it must name "
            "the area asked for above where one was given\n"
            "  founded                  - the year, as a string\n"
            "  description              - what they do, and how they sell "
            "today\n"
            "  products                 - the 2-5 named lines they sell\n"
            "  latestLaunch             - the most recent product, facility, "
            "market or capability they added, in one sentence. Empty if "
            "nothing recent stands out\n"
            "  recentNews               - the single most useful recent "
            "development\n"
            "  buyingSignals            - 2-4 short reasons this account is "
            "live right now\n"
            "  painPoints               - 2-4 short operational problems the "
            "ICP above would fix\n"
            "  icpScore, icpReasons     - the score, and 2-4 codes for it\n"
            "  decisionMakers           - 1-2 people, with realistic titles "
            "and a LinkedIn URL each"
        )

        return await self._parse(
            agent="discovery",
            model=self.model_large,
            system=system,
            prompt=prompt,
            schema=CompanyList,
        )

    # ------------------------------------------------------------------
    # Outreach + strategy
    # ------------------------------------------------------------------

    async def write_outreach(
        self, icp: str, company: CompanyDraft, decision_maker: DecisionMaker
    ) -> AgentResult[OutreachDraft]:
        """Large tier: personalization is where reply rate is won or lost."""
        system = (
            "You are an outreach and sales strategy agent.\n\n"
            "GUARDRAIL: state only facts that appear in the research given to "
            "you. Do not invent funding rounds, headcounts, customers or "
            "quotes. If the research is thin, write a shorter email rather "
            "than a padded one - a sentence with a hole in it is worse than "
            "no sentence.\n\n"
            "personalizationScore (0-100) is your own assessment of how "
            "specific this copy is to this person. Be honest: a template with "
            "the company name swapped in scores low."
        )

        # Only the lines that actually have research behind them. A heading
        # with nothing under it invites the model to fill the gap itself,
        # which is the one thing the guardrail above is trying to prevent.
        research = [
            f"Company: {company.name} ({company.industry})",
            f"Description: {company.description}",
            f"Recent signal: {company.recentNews}",
        ]
        for label, value in (
            ("Sells", ", ".join(company.products)),
            ("Latest launch", company.latestLaunch),
            ("Buying signals", "; ".join(company.buyingSignals)),
            ("Likely pain points", "; ".join(company.painPoints)),
        ):
            if value.strip():
                research.append(f"{label}: {value}")

        prompt = (
            "Research:\n"
            + "\n".join(research)
            + "\n\nDecision maker:\n"
            + f"{decision_maker.name}, {decision_maker.title}\n\n"
            + f"Our ICP: {icp}\n\n"
            + "Write a cold email (subject and body), a short LinkedIn "
            "connection message, a cold-call opening line, and how to handle "
            "the most likely objection. Anchor the opening on the launch or a "
            "buying signal above if there is one - that is the sentence that "
            "earns the rest of the email."
        )

        return await self._parse(
            agent="personalization",
            model=self.model_large,
            system=system,
            prompt=prompt,
            schema=OutreachDraft,
        )

    # ------------------------------------------------------------------
    # Enrichment
    # ------------------------------------------------------------------

    async def enrich_company(
        self, name: str, industry: str, description: str, dossier: str = ""
    ) -> AgentResult[EnrichmentDraft]:
        """Small tier: a short, structured summarization task.

        `dossier` is the discovery research for this account. Passing it costs
        a few hundred extra input tokens on the cheap model and is the
        difference between a note about the industry and a note about them.
        """
        logger.info("[Enrichment] Enriching %s...", name)

        system = (
            "You are a data enrichment agent for a sales prototype.\n\n"
            "You have no live data sources. Everything you produce is a "
            "plausible illustration, so tag it honestly:\n"
            "  DATA       observed and sourced. You have none, so never use it.\n"
            "  INFERENCE  derived from the firmographics you were given.\n"
            "  GENERATION written by you as an illustrative example.\n\n"
            "Only DATA may be quoted back to a prospect, which means nothing "
            "you write here may be quoted."
        )

        prompt = (
            "Firmographics:\n"
            f"Company: {name}\n"
            f"Industry: {industry}\n"
            f"Description: {description}\n"
            + (f"{dossier}\n" if dossier.strip() else "")
            + "\nWrite a 1-2 sentence intelligence note about likely strategic "
            "initiatives or hiring direction, then give its statement type and "
            "your confidence from 0-100."
        )

        return await self._parse(
            agent="enrichment",
            model=self.model_small,
            system=system,
            prompt=prompt,
            schema=EnrichmentDraft,
        )

    # ------------------------------------------------------------------
    # Reply triage
    # ------------------------------------------------------------------

    async def classify_reply(
        self, subject: str, body: str, from_address: str
    ) -> AgentResult[ReplyClassification]:
        """Small tier: classification is cheap, structured and high volume."""
        system = (
            "You triage replies to B2B sales emails. Pick exactly one class:\n"
            "  positive       interested, asking about pricing, wants a meeting\n"
            "  referral       pointing at a colleague as the right person\n"
            "  neutral        out of office, acknowledgement, needs info later\n"
            "  not_interested a clear no, or wrong person with no referral\n"
            "  unsubscribe    asks to stop being contacted, in any wording\n"
            "  auto_reply     an automated bounce or vacation responder\n\n"
            "Be conservative with 'unsubscribe': it stops all automated contact "
            "with that domain, and getting it wrong in either direction is "
            "costly. But 'remove me', 'take me off your list' or 'stop emailing' "
            "IS an unsubscribe however politely it is phrased.\n\n"
            "confidence is 0-100. In 'reason', say in one short sentence what in "
            "the text decided it."
        )

        prompt = f"From: {from_address}\nSubject: {subject}\n\n{body[:4000]}"

        return await self._parse(
            agent="reply_triage",
            model=self.model_small,
            system=system,
            prompt=prompt,
            schema=ReplyClassification,
        )
