/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { CommandPalette } from './components/CommandPalette';
import { RunAgentsView } from './components/RunAgentsView';
import { CompaniesView } from './components/CompaniesView';
import { OutreachView } from './components/OutreachView';
import { AnalyticsView } from './components/AnalyticsView';
import { CrmSettingsView } from './components/CrmSettingsView';
import { InternalCrmView } from './components/InternalCrmView';
import { SystemSettingsView } from './components/SystemSettingsView';
import { DashboardView } from './components/DashboardView';
import { CostView } from './components/CostView';
import { ComplianceView } from './components/ComplianceView';
import { LoginView } from './components/LoginView';
import { InboxView } from './components/InboxView';
import { OutboxView } from './components/OutboxView';
import { MailboxesView } from './components/MailboxesView';
import { TemplatesView } from './components/TemplatesView';
import { PriorityQueueView } from './components/PriorityQueueView';
import { RetouchView } from './components/RetouchView';
import { BroadcastView } from './components/BroadcastView';
import { AgentsView } from './components/AgentsView';
import { SendCampaignModal } from './components/SendCampaignModal';
import { TeamView } from './components/TeamView';
import { ADMIN_VIEWS } from './lib/roles';
import {
  PipelineData,
  BroadcastState,
  ExportFormat,
  ExportScope,
  ContactPatch,
  SearchArea,
  IndustryFilter,
  CrmConfig,
  Company,
  CrmStage,
  CostResponse,
  DashboardResponse,
  SuppressionEntry,
  AgentsResponse,
  InboxResponse,
  OutboxResponse,
  Mailbox,
  PriorityQueueResponse,
  RetouchResponse,
  TemplateListResponse,
  CampaignSendPreview,
  CampaignSendResult,
  Role,
  DiscoveryDefaults,
  WorkspaceSettingsResponse,
  WorkspaceSettingsValues
} from './types';
import { api } from './lib/api';
import { clearToken, getToken, readPref, readPrefString, writePref } from './lib/auth';

/** Which screen a sign-in lands on. Chosen under Settings > Your account. */
const homeView = () => readPrefString('home-view', 'dashboard');


const VIEW_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  run: 'Discover',
  companies: 'Accounts',
  crm_board: 'Deal Board',
  outreach: 'Campaigns',
  analytics: 'Analytics',
  cost: 'Cost',
  compliance: 'Compliance & Suppression',
  crm: 'Integrations',
  settings: 'Settings',
  team: 'Team',
  inbox: 'Inbox',
  mailboxes: 'Mailboxes',
  templates: 'Templates',
  queue: 'Priority Queue',
  retouch: 'Database Retouch',
  agents: 'AI Agents',
};

export default function App() {
  const [currentView, setCurrentView] = useState(homeView);
  const [pipelineData, setPipelineData] = useState<PipelineData>({
    companies: [],
    outreachCampaigns: [],
    isGenerating: false,
  });

  const [crmConfig, setCrmConfig] = useState<CrmConfig>({
    enabled: false,
    provider: 'salesforce',
    apiKey: '',
    status: 'disconnected',
  });

  const [health, setHealth] = useState<{ claudeConfigured: boolean; modelLarge: string } | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => readPref('rail-collapsed', false));
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [cost, setCost] = useState<CostResponse | null>(null);
  const [suppression, setSuppression] = useState<SuppressionEntry[]>([]);
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [broadcast, setBroadcast] = useState<BroadcastState | null>(null);
  const [outbox, setOutbox] = useState<OutboxResponse | null>(null);
  const [remainingSends, setRemainingSends] = useState(0);
  const [templates, setTemplates] = useState<TemplateListResponse | null>(null);
  const [queue, setQueue] = useState<PriorityQueueResponse | null>(null);
  const [retouch, setRetouch] = useState<RetouchResponse | null>(null);
  const [agentRoster, setAgentRoster] = useState<AgentsResponse | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [sendPreview, setSendPreview] = useState<CampaignSendPreview | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  // Defaults and policies from Settings. What Discover, Bulk Outreach and the
  // mailbox form open with, and the name under yours in the top bar.
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettingsResponse | null>(null);

  const discoveryDefaults = useMemo<DiscoveryDefaults | undefined>(() => {
    const s = workspaceSettings?.settings;
    if (!s) return undefined;
    return {
      companyCount: s.defaultCompanyCount,
      scope: s.defaultGeoScope,
      value: s.defaultGeoValue,
      industryMode: s.defaultIndustryMode,
      industryValue: s.defaultIndustryValue,
    };
  }, [workspaceSettings]);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // null = signed out. undefined = still checking the stored token.
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  // What this login is allowed to reach. Comes with the session; the backend
  // enforces it on every route regardless of what the UI shows.
  const [role, setRole] = useState<Role>('sales');

  const handleSignOut = () => {
    clearToken();
    setUsername(null);
    setRole('sales');
    setCurrentView('dashboard');
    setError(null);
    setNotice(null);
    setPipelineData({ companies: [], outreachCampaigns: [], isGenerating: false });
    setDashboard(null);
    setCost(null);
    setSuppression([]);
    setInbox(null);
    setMailboxes([]);
    setBroadcast(null);
    setOutbox(null);
    setTemplates(null);
    setQueue(null);
    setRetouch(null);
    setAgentRoster(null);
    setSendPreview(null);
    setSelectedClients([]);
    setWorkspaceSettings(null);
  };

  useEffect(() => {
    // The backend rejecting our token from anywhere drops us back to login.
    api.registerUnauthorizedHandler(() => setUsername(null));

    if (!getToken()) {
      setUsername(null);
      return;
    }

    // A stored token may have expired while the tab was closed.
    api.me()
      .then((session) => {
        setRole(session.role);
        setUsername(session.username);
        // Land where this browser asked to. Set together with the role, so
        // the admin-only guard below sees the real role, not the default.
        setCurrentView(homeView());
      })
      .catch(() => setUsername(null));
  }, []);

  // Health is public, so it works on the login screen too.
  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  const toggleRail = () => {
    setRailCollapsed((prev) => {
      writePref('rail-collapsed', !prev);
      return !prev;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Everything the workspace shows, pulled fresh from Postgres. */
  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [state, dash, spend, suppressed, box, boxes, tpl, q, rt, ag, preview, blast, sent, prefs] =
        await Promise.all([
        api.getPipeline(),
        api.getDashboard(),
        api.getCost(),
        api.getSuppression(),
        api.getInbox(),
        api.getMailboxes(),
        api.getTemplates(),
        api.getPriorityQueue(),
        api.getRetouch(),
        api.getAgents(),
        api.getCampaignPreview(),
        api.getBroadcast(),
        api.getOutbox(),
        api.getSettings(),
      ]);
      setPipelineData({
        companies: state.companies,
        outreachCampaigns: state.outreachCampaigns,
        isGenerating: false,
      });
      setDashboard(dash);
      setCost(spend);
      setSuppression(suppressed.entries);
      setInbox(box);
      setMailboxes(boxes.mailboxes);
      setRemainingSends(boxes.totalRemainingToday);
      setTemplates(tpl);
      setQueue(q);
      setRetouch(rt);
      setAgentRoster(ag);
      setSendPreview(preview);
      setBroadcast(blast);
      setOutbox(sent);
      setWorkspaceSettings(prefs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (username) void refresh();
  }, [username, refresh]);

  // A sales login is never left on an admin view - not via the palette, and
  // not via a view remembered from an admin's earlier session in this tab.
  useEffect(() => {
    if (role !== 'admin' && ADMIN_VIEWS.has(currentView)) setCurrentView('dashboard');
  }, [role, currentView]);

  /**
   * Just the bulk-outreach screen. A paced send is polled every few seconds
   * while it runs, and pulling all twelve endpoints on that interval would be
   * wasteful for the one that actually changed.
   */
  const refreshBroadcast = useCallback(async () => {
    try {
      setBroadcast(await api.getBroadcast());
    } catch {
      /* a failed poll is not worth an error banner — the next one will do */
    }
  }, []);

  const handleRunPipeline = async (
    icp: string,
    count: number,
    location?: SearchArea,
    industry?: IndustryFilter,
  ) => {
    setPipelineData((prev) => ({ ...prev, isGenerating: true }));
    setError(null);
    setNotice(null);
    setCurrentView('run');

    try {
      const data = await api.runPipeline(icp, count, crmConfig, location, industry);

      setPipelineData({
        companies: data.companies || [],
        outreachCampaigns: data.outreachCampaigns || [],
        isGenerating: false,
      });

      const parts = [
        `${data.newCompanies} accounts discovered${
          data.searchedArea && data.searchedArea !== 'worldwide' ? ` in ${data.searchedArea}` : ''
        }`,
      ];
      if (data.offTarget > 0) {
        parts.push(
          `${data.offTarget} came back from outside ${data.searchedArea} — check their headquarters`,
        );
      }
      if (data.suppressedContacts > 0) {
        parts.push(
          `${data.suppressedContacts} skipped as suppressed (before any outreach was written)`,
        );
      }
      parts.push(`run cost $${data.runCostUsd.toFixed(4)}`);
      setNotice(parts.join(' · '));

      // The run changed spend and freshness, so pull the derived views again.
      void refresh();
      setCurrentView('companies');
    } catch (err: any) {
      console.error(err);
      setError(err.message);
      setPipelineData((prev) => ({ ...prev, isGenerating: false }));
      // A failed run still spent money before it died.
      void refresh();
    }
  };

  const handleUpdateCompany = (companyId: string, updates: Partial<Company>) => {
    setPipelineData((prev) => ({
      ...prev,
      companies: prev.companies.map((c) => (c.id === companyId ? { ...c, ...updates } : c)),
    }));
  };

  const handleEnrichCompany = async (companyId: string) => {
    handleUpdateCompany(companyId, { isEnriching: true });
    setError(null);

    try {
      const data = await api.enrichCompany(companyId);
      handleUpdateCompany(companyId, { ...data.company, isEnriching: false });
      void refresh();
    } catch (err: any) {
      console.error(err);
      setError(err.message);
      handleUpdateCompany(companyId, { isEnriching: false });
    }
  };

  const handleStageChange = async (companyId: string, stage: CrmStage) => {
    const previous = pipelineData.companies.find((c) => c.id === companyId)?.stage;

    // Move the card immediately, then confirm with the server.
    handleUpdateCompany(companyId, { stage });
    setError(null);

    try {
      await api.updateStage(companyId, stage);
    } catch (err: any) {
      console.error(err);
      setError(`Could not save the stage change: ${err.message}`);
      if (previous) handleUpdateCompany(companyId, { stage: previous });
    }
  };

  const handleClearData = async () => {
    setError(null);
    try {
      await api.clearPipeline();
      setPipelineData({ companies: [], outreachCampaigns: [], isGenerating: false });
      void refresh();
    } catch (err: any) {
      console.error(err);
      setError(err.message);
      throw err;
    }
  };

  // --- Settings ---

  const handleSaveSettings = async (patch: Partial<WorkspaceSettingsValues>) => {
    const next = await api.updateSettings(patch);
    setWorkspaceSettings(next);
    setError(null);
    setNotice('Settings saved.');
    // The qualified threshold and refresh policy feed the dashboard, the
    // queue and the retouch centre, so pull the derived views again.
    void refresh();
  };

  const handleResetSettings = async () => {
    const next = await api.resetSettings();
    setWorkspaceSettings(next);
    setError(null);
    setNotice('Settings are back to the .env defaults.');
    void refresh();
  };

  const handleChangePassword = async (currentPassword: string, newPassword: string) => {
    await api.changePassword(currentPassword, newPassword);
    setError(null);
    setNotice('Password changed. It applies from your next sign-in on any other device.');
  };

  // --- Inbox and mailboxes ---

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.syncInbox();
      const parts = [`${result.fetched} new message${result.fetched === 1 ? '' : 's'}`];
      if (result.classified) parts.push(`${result.classified} triaged`);
      if (result.suppressed) {
        parts.push(`${result.suppressed} opt-out${result.suppressed === 1 ? '' : 's'} suppressed automatically`);
      }
      if (result.costUsd) parts.push(`$${result.costUsd.toFixed(4)}`);
      setNotice(parts.join(' · '));
      if (result.errors.length) setError(result.errors.join(' | '));
      void refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleReply = async (threadKey: string, mailboxId: string, body: string) => {
    await api.replyToThread(threadKey, mailboxId, body);
    setNotice('Reply sent.');
    void refresh();
  };

  const handleMarkRead = (threadKey: string) => {
    void api.markThreadRead(threadKey).then(() => refresh());
  };

  const handleConnectMailbox = async (body: Parameters<typeof api.connectMailbox>[0]) => {
    await api.connectMailbox(body);
    setNotice(`Connected ${body.address}. SMTP and IMAP both verified.`);
    void refresh();
  };

  const handleTestMailbox = async (id: string) => {
    try {
      await api.testMailbox(id);
      setNotice('Mailbox verified.');
      setError(null);
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      void refresh();
    }
  };

  const handleUpdateMailbox = async (
    id: string,
    body: { dailyLimit?: number; isActive?: boolean },
  ) => {
    try {
      await api.updateMailbox(id, body);
      void refresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteMailbox = async (id: string) => {
    try {
      await api.deleteMailbox(id);
      setNotice('Mailbox removed. Its stored credential went with it.');
      void refresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSendCampaign = async (
    mailboxId: string,
    companyIds: string[],
  ): Promise<CampaignSendResult[]> => {
    const result = await api.sendCampaign(mailboxId, companyIds);
    const parts = [`${result.sent} sent`];
    if (result.skipped) parts.push(`${result.skipped} skipped`);
    if (result.failed) parts.push(`${result.failed} failed`);
    parts.push(`${result.remainingToday} sends left today`);
    setNotice(parts.join(' · '));
    setSelectedClients([]);
    void refresh();
    return result.results;
  };

  /** Suggestions only — the caller decides, then saves via handleUpdateContact. */
  const handleFindEmail = (companyId: string, contactId: string) =>
    api.findContactEmail(companyId, contactId);

  const handleUpdateContact = async (
    companyId: string,
    contactId: string,
    patch: ContactPatch,
  ) => {
    await api.updateContact(companyId, contactId, patch);
    void refresh();
  };

  const handleCreateTemplate = async (
    body: { name: string; whenToUse: string; subject: string; body: string },
  ) => {
    await api.createTemplate(body);
    void refresh();
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await api.deleteTemplate(id);
      void refresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddSuppression = async (value: string, reason: string) => {
    const entry = await api.addSuppression(value, reason);
    setSuppression((prev) => [entry, ...prev]);
  };

  const handleRemoveSuppression = async (id: string) => {
    await api.removeSuppression(id);
    setSuppression((prev) => prev.filter((e) => e.id !== id));
  };

  if (username === undefined) {
    return (
      <div
        className="min-h-screen flex items-center justify-center text-[13.5px]"
        style={{ background: 'var(--canvas)', color: 'var(--ink-3)' }}
      >
        Loading workspace…
      </div>
    );
  }

  if (username === null) {
    return (
      <LoginView
        onSignedIn={(name, signedInRole) => {
          setRole(signedInRole);
          setUsername(name);
          setCurrentView(homeView());
        }}
      />
    );
  }

  const handleUploadBroadcast = async (file: File) => {
    const result = await api.uploadBroadcastList(file);
    await refreshBroadcast();
    return result;
  };

  const handleStartBroadcast = async (body: {
    mailboxId: string;
    brand: string;
    subject: string;
    body: string;
    count: number;
    delaySeconds: number;
  }) => {
    await api.startBroadcast(body);
    await refreshBroadcast();
  };

  const handleCancelBroadcast = async (jobId: string) => {
    await api.cancelBroadcast(jobId);
    await refreshBroadcast();
  };

  const handleClearBroadcast = async (
    only: 'all' | 'pending' | 'sent',
    sourceFile = '',
  ) => {
    const result = await api.clearBroadcastList(only, sourceFile);
    await refreshBroadcast();
    return result;
  };

  const handleExportBroadcast = (format: ExportFormat, scope: ExportScope) =>
    api.exportBroadcast(format, scope);

  const badges: Record<string, string | number | undefined> = {
    accounts: dashboard?.totalCompanies || undefined,
    retouch: dashboard?.needsRetouch || undefined,
    campaigns: dashboard?.campaigns || undefined,
    suppressed: suppression.length || undefined,
    unread: inbox?.unread || undefined,
    sent: outbox?.total || undefined,
    broadcast: broadcast?.pending || undefined,
    mailboxes: mailboxes.length || undefined,
    templates: templates?.templates.length || undefined,
    queue: queue?.items.length || undefined,
    agents: agentRoster?.agents.length || undefined,
    cost:
      dashboard && dashboard.totalCostUsd > 0
        ? dashboard.totalCostUsd < 0.01
          ? `$${dashboard.totalCostUsd.toFixed(4)}`
          : `$${dashboard.totalCostUsd.toFixed(2)}`
        : undefined,
  };

  const alerts = (dashboard?.needsRetouch ?? 0) + (inbox?.needsResponse ?? 0);

  return (
    <div className="min-h-screen p-3 sm:p-5" style={{ background: 'var(--canvas)' }}>
      <div
        className="flex overflow-hidden mx-auto"
        style={{
          background: 'var(--shell)',
          borderRadius: 24,
          boxShadow: 'var(--shadow-md)',
          maxWidth: 1680,
          height: 'calc(100vh - 40px)',
        }}
      >
        <Sidebar
          currentView={currentView}
          onViewChange={setCurrentView}
          badges={badges}
          collapsed={railCollapsed}
          onToggleCollapse={toggleRail}
          onSignOut={handleSignOut}
          role={role}
        />

      <SendCampaignModal
        open={sendOpen}
        preview={sendPreview}
        mailboxes={mailboxes}
        preselected={selectedClients}
        onClose={() => setSendOpen(false)}
        onSend={handleSendCampaign}
        onNavigate={setCurrentView}
      />

      <CommandPalette
        open={commandOpen}
        role={role}
        onClose={() => setCommandOpen(false)}
        onNavigate={setCurrentView}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          title={VIEW_TITLES[currentView] ?? 'Sales OS'}
          username={username}
          workspaceName={workspaceSettings?.settings.workspaceName}
          claudeReady={health?.claudeConfigured ?? false}
          isBusy={pipelineData.isGenerating}
          alerts={alerts}
          unread={inbox?.unread ?? 0}
          onOpenCommand={() => setCommandOpen(true)}
          onNavigate={setCurrentView}
        />

        <main className="flex-1 overflow-auto px-6 pb-8 pt-5" style={{ background: 'var(--work)' }}>

          {error && (
            <div
              className="mb-6 px-5 py-3.5"
              style={{
                border: '1px solid var(--bad-border)',
                background: 'var(--bad-soft)',
                color: 'var(--bad)',
                borderRadius: 14,
                fontSize: 13.5,
                fontWeight: 550,
              }}
            >
              {error}
            </div>
          )}

          {notice && !error && (
            <div
              className="mb-6 px-5 py-3.5"
              style={{
                border: '1px solid var(--good-border)',
                background: 'var(--good-soft)',
                color: 'var(--good)',
                borderRadius: 14,
                fontSize: 13.5,
                fontWeight: 550,
              }}
            >
              {notice}
            </div>
          )}

          {currentView === 'dashboard' && (
            <DashboardView
              data={dashboard}
              isLoading={isLoading}
              onNavigate={setCurrentView}
              modelLarge={health?.modelLarge}
            />
          )}

          {currentView === 'run' && (
            <RunAgentsView
              defaults={discoveryDefaults}
              onRunPipeline={handleRunPipeline}
              isGenerating={pipelineData.isGenerating}
              modelLarge={health?.modelLarge}
              claudeReady={health?.claudeConfigured ?? false}
            />
          )}

          {currentView === 'crm_board' && (
            <InternalCrmView
              companies={pipelineData.companies}
              onStageChange={handleStageChange}
              onEnrichCompany={handleEnrichCompany}
              isLoading={isLoading}
            />
          )}

          {currentView === 'companies' && (
            <CompaniesView
              companies={pipelineData.companies}
              selected={selectedClients}
              onSelectionChange={setSelectedClients}
              onEnrichCompany={handleEnrichCompany}
              onUpdateContact={handleUpdateContact}
              onFindEmail={handleFindEmail}
              onOpenSend={() => setSendOpen(true)}
              hasCampaign={(id) =>
                pipelineData.outreachCampaigns.some((c) => c.companyId === id)
              }
              getCampaign={(id) =>
                pipelineData.outreachCampaigns.find((c) => c.companyId === id) ?? null
              }
            />
          )}

          {currentView === 'outbox' && (
            <OutboxView
              data={outbox}
              isLoading={isLoading}
              isSyncing={isSyncing}
              onSync={handleSync}
              onNavigate={setCurrentView}
            />
          )}

          {currentView === 'broadcast' && (
            <BroadcastView
              state={broadcast}
              mailboxes={mailboxes
                .filter((m) => m.isActive && m.status === 'connected')
                .map((m) => ({
                  id: m.id,
                  address: m.address,
                  remainingToday: m.remainingToday,
                  status: m.status,
                }))}
              isLoading={isLoading}
              onUpload={handleUploadBroadcast}
              onStart={handleStartBroadcast}
              onCancel={handleCancelBroadcast}
              onClear={handleClearBroadcast}
              onExport={handleExportBroadcast}
              onRefresh={refreshBroadcast}
              defaults={
                workspaceSettings
                  ? {
                      batchSize: workspaceSettings.settings.defaultBatchSize,
                      delaySeconds: workspaceSettings.settings.defaultDelaySeconds,
                    }
                  : undefined
              }
            />
          )}

          {currentView === 'outreach' && (
            <OutreachView
              companies={pipelineData.companies}
              outreachCampaigns={pipelineData.outreachCampaigns}
              preview={sendPreview}
              onSend={(companyId) => {
                setSelectedClients([companyId]);
                setSendOpen(true);
              }}
            />
          )}

          {currentView === 'analytics' && (
            <AnalyticsView
              companies={pipelineData.companies}
              outreachCampaigns={pipelineData.outreachCampaigns}
            />
          )}

          {currentView === 'inbox' && (
            <InboxView
              data={inbox}
              mailboxes={mailboxes}
              isLoading={isLoading}
              isSyncing={isSyncing}
              onSync={handleSync}
              onReply={handleReply}
              onMarkRead={handleMarkRead}
              onNavigate={setCurrentView}
            />
          )}

          {currentView === 'mailboxes' && (
            <MailboxesView
              mailboxes={mailboxes}
              totalRemainingToday={remainingSends}
              isLoading={isLoading}
              onConnect={handleConnectMailbox}
              onTest={handleTestMailbox}
              onUpdate={handleUpdateMailbox}
              onDelete={handleDeleteMailbox}
              defaultDailyLimit={workspaceSettings?.settings.defaultDailyLimit}
            />
          )}

          {currentView === 'templates' && (
            <TemplatesView
              data={templates}
              isLoading={isLoading}
              onCreate={handleCreateTemplate}
              onDelete={handleDeleteTemplate}
            />
          )}

          {currentView === 'queue' && (
            <PriorityQueueView data={queue} isLoading={isLoading} onNavigate={setCurrentView} />
          )}

          {currentView === 'retouch' && (
            <RetouchView data={retouch} isLoading={isLoading} onNavigate={setCurrentView} />
          )}

          {currentView === 'agents' && <AgentsView data={agentRoster} isLoading={isLoading} />}

          {currentView === 'cost' && <CostView data={cost} isLoading={isLoading} />}

          {currentView === 'team' && role === 'admin' && (
            <TeamView currentUsername={username} />
          )}

          {currentView === 'compliance' && (
            <ComplianceView
              entries={suppression}
              isLoading={isLoading}
              onAdd={handleAddSuppression}
              onRemove={handleRemoveSuppression}
            />
          )}

          {currentView === 'crm' && (
            <CrmSettingsView crmConfig={crmConfig} onUpdateConfig={setCrmConfig} />
          )}

          {currentView === 'settings' && (
            <SystemSettingsView
              role={role}
              username={username}
              companyCount={pipelineData.companies.length}
              data={workspaceSettings}
              onSave={handleSaveSettings}
              onReset={handleResetSettings}
              onChangePassword={handleChangePassword}
              onClearData={handleClearData}
            />
          )}

        </main>
        </div>
      </div>
    </div>
  );
}