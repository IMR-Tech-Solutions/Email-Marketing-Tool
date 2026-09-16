"""Request, response and agent-output models.

Fields are camelCase on purpose: these models are the wire contract with the
React frontend (see frontend/src/types.ts) and they are also handed to Claude
as the structured-output schema, so what it produces lands in the shape the UI
reads.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

CrmStage = Literal["lead", "contacted", "engaged", "proposal", "won", "lost"]
CrmProvider = Literal["salesforce", "hubspot"]
CrmStatus = Literal["disconnected", "connected", "error"]

# Section C: every agent statement is one of these, and they are never mixed.
StatementType = Literal["data", "inference", "generation"]

# Section K2: how stale a record is, which drives whether it is worth money.
FreshnessBand = Literal["fresh", "good", "aging", "stale", "critical"]

# Reply triage. "unsubscribe" is acted on automatically, never just logged.
ReplyClass = Literal[
    "positive", "referral", "neutral", "not_interested", "unsubscribe", "auto_reply"
]

MailboxStatus = Literal["untested", "connected", "error", "disabled"]


# --------------------------------------------------------------------------
# What the agents produce
# --------------------------------------------------------------------------


class DecisionMaker(BaseModel):
    """Agent output. No email or phone field - see ContactOut.

    `linkedin` is the one channel the agent may guess at: a wrong profile URL
    costs a click, where a wrong address or number costs a stranger.
    """

    id: str = ""
    name: str
    title: str
    linkedin: str


class ContactOut(DecisionMaker):
    """API shape: the same contact, plus the channels a person typed in."""

    email: str = ""
    phone: str = ""

    # False means the linkedin URL above is still the agent's guess.
    linkedinVerified: bool = False


# NOTE ON SIZE, and why this model looks plainer than the rest of the file.
#
# A class docstring and every `description=` become part of the JSON schema,
# which is compiled into a grammar server-side against a complexity ceiling.
# An earlier draft carried both plus four more fields and the API rejected it
# with "Schema is too complex" - intermittently, which is worse than always,
# because a whole Discover run then 502s on a coin flip.
#
# So: every field below is one the client panel actually renders, and the
# guidance that would sit in `description=` sits in the discovery prompt in
# agents.py instead. Before adding a field here, read that prompt and check
# the headroom - it is real, and it is close.
class CompanyDraft(BaseModel):
    """Discovery + research output: one account, as a working dossier."""

    name: str
    industry: str
    revenue: str
    employees: int
    description: str
    recentNews: str

    # Where to find them.
    website: str = ""
    headquarters: str = ""
    founded: str = ""

    # What they sell, and what they shipped last.
    products: list[str] = Field(default_factory=list)
    latestLaunch: str = ""

    # Why now, and what to lead with.
    buyingSignals: list[str] = Field(default_factory=list)
    painPoints: list[str] = Field(default_factory=list)

    icpScore: int = Field(ge=0, le=100)
    icpReasons: list[str] = Field(default_factory=list)

    decisionMakers: list[DecisionMaker]


class CompanyList(BaseModel):
    """Structured outputs need an object at the root, not a bare array."""

    companies: list[CompanyDraft]


class OutreachDraft(BaseModel):
    """Personalization output: the campaign copy itself.

    companyId / decisionMakerId are deliberately absent - the server owns those
    ids and stitches them on, so the model cannot invent mismatched ones.
    """

    emailSubject: str
    emailBody: str
    linkedinMessage: str
    callScriptHead: str
    objectionHandling: str
    personalizationScore: int = Field(default=0, ge=0, le=100)


class ReplyClassification(BaseModel):
    """Reply triage output, from the small model."""

    classification: ReplyClass
    confidence: int = Field(default=0, ge=0, le=100)
    reason: str = ""


class EnrichmentDraft(BaseModel):
    """Enrichment output, carrying its own honesty label."""

    linkedinData: str
    statementType: StatementType = "generation"
    confidence: int = Field(default=0, ge=0, le=100)


# --------------------------------------------------------------------------
# API models
# --------------------------------------------------------------------------


class Company(CompanyDraft):
    id: str
    decisionMakers: list[ContactOut] = Field(default_factory=list)  # type: ignore[assignment]
    stage: CrmStage = "lead"

    linkedinData: Optional[str] = None
    enrichmentType: Optional[StatementType] = None
    enrichmentConfidence: Optional[int] = None

    # Section K2
    freshness: FreshnessBand = "fresh"
    freshnessDays: int = 0
    needsRetouch: bool = False
    lastVerified: Optional[str] = None

    # Which of the two businesses this account is worked for. Derived from
    # the brief it was found with, never stored - see signatures.py.
    business: Literal["tech", "market_research"] = "tech"


class OutreachCampaign(OutreachDraft):
    companyId: str
    decisionMakerId: str


class CrmConfig(BaseModel):
    enabled: bool = False
    provider: Optional[CrmProvider] = None
    apiKey: str = ""
    status: CrmStatus = "disconnected"


GeoScope = Literal["city", "state", "country"]


def join_or(items: list[str]) -> str:
    """'Pune', 'Pune or Mumbai', 'Pune, Mumbai or Bengaluru'."""
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return f"{', '.join(items[:-1])} or {items[-1]}"


class AreaPick(BaseModel):
    """One place to stay inside: a city, a state or region, or a country."""

    scope: GeoScope
    value: str = Field(min_length=1, max_length=120)


class SearchArea(BaseModel):
    """Where to look: any number of cities, states and countries, matched as
    "any of". An empty list means worldwide.

    Note this is NOT part of any structured-output schema - it is folded into
    the discovery prompt, so it costs nothing against the grammar complexity
    budget described above CompanyDraft."""

    areas: list[AreaPick] = Field(default_factory=list, max_length=12)

    @property
    def picks(self) -> list[AreaPick]:
        return [a for a in self.areas if a.value.strip()]

    @property
    def is_set(self) -> bool:
        return bool(self.picks)

    def as_label(self) -> str:
        return join_or([a.value.strip() for a in self.picks]) or "worldwide"


class IndustryFilter(BaseModel):
    """Which sectors to stay inside, matched as "any of". An empty list means
    all industries. Same deal as SearchArea - prompt-side only, so it costs
    nothing against the structured-output grammar budget.

    The names are free text, whether they came from the pick-list or were
    typed, because no fixed taxonomy survives contact with a real ICP."""

    sectors: list[str] = Field(default_factory=list, max_length=12)

    @property
    def picks(self) -> list[str]:
        return [s.strip() for s in self.sectors if s.strip()]

    @property
    def is_set(self) -> bool:
        return bool(self.picks)

    def as_label(self) -> str:
        return join_or(self.picks) or "all industries"


class RunPipelineRequest(BaseModel):
    icp: str = Field(min_length=1, description="Ideal Customer Profile description.")
    companyCount: int = Field(default=3, ge=1, le=10)
    location: Optional[SearchArea] = None
    industry: Optional[IndustryFilter] = None
    crmConfig: Optional[CrmConfig] = None


class PipelineState(BaseModel):
    """Everything saved in the database, in the shape the dashboard renders."""

    companies: list[Company]
    outreachCampaigns: list[OutreachCampaign]


class RunPipelineResponse(PipelineState):
    success: bool = True
    crmSynced: bool = False
    newCompanies: int = 0
    suppressedContacts: int = 0
    runCostUsd: float = 0.0
    # Accounts whose headquarters does not mention the area that was asked
    # for. The model can drift; saying so is better than quietly accepting it.
    offTarget: int = 0
    searchedArea: str = ""


class UpdateStageRequest(BaseModel):
    stage: CrmStage


class DeleteAllResponse(BaseModel):
    success: bool = True
    deleted: int


class EnrichCompanyResponse(BaseModel):
    success: bool = True
    linkedinData: str
    company: Company
    costUsd: float = 0.0


# --------------------------------------------------------------------------
# Dashboard, cost and compliance
# --------------------------------------------------------------------------


class FreshnessBucket(BaseModel):
    band: FreshnessBand
    label: str
    count: int


class GrowthPoint(BaseModel):
    """One month of record activity, for the growth chart."""

    month: str
    label: str
    added: int
    retouched: int


class ActionItem(BaseModel):
    """Something the workspace thinks deserves attention, and why."""

    id: str
    title: str
    why: str
    action: str
    view: str
    severity: Literal["info", "warning", "critical"] = "info"


class CampaignRow(BaseModel):
    """One row of the campaign performance table."""

    companyId: str
    company: str
    icpScore: int
    stage: str
    personalization: int
    enriched: bool


class DashboardResponse(BaseModel):
    """Section F: the Dashboard destination."""

    totalCompanies: int
    qualifiedCompanies: int
    qualifiedThreshold: int
    totalContacts: int
    campaigns: int
    averageIcp: int
    needsRetouch: int
    freshness: list[FreshnessBucket]
    stages: dict[str, int]
    totalCostUsd: float
    costPerCompany: float
    costPerQualified: float
    addedThisMonth: int
    growth: list[GrowthPoint]
    actions: list[ActionItem]
    campaignRows: list[CampaignRow]


class AgentSpend(BaseModel):
    agent: str
    model: str
    calls: int
    inputTokens: int
    outputTokens: int
    costUsd: float


class CostResponse(BaseModel):
    """Section K: where the money goes."""

    totalCostUsd: float
    totalCalls: int
    inputTokens: int
    outputTokens: int
    byAgent: list[AgentSpend]
    costPerCompany: float
    costPerQualified: float
    modelLarge: str
    modelSmall: str
    refreshPolicy: list["RefreshRule"]


class RefreshRule(BaseModel):
    band: str
    interval: str


class SuppressionEntry(BaseModel):
    id: str
    value: str
    reason: str
    source: str
    createdAt: str


class AddSuppressionRequest(BaseModel):
    value: str = Field(min_length=1, max_length=320)
    reason: str = Field(default="manual", max_length=100)


class SuppressionListResponse(BaseModel):
    entries: list[SuppressionEntry]
    total: int


# --------------------------------------------------------------------------
# System
# --------------------------------------------------------------------------


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    modelLarge: str
    modelSmall: str
    claudeConfigured: bool
    databaseConnected: bool
    userCount: int


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


Role = Literal["admin", "sales"]


class LoginResponse(BaseModel):
    accessToken: str
    tokenType: Literal["bearer"] = "bearer"
    expiresIn: int
    username: str
    role: Role


class SessionResponse(BaseModel):
    username: str
    role: Role


# --- Team accounts ---------------------------------------------------------


class UserOut(BaseModel):
    id: str
    username: str
    role: Role
    isActive: bool
    createdAt: Optional[str] = None
    lastLoginAt: Optional[str] = None


class UserListResponse(BaseModel):
    users: list[UserOut]


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=2, max_length=150)
    password: str = Field(min_length=8, max_length=200)
    role: Role = "sales"


class UpdateUserRequest(BaseModel):
    """Every field optional: send only what changes."""

    password: Optional[str] = Field(default=None, min_length=8, max_length=200)
    role: Optional[Role] = None
    isActive: Optional[bool] = None


CostResponse.model_rebuild()


# --------------------------------------------------------------------------
# Mailboxes, inbox and templates
# --------------------------------------------------------------------------


class MailboxCreateRequest(BaseModel):
    address: str = Field(min_length=3, max_length=320)
    displayName: str = Field(default="", max_length=160)
    smtpHost: str = Field(min_length=1, max_length=255)
    smtpPort: int = Field(default=587, ge=1, le=65535)
    imapHost: str = Field(min_length=1, max_length=255)
    imapPort: int = Field(default=993, ge=1, le=65535)
    username: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=512)
    dailyLimit: int = Field(default=40, ge=1, le=500)


class MailboxUpdateRequest(BaseModel):
    displayName: Optional[str] = Field(default=None, max_length=160)
    dailyLimit: Optional[int] = Field(default=None, ge=1, le=500)
    isActive: Optional[bool] = None
    password: Optional[str] = Field(default=None, max_length=512)


class MailboxOut(BaseModel):
    id: str
    address: str
    displayName: str
    smtpHost: str
    smtpPort: int
    imapHost: str
    imapPort: int
    username: str
    passwordMask: str
    dailyLimit: int
    sentToday: int
    remainingToday: int
    isActive: bool
    status: MailboxStatus
    statusDetail: str
    lastSyncAt: Optional[str] = None


class MailboxListResponse(BaseModel):
    mailboxes: list[MailboxOut]
    totalRemainingToday: int


class EmailOut(BaseModel):
    id: str
    direction: Literal["outbound", "inbound"]
    subject: str
    body: str
    fromAddress: str
    toAddress: str
    sentAt: str
    isRead: bool
    classification: Optional[ReplyClass] = None
    classificationConfidence: Optional[int] = None
    classificationReason: Optional[str] = None
    companyId: Optional[str] = None
    companyName: Optional[str] = None


class ThreadOut(BaseModel):
    threadKey: str
    subject: str
    counterparty: str
    companyId: Optional[str] = None
    companyName: Optional[str] = None
    lastAt: str
    messageCount: int
    unread: int
    classification: Optional[ReplyClass] = None
    awaitingReply: bool = False
    messages: list[EmailOut] = Field(default_factory=list)


class InboxResponse(BaseModel):
    threads: list[ThreadOut]
    unread: int
    needsResponse: int
    positive: int
    mailboxCount: int


# Where a sent message came from, so the Outbox can tell a one-off reply apart
# from a drafted campaign and from a bulk run.
SendSource = Literal["campaign", "bulk", "manual"]


class SentMessage(BaseModel):
    """One outbound message, with whatever is known about who got it."""

    id: str
    toAddress: str
    recipient: str = ""
    company: str = ""
    subject: str
    body: str
    sentAt: str
    fromAddress: str
    source: SendSource = "manual"
    threadKey: str = ""
    replied: bool = False
    replyClassification: Optional[ReplyClass] = None


class OutboxResponse(BaseModel):
    messages: list[SentMessage] = Field(default_factory=list)
    total: int = 0
    replied: int = 0
    sentToday: int = 0
    replyRate: float = 0.0
    truncated: bool = False


class SendEmailRequest(BaseModel):
    mailboxId: str
    companyId: Optional[str] = None
    toAddress: str = Field(min_length=3, max_length=320)
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1)


class ReplyRequest(BaseModel):
    mailboxId: str
    body: str = Field(min_length=1)


class SendEmailResponse(BaseModel):
    success: bool = True
    message: EmailOut
    remainingToday: int


class SyncResponse(BaseModel):
    success: bool = True
    fetched: int
    classified: int
    suppressed: int
    costUsd: float = 0.0
    errors: list[str] = Field(default_factory=list)


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    whenToUse: str = Field(default="", max_length=500)
    subject: str = Field(min_length=1)
    body: str = Field(min_length=1)


class TemplateOut(BaseModel):
    id: str
    name: str
    whenToUse: str
    subject: str
    body: str
    uses: int
    variables: list[str] = Field(default_factory=list)
    updatedAt: str


class TemplateListResponse(BaseModel):
    templates: list[TemplateOut]
    supportedVariables: list[str]


# --------------------------------------------------------------------------
# Priority queue, retouch and agents
# --------------------------------------------------------------------------


class QueueItem(BaseModel):
    companyId: str
    company: str
    contact: str
    contactTitle: str
    icpScore: int
    stage: str
    score: int
    reasons: list[str]
    action: str
    view: str


class PriorityQueueResponse(BaseModel):
    items: list[QueueItem]
    generatedAt: str
    weighting: list[str]


class RetouchIssue(BaseModel):
    issue: str
    count: int
    severity: Literal["low", "medium", "high"]
    resolution: str


class RetouchResponse(BaseModel):
    totalRecords: int
    flagged: int
    issues: list[RetouchIssue]
    estimatedCostUsd: float
    costPerRecordUsd: float
    savedVersusFullRefreshUsd: float
    smallModel: str
    refreshPolicy: list["RefreshRule"]


class AgentStatus(BaseModel):
    name: str
    role: str
    tier: Literal["large", "small"]
    model: str
    trigger: str
    approval: str
    calls: int
    costUsd: float
    avgCostUsd: float
    lastRunAt: Optional[str] = None


class AgentsResponse(BaseModel):
    agents: list[AgentStatus]
    modelLarge: str
    modelSmall: str
    totalCostUsd: float
    orchestratorPolicy: list[str]


# How sure the recipient's own mail server is that an address exists. This is
# the difference between a lead and a bounce, so it is never rounded off.
VerifyStatus = Literal[
    "verified", "rejected", "accepts_all", "unverified", "no_mx"
]


class EmailCandidate(BaseModel):
    """One possible address for a contact, with where it came from."""

    email: str
    source: Literal["hunter", "pattern"]
    confidence: int = Field(default=0, ge=0, le=100)
    status: VerifyStatus
    detail: str = ""


class FindEmailResponse(BaseModel):
    """Candidates only. Nothing is saved until a person picks one."""

    domain: str
    candidates: list[EmailCandidate] = Field(default_factory=list)
    note: str = ""
    mailServerReachable: bool = False
    hunterConfigured: bool = False


class FindEmailRequest(BaseModel):
    """Optional domain override, for when the client record has none."""

    domain: str = Field(default="", max_length=255)


class UpdateContactRequest(BaseModel):
    """A patch: omitted fields are left alone, "" clears the one you send."""

    email: Optional[str] = Field(default=None, max_length=320)
    phone: Optional[str] = Field(default=None, max_length=64)
    linkedin: Optional[str] = Field(default=None, max_length=512)


class CampaignSendTarget(BaseModel):
    companyId: str
    company: str
    contact: str
    email: str
    subject: str
    body: str
    sendable: bool
    blockedReason: Optional[str] = None


class CampaignSendPreview(BaseModel):
    """What a bulk send would do, before anything is sent."""

    targets: list[CampaignSendTarget]
    sendable: int
    blocked: int
    remainingToday: int


class SendCampaignRequest(BaseModel):
    mailboxId: str
    companyIds: list[str] = Field(min_length=1, max_length=10)


class CampaignSendResult(BaseModel):
    companyId: str
    company: str
    email: str
    status: Literal["sent", "skipped", "failed"]
    detail: str = ""


# --------------------------------------------------------------------------
# Bulk outreach
# --------------------------------------------------------------------------

BroadcastStatus = Literal[
    "queued", "running", "done", "cancelling", "cancelled", "interrupted", "error"
]
RecipientStatus = Literal["pending", "sent", "skipped", "failed"]
ExportFormat = Literal["xlsx", "docx", "pdf", "csv"]


class MessageTemplateOut(BaseModel):
    """One angle a brand can open on."""

    key: str
    label: str
    hint: str = ""
    subject: str
    body: str


class BrandOut(BaseModel):
    """One of the businesses a list can be mailed on behalf of."""

    key: str
    name: str
    site: str
    # Several angles, so a second round reaches people with different copy.
    templates: list[MessageTemplateOut] = Field(default_factory=list)


class RecipientOut(BaseModel):
    id: str
    email: str
    name: str = ""
    company: str = ""
    title: str = ""
    industry: str = ""
    location: str = ""
    sourceFile: str = ""
    status: RecipientStatus = "pending"
    detail: str = ""
    # How many times they have actually been emailed - their place in the
    # rotation. 0 means never contacted.
    sendCount: int = 0
    sentAt: Optional[str] = None
    suppressed: bool = False
    replied: bool = False
    # Set when this row's address belongs to another contact, who gets the
    # mail instead. Names them, so the row explains itself.
    sharesAddressWith: Optional[str] = None


class BroadcastJobOut(BaseModel):
    id: str
    brand: str
    subject: str
    status: BroadcastStatus
    detail: str = ""
    total: int
    sent: int
    skipped: int
    failed: int
    delaySeconds: int
    mailbox: str = ""
    createdAt: str
    finishedAt: Optional[str] = None

    @property
    def done_count(self) -> int:
        return self.sent + self.skipped + self.failed


class BroadcastReply(BaseModel):
    """An inbound message from someone on the uploaded list."""

    id: str
    fromAddress: str
    subject: str
    body: str
    receivedAt: str
    isRead: bool
    classification: Optional[ReplyClass] = None
    classificationReason: Optional[str] = None


class ClearResult(BaseModel):
    removed: int
    remaining: int


class ListSource(BaseModel):
    """One uploaded file's worth of the list, so it can be removed on its own."""

    fileName: str
    count: int
    mailable: int


class UploadResult(BaseModel):
    added: int
    # Rows kept and shown, but not mailable: their address is already another
    # contact's, so mailing them would hit one inbox several times.
    sharedAddress: int = 0
    duplicatesInFile: int = 0
    alreadyOnList: int = 0
    invalid: int = 0
    suppressed: int = 0
    truncated: bool = False
    fileName: str = ""


class StartBroadcastRequest(BaseModel):
    mailboxId: str
    brand: str = Field(min_length=1)
    subject: str = Field(min_length=1)
    body: str = Field(min_length=1)
    # 1, 10 or up to 100 - the ceiling is the point, so it is enforced here
    # rather than only in the UI.
    count: int = Field(default=10, ge=1, le=100)
    delaySeconds: int = Field(default=15, ge=5, le=300)


class BroadcastState(BaseModel):
    recipients: list[RecipientOut] = Field(default_factory=list)
    jobs: list[BroadcastJobOut] = Field(default_factory=list)
    replies: list[BroadcastReply] = Field(default_factory=list)
    brands: list[BrandOut] = Field(default_factory=list)
    # The files this list was built from. Removing one drops only its rows.
    sources: list[ListSource] = Field(default_factory=list)
    pending: int = 0
    sent: int = 0
    # Everyone the next batch could draw from, once opt-outs are removed.
    eligible: int = 0
    # The round the rotation is currently working through; 1 is first contact.
    currentRound: int = 1
    # Recipient ids in the exact order they would be mailed next.
    nextUp: list[str] = Field(default_factory=list)
    remainingToday: int = 0
    mailboxCount: int = 0
    activeJobId: Optional[str] = None


class SendCampaignResponse(BaseModel):
    success: bool = True
    sent: int
    skipped: int
    failed: int
    remainingToday: int
    results: list[CampaignSendResult]


# --------------------------------------------------------------------------
# Workspace settings and the signed-in account
# --------------------------------------------------------------------------


class WorkspaceSettingsValues(BaseModel):
    """Everything an admin can change from the Settings screen.

    The bounds match the ones the endpoints these feed already enforce, so a
    default can never be a value the form it opens in would refuse.
    """

    workspaceName: str = Field(min_length=1, max_length=80)

    # What Discover opens with.
    defaultCompanyCount: int = Field(ge=1, le=10)
    # Any of these counts. Empty means worldwide, or all industries.
    defaultAreas: list[AreaPick] = Field(default_factory=list, max_length=12)
    defaultSectors: list[str] = Field(default_factory=list, max_length=12)

    # Qualification and the refresh policy - see freshness.py.
    highIcpThreshold: int = Field(ge=1, le=100)
    refreshDaysHighIcpActive: int = Field(ge=1, le=3650)
    refreshDaysHighIcpDormant: int = Field(ge=1, le=3650)
    refreshDaysMidIcp: int = Field(ge=1, le=3650)

    # Sending.
    defaultBatchSize: int = Field(ge=1, le=100)
    defaultDelaySeconds: int = Field(ge=5, le=300)
    defaultDailyLimit: int = Field(ge=1, le=500)
    allowGuessedEmails: bool = False

    # Claude spend per calendar month, USD. 0 means no cap.
    monthlyBudgetUsd: float = Field(ge=0, le=1_000_000)

    signatureTech: str = Field(default="", max_length=2000)
    signatureMarketResearch: str = Field(default="", max_length=2000)


class WorkspaceSettingsUpdate(BaseModel):
    """Every field optional: send only what changes."""

    workspaceName: Optional[str] = Field(default=None, min_length=1, max_length=80)
    defaultCompanyCount: Optional[int] = Field(default=None, ge=1, le=10)
    defaultAreas: Optional[list[AreaPick]] = Field(default=None, max_length=12)
    defaultSectors: Optional[list[str]] = Field(default=None, max_length=12)
    highIcpThreshold: Optional[int] = Field(default=None, ge=1, le=100)
    refreshDaysHighIcpActive: Optional[int] = Field(default=None, ge=1, le=3650)
    refreshDaysHighIcpDormant: Optional[int] = Field(default=None, ge=1, le=3650)
    refreshDaysMidIcp: Optional[int] = Field(default=None, ge=1, le=3650)
    defaultBatchSize: Optional[int] = Field(default=None, ge=1, le=100)
    defaultDelaySeconds: Optional[int] = Field(default=None, ge=5, le=300)
    defaultDailyLimit: Optional[int] = Field(default=None, ge=1, le=500)
    allowGuessedEmails: Optional[bool] = None
    monthlyBudgetUsd: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    signatureTech: Optional[str] = Field(default=None, max_length=2000)
    signatureMarketResearch: Optional[str] = Field(default=None, max_length=2000)


class WorkspaceSettingsResponse(BaseModel):
    settings: WorkspaceSettingsValues
    # What Reset restores: the .env values, or the built-in ones.
    envDefaults: WorkspaceSettingsValues
    spentThisMonthUsd: float = 0.0
    # Read-only facts from .env, reported so nobody hunts for a control that
    # is not there.
    modelLarge: str
    modelSmall: str
    claudeConfigured: bool
    hunterConfigured: bool
    sessionHours: int
    updatedAt: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    currentPassword: str = Field(min_length=1)
    newPassword: str = Field(min_length=8, max_length=200)
