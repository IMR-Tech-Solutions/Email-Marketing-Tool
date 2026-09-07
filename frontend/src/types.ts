export interface DecisionMaker {
  id: string;
  name: string;
  title: string;
  /** The agent's guess until `linkedinVerified` is true. */
  linkedin: string;
  linkedinVerified: boolean;
  /** Typed by a person, never generated. Empty means unsendable. */
  email: string;
  /** Typed by a person, never generated. Empty means undialable. */
  phone: string;
}

/** A patch for one contact: omitted keys are left as they are. */
export interface ContactPatch {
  email?: string;
  phone?: string;
  linkedin?: string;
}

/**
 * What the recipient's own mail server said about an address. The gap between
 * `verified` and `unverified` is the gap between a lead and a hard bounce, so
 * the UI never collapses them.
 */
export type VerifyStatus =
  | 'verified'
  | 'rejected'
  | 'accepts_all'
  | 'unverified'
  | 'no_mx';

export interface EmailCandidate {
  email: string;
  source: 'hunter' | 'pattern';
  confidence: number;
  status: VerifyStatus;
  detail: string;
}

/** Suggestions only — nothing is stored until a person picks one. */
export interface FindEmailResponse {
  domain: string;
  candidates: EmailCandidate[];
  note: string;
  mailServerReachable: boolean;
  hunterConfigured: boolean;
}

export interface CrmConfig {
  enabled: boolean;
  provider: 'salesforce' | 'hubspot' | null;
  apiKey: string;
  status: 'disconnected' | 'connected' | 'error';
}

export type CrmStage = 'lead' | 'contacted' | 'engaged' | 'proposal' | 'won' | 'lost';

export type StatementType = 'data' | 'inference' | 'generation';
export type FreshnessBand = 'fresh' | 'good' | 'aging' | 'stale' | 'critical';

export interface Company {
  id: string;
  name: string;
  industry: string;
  revenue: string;
  employees: number;
  description: string;
  icpScore: number;
  /** 2-4 short codes explaining the ICP score, so a human can argue with it. */
  icpReasons: string[];
  recentNews: string;

  // The research dossier from Discover. All model-written, all labelled as
  // such in the client panel. The field set is capped by the structured-output
  // budget — see the note above CompanyDraft in Backend/app/schemas.py.
  website: string;
  headquarters: string;
  founded: string;
  /** Their most recent product, facility, market or capability. */
  latestLaunch: string;
  products: string[];
  buyingSignals: string[];
  painPoints: string[];

  linkedinData?: string | null;
  enrichmentType?: StatementType | null;
  enrichmentConfidence?: number | null;
  freshness: FreshnessBand;
  freshnessDays: number;
  needsRetouch: boolean;
  lastVerified?: string | null;
  isEnriching?: boolean;
  decisionMakers: DecisionMaker[];
  stage?: CrmStage;
}

export interface OutreachCampaign {
  companyId: string;
  decisionMakerId: string;
  emailSubject: string;
  emailBody: string;
  linkedinMessage: string;
  callScriptHead: string;
  objectionHandling: string;
  personalizationScore: number;
}

export interface PipelineData {
  companies: Company[];
  outreachCampaigns: OutreachCampaign[];
  isGenerating: boolean;
}

// --- API responses (must match Backend/app/schemas.py) ---

export interface PipelineState {
  companies: Company[];
  outreachCampaigns: OutreachCampaign[];
}

/** Where Discover should look. `global` ignores `value`. */
export type GeoScope = 'city' | 'state' | 'country' | 'global';

export interface SearchArea {
  scope: GeoScope;
  value: string;
}

/** Which sector Discover should stay inside. `all` ignores `value`. */
export type IndustryMode = 'all' | 'preset' | 'custom';

export interface IndustryFilter {
  mode: IndustryMode;
  value: string;
}

export interface RunPipelineResponse extends PipelineState {
  success: boolean;
  crmSynced: boolean;
  newCompanies: number;
  suppressedContacts: number;
  runCostUsd: number;
  /** Accounts whose headquarters does not name the area that was asked for. */
  offTarget: number;
  searchedArea: string;
}

export interface EnrichCompanyResponse {
  success: boolean;
  linkedinData: string;
  company: Company;
  costUsd: number;
}

export interface ClearPipelineResponse {
  success: boolean;
  deleted: number;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  username: string;
}

export interface SessionResponse {
  username: string;
}

// --- Dashboard, cost and compliance ---

export interface FreshnessBucket {
  band: FreshnessBand;
  label: string;
  count: number;
}

export interface DashboardResponse {
  totalCompanies: number;
  qualifiedCompanies: number;
  qualifiedThreshold: number;
  totalContacts: number;
  campaigns: number;
  averageIcp: number;
  needsRetouch: number;
  freshness: FreshnessBucket[];
  stages: Record<string, number>;
  totalCostUsd: number;
  costPerCompany: number;
  costPerQualified: number;
  addedThisMonth: number;
  growth: GrowthPoint[];
  actions: ActionItem[];
  campaignRows: CampaignRow[];
}

export interface AgentSpend {
  agent: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface RefreshRule {
  band: string;
  interval: string;
}

export interface CostResponse {
  totalCostUsd: number;
  totalCalls: number;
  inputTokens: number;
  outputTokens: number;
  byAgent: AgentSpend[];
  costPerCompany: number;
  costPerQualified: number;
  modelLarge: string;
  modelSmall: string;
  refreshPolicy: RefreshRule[];
}

export interface SuppressionEntry {
  id: string;
  value: string;
  reason: string;
  source: string;
  createdAt: string;
}

export interface SuppressionListResponse {
  entries: SuppressionEntry[];
  total: number;
}

export interface HealthResponse {
  status: string;
  modelLarge: string;
  modelSmall: string;
  claudeConfigured: boolean;
  databaseConnected: boolean;
  userCount: number;
}

export interface GrowthPoint {
  month: string;
  label: string;
  added: number;
  retouched: number;
}

export interface ActionItem {
  id: string;
  title: string;
  why: string;
  action: string;
  view: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface CampaignRow {
  companyId: string;
  company: string;
  icpScore: number;
  stage: string;
  personalization: number;
  enriched: boolean;
}

// --- Mailboxes, inbox, templates, queue, retouch, agents ---

export type ReplyClass =
  | 'positive'
  | 'referral'
  | 'neutral'
  | 'not_interested'
  | 'unsubscribe'
  | 'auto_reply';

export type MailboxStatus = 'untested' | 'connected' | 'error' | 'disabled';

export interface Mailbox {
  id: string;
  address: string;
  displayName: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  username: string;
  passwordMask: string;
  dailyLimit: number;
  sentToday: number;
  remainingToday: number;
  isActive: boolean;
  status: MailboxStatus;
  statusDetail: string;
  lastSyncAt?: string | null;
}

export interface MailboxListResponse {
  mailboxes: Mailbox[];
  totalRemainingToday: number;
}

export interface EmailMessage {
  id: string;
  direction: 'outbound' | 'inbound';
  subject: string;
  body: string;
  fromAddress: string;
  toAddress: string;
  sentAt: string;
  isRead: boolean;
  classification?: ReplyClass | null;
  classificationConfidence?: number | null;
  classificationReason?: string | null;
  companyId?: string | null;
  companyName?: string | null;
}

export interface EmailThread {
  threadKey: string;
  subject: string;
  counterparty: string;
  companyId?: string | null;
  companyName?: string | null;
  lastAt: string;
  messageCount: number;
  unread: number;
  classification?: ReplyClass | null;
  awaitingReply: boolean;
  messages: EmailMessage[];
}

export interface InboxResponse {
  threads: EmailThread[];
  unread: number;
  needsResponse: number;
  positive: number;
  mailboxCount: number;
}

export interface SendEmailResponse {
  success: boolean;
  message: EmailMessage;
  remainingToday: number;
}

export interface SyncResponse {
  success: boolean;
  fetched: number;
  classified: number;
  suppressed: number;
  costUsd: number;
  errors: string[];
}

export interface Template {
  id: string;
  name: string;
  whenToUse: string;
  subject: string;
  body: string;
  uses: number;
  variables: string[];
  updatedAt: string;
}

export interface TemplateListResponse {
  templates: Template[];
  supportedVariables: string[];
}

export interface QueueItem {
  companyId: string;
  company: string;
  contact: string;
  contactTitle: string;
  icpScore: number;
  stage: string;
  score: number;
  reasons: string[];
  action: string;
  view: string;
}

export interface PriorityQueueResponse {
  items: QueueItem[];
  generatedAt: string;
  weighting: string[];
}

export interface RetouchIssue {
  issue: string;
  count: number;
  severity: 'low' | 'medium' | 'high';
  resolution: string;
}

export interface RetouchResponse {
  totalRecords: number;
  flagged: number;
  issues: RetouchIssue[];
  estimatedCostUsd: number;
  costPerRecordUsd: number;
  savedVersusFullRefreshUsd: number;
  smallModel: string;
  refreshPolicy: RefreshRule[];
}

export interface AgentStatus {
  name: string;
  role: string;
  tier: 'large' | 'small';
  model: string;
  trigger: string;
  approval: string;
  calls: number;
  costUsd: number;
  avgCostUsd: number;
  lastRunAt?: string | null;
}

export interface AgentsResponse {
  agents: AgentStatus[];
  modelLarge: string;
  modelSmall: string;
  totalCostUsd: number;
  orchestratorPolicy: string[];
}

export interface CampaignSendTarget {
  companyId: string;
  company: string;
  contact: string;
  email: string;
  subject: string;
  body: string;
  sendable: boolean;
  blockedReason?: string | null;
}

export interface CampaignSendPreview {
  targets: CampaignSendTarget[];
  sendable: number;
  blocked: number;
  remainingToday: number;
}

export interface CampaignSendResult {
  companyId: string;
  company: string;
  email: string;
  status: 'sent' | 'skipped' | 'failed';
  detail: string;
}

export interface SendCampaignResponse {
  success: boolean;
  sent: number;
  skipped: number;
  failed: number;
  remainingToday: number;
  results: CampaignSendResult[];
}


// --- Bulk outreach --------------------------------------------------------

export type BroadcastStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'cancelling'
  | 'cancelled'
  | 'interrupted'
  | 'error';

export type RecipientStatus = 'pending' | 'sent' | 'skipped' | 'failed';
export type ExportFormat = 'xlsx' | 'docx' | 'pdf' | 'csv';
export type ExportScope = 'recipients' | 'clients' | 'replies';

/** One angle a brand can open on. */
export interface MessageTemplate {
  key: string;
  label: string;
  hint: string;
  subject: string;
  body: string;
}

/** One of the two businesses a list can be mailed on behalf of. */
export interface Brand {
  key: string;
  name: string;
  site: string;
  /** Several angles, so a second round doesn't repeat the first. */
  templates: MessageTemplate[];
}

export interface Recipient {
  id: string;
  email: string;
  name: string;
  company: string;
  title: string;
  industry: string;
  location: string;
  sourceFile: string;
  status: RecipientStatus;
  detail: string;
  /** How many times they have actually been emailed — their place in the rotation. */
  sendCount: number;
  sentAt?: string | null;
  suppressed: boolean;
  replied: boolean;
  /** Names the contact who gets the mail when this row's address is theirs. */
  sharesAddressWith?: string | null;
}

export interface BroadcastJob {
  id: string;
  brand: string;
  subject: string;
  status: BroadcastStatus;
  detail: string;
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  delaySeconds: number;
  mailbox: string;
  createdAt: string;
  finishedAt?: string | null;
}

export interface BroadcastReply {
  id: string;
  fromAddress: string;
  subject: string;
  body: string;
  receivedAt: string;
  isRead: boolean;
  classification?: ReplyClass | null;
  classificationReason?: string | null;
}

/** One uploaded file's worth of the list. */
export interface ListSource {
  fileName: string;
  count: number;
  mailable: number;
}

export interface ClearResult {
  removed: number;
  remaining: number;
}

export interface UploadResult {
  added: number;
  /** Kept and shown, but not mailable — their address is another contact's. */
  sharedAddress: number;
  duplicatesInFile: number;
  alreadyOnList: number;
  invalid: number;
  suppressed: number;
  truncated: boolean;
  fileName: string;
}

export interface BroadcastState {
  recipients: Recipient[];
  jobs: BroadcastJob[];
  replies: BroadcastReply[];
  brands: Brand[];
  /** The files this list was built from. Removing one drops only its rows. */
  sources: ListSource[];
  pending: number;
  sent: number;
  /** Everyone the next batch can draw from, once opt-outs are removed. */
  eligible: number;
  /** The round being worked through now; 1 is first contact. */
  currentRound: number;
  /** Recipient ids in the exact order they would be mailed next. */
  nextUp: string[];
  remainingToday: number;
  mailboxCount: number;
  activeJobId?: string | null;
}


// --- Outbox ---------------------------------------------------------------

/** Where a sent message came from. */
export type SendSource = 'campaign' | 'bulk' | 'manual';

export interface SentMessage {
  id: string;
  toAddress: string;
  recipient: string;
  company: string;
  subject: string;
  body: string;
  sentAt: string;
  fromAddress: string;
  source: SendSource;
  threadKey: string;
  replied: boolean;
  replyClassification?: ReplyClass | null;
}

export interface OutboxResponse {
  messages: SentMessage[];
  total: number;
  replied: number;
  sentToday: number;
  replyRate: number;
  /** True when history is longer than the window the screen renders. */
  truncated: boolean;
}
