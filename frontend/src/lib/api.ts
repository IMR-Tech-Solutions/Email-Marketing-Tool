/**
 * Client for the FastAPI backend in ../../Backend.
 *
 * In development the Vite dev server proxies /api to the backend, so paths stay
 * relative. Set VITE_API_URL to point at an absolute backend URL in deployments
 * where that proxy is not in front of the app.
 */

import {
  ClearPipelineResponse,
  Company,
  CostResponse,
  CrmStage,
  DashboardResponse,
  EnrichCompanyResponse,
  HealthResponse,
  LoginResponse,
  PipelineState,
  RunPipelineResponse,
  SearchArea,
  SessionResponse,
  SuppressionEntry,
  SuppressionListResponse,
  AgentsResponse,
  EmailThread,
  InboxResponse,
  OutboxResponse,
  Mailbox,
  MailboxListResponse,
  PriorityQueueResponse,
  RetouchResponse,
  SendEmailResponse,
  SyncResponse,
  CampaignSendPreview,
  CampaignSendResult,
  SendCampaignResponse,
  Template,
  TemplateListResponse,
  CrmConfig,
  ContactPatch,
  FindEmailResponse,
  BroadcastState,
  BroadcastJob,
  UploadResult,
  ExportFormat,
  ExportScope,
  ClearResult,
} from '../types';
import {clearToken, getToken} from './auth';

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** Called whenever the backend rejects our token, so App can show the login screen. */
let onUnauthorized: (() => void) | null = null;

export function registerUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (login itself). */
  anonymous?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {method = 'GET', body, anonymous = false} = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (!anonymous) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(
      'Could not reach the backend. Is the FastAPI server running on port 8000?',
    );
  }

  const data = await response.json().catch(() => null);

  if (response.status === 401 && !anonymous) {
    // The token is gone, expired or invalid — drop it and bounce to login.
    clearToken();
    onUnauthorized?.();
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as T;
}

/** Requests that come back as a file rather than JSON. */
async function download(path: string): Promise<{blob: Blob; filename: string}> {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? {Authorization: `Bearer ${token}`} : {},
  });
  if (response.status === 401) {
    clearToken();
    onUnauthorized?.();
  }
  if (!response.ok) {
    // Errors still come back as JSON even on a download endpoint.
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Export failed with status ${response.status}`);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  return {blob: await response.blob(), filename: match?.[1] ?? 'export'};
}

export const api = {
  registerUnauthorizedHandler,

  /** Public: which models are wired up, and whether the key is set. */
  getHealth() {
    return request<HealthResponse>('/api/health', {anonymous: true});
  },

  /** Exchange the dashboard credentials for a session token. */
  login(username: string, password: string) {
    return request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: {username, password},
      anonymous: true,
    });
  },

  /** Check that a stored token is still valid. */
  me() {
    return request<SessionResponse>('/api/auth/me');
  },

  /** Everything saved in Postgres — loaded once on sign-in. */
  getPipeline() {
    return request<PipelineState>('/api/companies');
  },

  /**
   * Agents 1-4: discover, research and draft outreach for the given ICP.
   * The results are saved, and the whole board comes back — not just the
   * new rows — so runs accumulate instead of replacing each other.
   */
  runPipeline(
    icp: string,
    companyCount: number,
    crmConfig: CrmConfig,
    location?: SearchArea,
  ) {
    return request<RunPipelineResponse>('/api/run-pipeline', {
      method: 'POST',
      body: {icp, companyCount, crmConfig, location},
    });
  },

  /** Persist a drag-and-drop on the pipeline board. */
  updateStage(companyId: string, stage: CrmStage) {
    return request<Company>(`/api/companies/${companyId}`, {
      method: 'PATCH',
      body: {stage},
    });
  },

  /** Agent 5: deep-enrich a saved account. The result is stored. */
  enrichCompany(companyId: string) {
    return request<EnrichCompanyResponse>(`/api/companies/${companyId}/enrich`, {
      method: 'POST',
    });
  },

  /** Delete every saved account. Users, suppression and cost are untouched. */
  clearPipeline() {
    return request<ClearPipelineResponse>('/api/companies', {method: 'DELETE'});
  },

  /** Headline numbers plus the database-health breakdown. */
  getDashboard() {
    return request<DashboardResponse>('/api/dashboard');
  },

  /** Real spend, from the recorded token usage of every Claude call. */
  getCost() {
    return request<CostResponse>('/api/cost');
  },

  getSuppression() {
    return request<SuppressionListResponse>('/api/suppression');
  },

  addSuppression(value: string, reason: string) {
    return request<SuppressionEntry>('/api/suppression', {
      method: 'POST',
      body: {value, reason},
    });
  },

  removeSuppression(id: string) {
    return request<void>(`/api/suppression/${id}`, {method: 'DELETE'});
  },

  // --- Mailboxes ---

  getMailboxes() {
    return request<MailboxListResponse>('/api/mailboxes');
  },

  /** Verifies SMTP and IMAP before anything is stored. */
  connectMailbox(body: {
    address: string;
    displayName: string;
    smtpHost: string;
    smtpPort: number;
    imapHost: string;
    imapPort: number;
    username: string;
    password: string;
    dailyLimit: number;
  }) {
    return request<Mailbox>('/api/mailboxes', {method: 'POST', body});
  },

  testMailbox(id: string) {
    return request<Mailbox>(`/api/mailboxes/${id}/test`, {method: 'POST'});
  },

  updateMailbox(
    id: string,
    body: {displayName?: string; dailyLimit?: number; isActive?: boolean; password?: string},
  ) {
    return request<Mailbox>(`/api/mailboxes/${id}`, {method: 'PATCH', body});
  },

  deleteMailbox(id: string) {
    return request<void>(`/api/mailboxes/${id}`, {method: 'DELETE'});
  },

  // --- Inbox ---

  getInbox() {
    return request<InboxResponse>('/api/inbox');
  },

  /** Everything sent, newest first, with whether each one got an answer. */
  getOutbox() {
    return request<OutboxResponse>('/api/outbox');
  },

  /** Pull new replies, triage them, and auto-suppress opt-outs. */
  syncInbox() {
    return request<SyncResponse>('/api/inbox/sync', {method: 'POST'});
  },

  sendEmail(body: {
    mailboxId: string;
    companyId?: string;
    toAddress: string;
    subject: string;
    body: string;
  }) {
    return request<SendEmailResponse>('/api/inbox/send', {method: 'POST', body});
  },

  replyToThread(threadKey: string, mailboxId: string, body: string) {
    return request<SendEmailResponse>(
      `/api/inbox/threads/${encodeURIComponent(threadKey)}/reply`,
      {method: 'POST', body: {mailboxId, body}},
    );
  },

  /** What a bulk send would do, before anything is sent. */
  getCampaignPreview() {
    return request<CampaignSendPreview>('/api/inbox/campaign-preview');
  },

  /** Send the drafted outreach to up to ten selected clients. */
  sendCampaign(mailboxId: string, companyIds: string[]) {
    return request<SendCampaignResponse>('/api/inbox/send-campaign', {
      method: 'POST',
      body: {mailboxId, companyIds},
    });
  },

  /**
   * Candidate addresses for one contact, from Hunter where it is configured
   * and from domain patterns otherwise, each checked against the recipient's
   * mail server. Saves nothing — the caller picks one and PATCHes it.
   */
  findContactEmail(companyId: string, contactId: string, domain = '') {
    return request<FindEmailResponse>(
      `/api/companies/${companyId}/contacts/${contactId}/find-email`,
      {method: 'POST', body: {domain}},
    );
  },

  /**
   * The only way an address or a number enters the system — and the only way
   * a LinkedIn URL stops being the agent's guess. Omitted keys are left alone,
   * so saving a phone number does not wipe the email.
   */
  updateContact(companyId: string, contactId: string, patch: ContactPatch) {
    return request<Company>(`/api/companies/${companyId}/contacts/${contactId}`, {
      method: 'PATCH',
      body: patch,
    });
  },

  markThreadRead(threadKey: string) {
    return request<void>(`/api/inbox/threads/${encodeURIComponent(threadKey)}/read`, {
      method: 'POST',
    });
  },

  // --- Templates ---

  getTemplates() {
    return request<TemplateListResponse>('/api/templates');
  },

  createTemplate(body: {name: string; whenToUse: string; subject: string; body: string}) {
    return request<Template>('/api/templates', {method: 'POST', body});
  },

  updateTemplate(
    id: string,
    body: {name: string; whenToUse: string; subject: string; body: string},
  ) {
    return request<Template>(`/api/templates/${id}`, {method: 'PUT', body});
  },

  deleteTemplate(id: string) {
    return request<void>(`/api/templates/${id}`, {method: 'DELETE'});
  },

  // --- Workspace ---

  // --- Bulk outreach ---

  getBroadcast() {
    return request<BroadcastState>('/api/broadcast');
  },

  /** Reads a .xlsx/.csv/.txt of contacts onto the list. */
  async uploadBroadcastList(file: File) {
    const token = getToken();
    const form = new FormData();
    form.append('file', file);
    // No Content-Type header — the browser has to set the multipart boundary.
    const response = await fetch(`${API_BASE_URL}/api/broadcast/upload`, {
      method: 'POST',
      headers: token ? {Authorization: `Bearer ${token}`} : {},
      body: form,
    });
    const data = await response.json().catch(() => null);
    if (response.status === 401) {
      clearToken();
      onUnauthorized?.();
    }
    if (!response.ok) throw new Error(data?.error || 'That file could not be read.');
    return data as UploadResult;
  },

  /**
   * Queues the next N pending recipients and returns immediately. The sending
   * itself runs in the background at `delaySeconds` apart — poll getBroadcast.
   */
  startBroadcast(body: {
    mailboxId: string;
    brand: string;
    subject: string;
    body: string;
    count: number;
    delaySeconds: number;
  }) {
    return request<BroadcastJob>('/api/broadcast/send', {method: 'POST', body});
  },

  cancelBroadcast(jobId: string) {
    return request<BroadcastJob>(`/api/broadcast/jobs/${jobId}/cancel`, {method: 'POST'});
  },

  /** Removes rows from the list. Pass a file name to drop just that import. */
  clearBroadcastList(only: 'all' | 'pending' | 'sent' = 'all', sourceFile = '') {
    const query = new URLSearchParams({only});
    if (sourceFile) query.set('sourceFile', sourceFile);
    return request<ClearResult>(`/api/broadcast/recipients?${query}`, {method: 'DELETE'});
  },

  /** Pulls the file down and hands the browser a save dialog. */
  async exportBroadcast(format: ExportFormat, scope: ExportScope) {
    const {blob, filename} = await download(
      `/api/broadcast/export?format=${format}&scope=${scope}`,
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return filename;
  },

  getPriorityQueue() {
    return request<PriorityQueueResponse>('/api/priority-queue');
  },

  getRetouch() {
    return request<RetouchResponse>('/api/retouch');
  },

  getAgents() {
    return request<AgentsResponse>('/api/agents');
  },
};
