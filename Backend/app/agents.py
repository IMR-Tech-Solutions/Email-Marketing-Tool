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
from typing import Generic, Sequence, TypeVar

import anthropic
from pydantic import BaseModel

from .config import Settings
from .pricing import call_cost
from .schemas import (
    CompanyDraft,
    CompanyList,
    DecisionMaker,
    EnrichmentDraft,
    IndustryFilter,
    join_or,
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

    Several areas are "any of": a company in any one of them is in. They are
    grouped by kind so the instruction reads as a person would write it.
    """
    if area is None or not area.is_set:
        return ""

    nouns = {
        "city": ("the city of", "one of the cities of"),
        "state": ("the state or region of", "one of the states or regions of"),
        "country": ("the country of", "one of the countries of"),
    }
    parts: list[str] = []
    for scope, (one, many) in nouns.items():
        names = [p.value.strip() for p in area.picks if p.scope == scope]
        if names:
            parts.append(f"{one if len(names) == 1 else many} {join_or(names)}")

    if len(area.picks) == 1:
        where = (
            f"Every company must be headquartered in {parts[0]}, and its "
            "`headquarters` field must say so."
        )
    else:
        where = (
            "Every company must be headquartered in ONE of these areas: "
            + "; ".join(parts)
            + ". Its `headquarters` field must name the one it is in. Where "
            "the brief fits companies in more than one of them, spread the "
            "results rather than taking every account from a single area."
        )

    return (
        f"\n\nGEOGRAPHY. {where}\n"
        "This is a hard filter, not a preference. If you cannot find enough "
        "companies there that fit the profile, RETURN FEWER. Do not pad the "
        "list with companies from nearby cities, regions or countries - a "
        "short accurate list is useful and a padded one is not.\n"
        "Geography is also part of the ICP score: an account that fits the "
        "profile but sits outside these areas does not belong in the results "
        "at all."
    )


def _exclusion_rule(exclude: Sequence[str]) -> str:
    """The accounts already held, so the agent looks past them.

    A hard filter downstream drops any repeats regardless; this is what stops
    the searches being spent on finding them in the first place.
    """
    items = [e.strip() for e in exclude if e and e.strip()]
    if not items:
        return ""
    listed = ", ".join(items[:60])
    return (
        "\n\nALREADY IN THE CRM - do not return any of these, by name or by "
        f"domain, and do not return a subsidiary or rebrand of one: {listed}."
    )


def _industry_rule(industry: "IndustryFilter | None") -> str:
    """The sector instruction, or nothing at all.

    Binds the same way `_area_rule` does, and for the same reason: asked for
    six medical device companies, a model will reach into adjacent healthcare
    to fill the count, and the list reads correctly until someone checks what
    the companies actually sell. Fewer is the right answer.

    Several sectors are "any of": a company in any one of them is in.
    """
    if industry is None or not industry.is_set:
        return ""

    names = industry.picks
    if len(names) == 1:
        which = (
            f"Every company must operate in {names[0]}, and its `industry` "
            "field must say so in those terms."
        )
    else:
        which = (
            f"Every company must operate in ONE of these sectors: {join_or(names)}. "
            "Its `industry` field must name the one it is in, in those terms. "
            "Where the brief fits companies in more than one of them, spread "
            "the results rather than taking every account from a single sector."
        )

    return (
        f"\n\nINDUSTRY. {which}\n"
        "This is a hard filter, not a preference. If you cannot find enough "
        "companies in those sectors that fit the profile, RETURN FEWER. Do "
        "not reach into adjacent or parent sectors to make up the number.\n"
        "Judge by what the company actually sells, not by who it sells to: a "
        "software vendor serving hospitals is not a healthcare company. Where "
        "the ICP text names other sectors, this filter wins.\n"
        "Industry is also part of the ICP score: an account outside these "
        "sectors does not belong in the results at all."
    )


T = TypeVar("T", bound=BaseModel)

# Non-streaming calls, so keep this well under the SDK's HTTP timeout.
MAX_TOKENS = 16000

# Anthropic runs this one; there is no tool loop to write on our side. The
# _20260209 variant filters results in code before they reach the context
# window, which is what keeps a twelve-search research turn affordable.
WEB_SEARCH_TOOL_TYPE = "web_search_20260209"

# A long research turn can come back as `pause_turn` instead of a finished
# answer. Resuming is just handing the paused turn back - but the paused turn
# includes every search result so far, and it is resent in full each time, so
# the cost of a resume grows with each one. Two is enough for a turn that is
# genuinely long, and low enough that a turn which will never settle is
# abandoned before it gets expensive.
MAX_TURN_RESUMES = 2


# Used when the search tool is down. It does not ask for less honesty - it
# asks for the claims that only research can support to be left out.
NO_SEARCH_RULE = (
    "\n\nWEB SEARCH IS UNAVAILABLE for this run, so work from what you "
    "already know. Two things do not change: every filter above still binds - "
    "the geography and the sector are exactly as strict as they were - and "
    "you still may not invent a company. Only what you claim changes:\n"
    "- Return companies you are confident exist and still trade IN THE AREA "
    "ASKED FOR. What is needed here is local knowledge, not the biggest firms "
    "you can think of. A famous company in the wrong city is not a substitute "
    "for a real one in the right city; it is just off-target, and it will be "
    "counted as such.\n"
    "- Give the domain you actually know the company by. Every domain is "
    "checked against DNS before anything is saved, and one that does not "
    "resolve is thrown away - so a domain assembled out of the company name "
    "loses you the whole row.\n"
    "- Name the decision makers you genuinely know: the founder, CEO, "
    "managing director or CTO publicly associated with that company. This "
    "REPLACES the rule above about search results naming them, because there "
    "are no search results this run. Where you cannot name a real person, "
    "prefer a different company where you can - a record with nobody to "
    "write to cannot be acted on, which is the whole point of the list.\n"
    "- Leave recentNews, latestLaunch and buyingSignals EMPTY unless you are "
    "certain of them. Anything time-sensitive is the first thing to go stale, "
    "and a rep repeating a stale fact in a call is worse off than one with "
    "nothing to say.\n"
    "- Return the companies you can stand behind. Do not return an empty list."
)

def _search_error_codes(content) -> list[str]:
    """Error codes from any web search that failed in this response.

    A failed search does not raise and is not billed - it comes back as a
    result block whose content is a single error object instead of a list of
    results. Left unread, a total search outage is indistinguishable from a
    brief that genuinely matches nothing.
    """
    codes: list[str] = []
    for block in content:
        if getattr(block, "type", "") != "web_search_tool_result":
            continue
        inner = getattr(block, "content", None)
        code = getattr(inner, "error_code", None)
        if code:
            codes.append(str(code))
    return codes


def _web_search_tool(max_uses: int) -> dict:
    """The search tool, capped. `max_uses` is the hard ceiling on cost."""
    return {
        "type": WEB_SEARCH_TOOL_TYPE,
        "name": "web_search",
        "max_uses": max_uses,
    }


class AgentError(RuntimeError):
    """Raised when an agent cannot produce usable output."""


@dataclass
class Usage:
    """What one agent call cost."""

    agent: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    # Server-side web searches. Billed per search on top of the tokens.
    web_searches: int = 0

    @property
    def cost_usd(self) -> Decimal:
        return call_cost(
            self.model, self.input_tokens, self.output_tokens, self.web_searches
        )


@dataclass
class AgentResult(Generic[T]):
    """Agent output plus what it cost to produce."""

    output: T
    usage: Usage
    # True when every web search in the call failed. The output is still
    # usable - it just came from the model rather than from research.
    search_failed: bool = False


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
        tools: list[dict] | None = None,
    ) -> AgentResult[T]:
        """Run one structured-output Claude call and price it.

        `tools` carries server-side tools - web search, today. Those execute on
        Anthropic's side within this same call, so there is no tool loop here.
        The one thing that does need handling is `pause_turn`: a long research
        turn is returned unfinished, and continuing it means sending the paused
        turn straight back.
        """
        messages: list[dict] = [{"role": "user", "content": prompt}]
        extra = {"tools": tools} if tools else {}
        input_tokens = output_tokens = web_searches = 0
        search_errors: list[str] = []

        try:
            for _ in range(MAX_TURN_RESUMES + 1):
                response = await self.client.messages.parse(
                    model=model,
                    max_tokens=MAX_TOKENS,
                    system=system,
                    messages=messages,
                    output_format=schema,
                    **extra,
                )

                input_tokens += response.usage.input_tokens
                output_tokens += response.usage.output_tokens
                server_use = getattr(response.usage, "server_tool_use", None)
                if server_use is not None:
                    web_searches += server_use.web_search_requests or 0
                search_errors += _search_error_codes(response.content)

                if response.stop_reason != "pause_turn":
                    break

                logger.warning(
                    "[%s] turn paused after %d search(es), %d input tokens - "
                    "resuming.",
                    agent,
                    web_searches,
                    input_tokens,
                )
                # The blocks go back exactly as they arrived: the search
                # results inside them are encrypted, and editing them at all
                # fails the next request.
                messages.append({"role": "assistant", "content": response.content})
            else:
                raise AgentError(
                    f"{agent}: the research turn was still unfinished after "
                    f"{MAX_TURN_RESUMES} resumes."
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
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            web_searches=web_searches,
        )

        # Every search failed and none succeeded: the agent was working blind,
        # so whatever it came back with is memory, not research. That is worth
        # knowing, but it is not worth failing the run over - the caller has a
        # way to carry on.
        search_failed = bool(tools) and web_searches == 0 and bool(search_errors)
        if search_failed:
            logger.error(
                "[%s] all %d web search(es) failed (%s)",
                agent,
                len(search_errors),
                search_errors[0],
            )

        parsed = response.parsed_output
        if parsed is None:
            logger.error("[%s] Claude returned no parseable output", agent)
            raise AgentError(f"{agent}: the model did not return usable output.")

        logger.info(
            "[%s] %s | %d in / %d out | %d search(es) | $%s",
            agent,
            model,
            usage.input_tokens,
            usage.output_tokens,
            usage.web_searches,
            usage.cost_usd,
        )
        return AgentResult(output=parsed, usage=usage, search_failed=search_failed)

    # ------------------------------------------------------------------
    # Discovery + research
    # ------------------------------------------------------------------

    async def discover_companies(
        self,
        icp: str,
        company_count: int,
        area: SearchArea | None = None,
        industry: IndustryFilter | None = None,
        exclude: Sequence[str] = (),
    ) -> AgentResult[CompanyList]:
        """Large tier: this is research, and it sets up everything downstream.

        `exclude` is what the CRM already holds - domains, or names where a
        row has no domain. Told up front, the agent spends its searches on
        new accounts instead of re-finding the same three it found last time.

        Runs with web search, and that is not a nicety. A model answering from
        memory writes companies that sound right and do not exist - and the
        first thing that happens to an invented company is a contact lookup
        against a domain with no DNS, which fails without ever saying why.
        Everything downstream inherits whatever this call decides is true.

        `area` narrows the search to a city, state or country, and `industry`
        to a sector. Both go in the prompt rather than the output schema, so
        they cost nothing against the structured-output complexity budget -
        see the note in schemas.py.
        """
        where = area.as_label() if area else "worldwide"
        sector = industry.as_label() if industry else "all industries"
        logger.info(
            "[Discovery] Finding %d companies in %s (%s)...",
            company_count,
            where,
            sector,
        )

        system = (
            "You are a B2B lead discovery and company research agent.\n\n"
            "SEARCH BEFORE YOU ANSWER. Every company you return must be a real "
            "business that exists right now, found with the web_search tool and "
            "supported by what the results actually say. Do not answer from "
            "memory, and do not fill a gap in the results with a company that "
            "merely sounds like it belongs in the list.\n\n"
            "This is the whole job. A rep opens these records, looks the "
            "company up, and mails a real person there. An invented company "
            "wastes their morning - and worse, it discredits the accurate rows "
            "sitting next to it, until they stop trusting the list at all.\n\n"
            "The website must be the company's actual registered domain, taken "
            "from the search results - never one you assembled out of the "
            "company name because it looks like what they would own. A guessed "
            "domain is the most expensive mistake available here: it has no "
            "mail server, so every later attempt to find an address at it "
            "fails, and nothing in the app can explain why.\n\n"
            "KEEP LOOKING. One query is not a search. If the first results "
            "are directories, aggregators or nothing usable, search again with "
            "different wording - trade directory listings, industry "
            "association members, local business press, 'top <sector> "
            "companies in <city>', supplier and vendor lists, award and "
            "funding announcements. Companies that match a normal brief are "
            "findable; an empty answer nearly always means you stopped after "
            "one look.\n\n"
            "PREFER COMPANIES THAT CAN BE WRITTEN TO. Every account you return "
            "is checked for a published email address - sales@, info@, or a "
            "named person on the contact page - and one with none is thrown "
            "away before it is saved. So where two candidates fit equally, "
            "return the one whose site shows a contact address, not just a "
            "web form.\n\n"
            "Prefer a shorter list you can stand behind over a padded one - "
            "but coming back with nothing is a failure, not the safe option. "
            "It leaves the person who asked with no accounts and a bill for "
            "the search. Only return an empty list if several different "
            "searches agree that no such company exists in that area, and say "
            "so in that case rather than inventing one.\n\n"
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
            "Name decision makers only where the search results name them - "
            "a real person in a real role, from the company's own site, a press "
            "release or a directory. Where the results name nobody, return an "
            "EMPTY decisionMakers list. Never return a contact whose name is a "
            "role, a placeholder or an empty string: everything downstream "
            "treats a contact as a person to write to, and a nameless one "
            "cannot be looked up, addressed or called.\n\n"
            "You have no contact database. Give each decision maker a LinkedIn "
            "URL and nothing else - no email address and no phone number, in "
            "any field. Those are typed in by the person who owns the "
            "relationship, because the next thing that happens to an address "
            "or a number is a real send or a real call."
            + _area_rule(area)
            + _industry_rule(industry)
        )

        prompt = (
            "Use web_search now - before writing anything - to find real "
            "companies that match the brief below. Search first, then write "
            "each row from what you found.\n\n"
            f"Find {company_count} B2B companies "
            + (
                f"in the {industry.as_label()} sector{'s' if len(industry.picks) > 1 else ''} "
                if industry and industry.is_set
                else ""
            )
            + (f"in {area.as_label()} " if area and area.is_set else "")
            + f"matching this Ideal Customer Profile:\n\n{icp}\n\n"
            "For each one, fill in every field the search results support:\n"
            "  name, revenue            - a band such as '$14.5M' is fine\n"
            "  industry                 - the sector they operate in, and it "
            "must name one of the sectors asked for above where any were given\n"
            "  employees                - headcount, as a number\n"
            "  website                  - the real registered domain, bare, "
            "no scheme, exactly as the search results give it. Leave it EMPTY "
            "if the results show none: plenty of small firms have no site of "
            "their own, and an empty field says so honestly where a domain "
            "built from the company name just fails later\n"
            "  headquarters             - city and country, and it must name "
            "one of the areas asked for above where any were given\n"
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
            "  decisionMakers           - 1-2 people the search results "
            "actually name, with their real titles and a LinkedIn URL each\n\n"
            "Run several different searches before you write anything, and "
            "keep searching if the first results are thin. Leave any field the "
            "results do not support empty - but do not return an empty list "
            "because the first query was unhelpful."
            + _exclusion_rule(exclude)
        )

        # Enough searches to find the companies and still check each one, with
        # a ceiling so a large run cannot quietly turn into an expensive one.
        max_searches = min(24, 4 + company_count * 3)

        researched = await self._parse(
            agent="discovery",
            model=self.model_large,
            system=system,
            prompt=prompt,
            schema=CompanyList,
            tools=[_web_search_tool(max_searches)],
        )
        if researched.output.companies and not researched.search_failed:
            return researched

        # Search was down, or came back with nothing usable. Handing the user
        # an empty screen is the one outcome with no value at all, so run it
        # again without the tool. The DNS check on the way to the database is
        # what keeps this honest: a domain the model invented does not resolve,
        # and does not get saved.
        logger.warning(
            "[Discovery] %s - retrying on the model's own knowledge, with "
            "every domain still DNS-checked before it is saved.",
            "web search unavailable"
            if researched.search_failed
            else "search returned no usable companies",
        )

        fallback = await self._parse(
            agent="discovery",
            model=self.model_large,
            system=system + NO_SEARCH_RULE,
            prompt=prompt,
            schema=CompanyList,
        )

        # Both attempts were billed, so both are reported.
        return AgentResult(
            output=fallback.output,
            usage=Usage(
                agent="discovery",
                model=self.model_large,
                input_tokens=researched.usage.input_tokens + fallback.usage.input_tokens,
                output_tokens=researched.usage.output_tokens + fallback.usage.output_tokens,
                web_searches=researched.usage.web_searches + fallback.usage.web_searches,
            ),
            search_failed=researched.search_failed,
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
            "earns the rest of the email.\n\n"
            "End the email body with the single line 'Best regards,' and "
            "nothing after it - no name, no placeholder such as [Name], no "
            "title and no company. The sender's signature block is added "
            "when the email is sent."
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
