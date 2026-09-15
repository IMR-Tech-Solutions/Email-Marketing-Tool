import React, { useEffect, useRef, useState } from 'react';
import {
  AtSign,
  Building2,
  Cpu,
  Database,
  Gauge,
  KeyRound,
  Loader2,
  Megaphone,
  MonitorSmartphone,
  PenLine,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  UserRound,
  Wallet,
} from 'lucide-react';
import {
  GeoScope,
  IndustryMode,
  Role,
  WorkspaceSettingsResponse,
  WorkspaceSettingsValues,
} from '../types';
import { canView } from '../lib/roles';
import { readPrefString, writePrefString } from '../lib/auth';

interface SystemSettingsViewProps {
  role: Role;
  username: string;
  companyCount: number;
  /** Null until the workspace has loaded. */
  data: WorkspaceSettingsResponse | null;
  /** Only the fields that changed. Admin only - the backend enforces it. */
  onSave: (patch: Partial<WorkspaceSettingsValues>) => Promise<void>;
  onReset: () => Promise<void>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onClearData: () => Promise<void>;
}

/*
 * One screen, five tabs. The workspace tabs edit a single draft with one
 * save bar, so a threshold changed on Workspace and a signature changed on
 * Sending go in one request and one confirmation. Your account is the one
 * tab a sales login sees.
 */
type Tab = 'workspace' | 'sending' | 'spend' | 'account' | 'data';

const TABS: { key: Tab; label: string; adminOnly: boolean }[] = [
  { key: 'workspace', label: 'Workspace', adminOnly: true },
  { key: 'sending', label: 'Sending', adminOnly: true },
  { key: 'spend', label: 'AI & spend', adminOnly: true },
  { key: 'account', label: 'Your account', adminOnly: false },
  { key: 'data', label: 'Data', adminOnly: true },
];

/** The same four Bulk Outreach offers. */
const BATCH_SIZES = [1, 10, 50, 100];

const SCOPES: { key: GeoScope; label: string; placeholder: string }[] = [
  { key: 'global', label: 'Worldwide', placeholder: '' },
  { key: 'city', label: 'City', placeholder: 'Pune, Mumbai…' },
  { key: 'state', label: 'State or region', placeholder: 'Maharashtra, Karnataka…' },
  { key: 'country', label: 'Country', placeholder: 'India, United Kingdom…' },
];

const SIGNATURE_FIELDS: {
  key: 'signatureTech' | 'signatureMarketResearch';
  label: string;
  hint: string;
}[] = [
  {
    key: 'signatureTech',
    label: 'IMR Tech Solutions',
    hint: 'Briefs about software, automation or internal tools.',
  },
  {
    key: 'signatureMarketResearch',
    label: 'Introspective Market Research',
    hint: 'Briefs about market sizing, due diligence or primary research.',
  },
];

/** Where a sign-in can land. Narrowed by role at render time. */
const HOME_CHOICES: { id: string; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'queue', label: 'Priority Queue' },
  { id: 'companies', label: 'Clients' },
  { id: 'crm_board', label: 'Deal Board' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'outbox', label: 'Outbox' },
  { id: 'run', label: 'Discover' },
  { id: 'broadcast', label: 'Bulk Outreach' },
];

const HOME_PREF = 'home-view';

function usd(amount: number): string {
  if (!amount) return '$0.00';
  return amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
}

function when(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

/** Why the draft cannot be saved as it stands, if it cannot. */
function validate(d: WorkspaceSettingsValues): string | null {
  if (!d.workspaceName.trim()) return 'Give the workspace a name.';
  if (d.defaultGeoScope !== 'global' && !d.defaultGeoValue.trim()) {
    const what = d.defaultGeoScope === 'state' ? 'state or region' : d.defaultGeoScope;
    return `Name the default ${what}, or set the area to Worldwide.`;
  }
  if (d.defaultIndustryMode !== 'all' && !d.defaultIndustryValue.trim()) {
    return 'Name the default sector, or set it to All industries.';
  }
  const ordered =
    d.refreshDaysHighIcpActive <= d.refreshDaysHighIcpDormant &&
    d.refreshDaysHighIcpDormant <= d.refreshDaysMidIcp;
  if (!ordered) {
    return 'Refresh intervals must get longer as the dependency weakens: in a campaign ≤ dormant ≤ mid ICP.';
  }
  return null;
}

// --- Small pieces ------------------------------------------------------------

function Card({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: React.ElementType;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="card-head">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
          <div className="card-title">{title}</div>
        </div>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
      {children}
    </p>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[12.5px] font-medium mb-1.5">{label}</div>
      {children}
      {hint && (
        <div className="text-[12px] mt-1.5 leading-relaxed" style={{ color: 'var(--ink-4)' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/** A read-only fact from .env. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 py-2.5"
      style={{ borderTop: '1px solid var(--border)' }}
    >
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[12px]" style={{ color: 'var(--ink-4)' }}>
          {hint}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * A number box that commits a clamped value when you leave it, so typing
 * "15" into a field with a minimum of 5 does not snap to 5 on the "1".
 */
function NumberInput({
  value,
  min,
  max,
  onCommit,
  label,
  suffix,
  width = 110,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (next: number) => void;
  label: string;
  suffix?: string;
  width?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const parsed = Math.round(Number(text));
    const next = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value;
    setText(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={min}
        max={max}
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="field"
        style={{ width }}
      />
      {suffix && (
        <span className="text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="rounded-full transition-colors shrink-0"
      style={{
        width: 42,
        height: 24,
        padding: 3,
        background: on ? 'var(--brand)' : 'var(--border-strong)',
      }}
    >
      <span
        className="block rounded-full bg-white transition-transform"
        style={{ width: 18, height: 18, transform: on ? 'translateX(18px)' : 'none' }}
      />
    </button>
  );
}

// --- The screen ----------------------------------------------------------------

export function SystemSettingsView({
  role,
  username,
  companyCount,
  data,
  onSave,
  onReset,
  onChangePassword,
  onClearData,
}: SystemSettingsViewProps) {
  const isAdmin = role === 'admin';
  const tabs = TABS.filter((t) => isAdmin || !t.adminOnly);
  const [tab, setTab] = useState<Tab>(isAdmin ? 'workspace' : 'account');

  // The draft starts from what the server has. A background refresh brings
  // new server values, which replace the draft only while nothing is edited -
  // never over a change in progress.
  const [draft, setDraft] = useState<WorkspaceSettingsValues | null>(null);
  const savedRef = useRef('');
  const savedKey = data ? JSON.stringify(data.settings) : '';
  useEffect(() => {
    if (!data) return;
    setDraft((current) =>
      current === null || JSON.stringify(current) === savedRef.current ? data.settings : current,
    );
    savedRef.current = savedKey;
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = draft !== null && JSON.stringify(draft) !== savedKey;
  const problem = draft ? validate(draft) : null;
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!savedNotice) return;
    const timer = window.setTimeout(() => setSavedNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [savedNotice]);

  const set = <K extends keyof WorkspaceSettingsValues>(
    key: K,
    value: WorkspaceSettingsValues[K],
  ) => {
    setSavedNotice(null);
    setFormError(null);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const save = async () => {
    if (!draft || !data || problem || saving) return;
    const patch: Partial<WorkspaceSettingsValues> = {};
    (Object.keys(draft) as (keyof WorkspaceSettingsValues)[]).forEach((key) => {
      if (draft[key] !== data.settings[key]) Object.assign(patch, { [key]: draft[key] });
    });
    setSaving(true);
    setFormError(null);
    try {
      await onSave(patch);
      setSavedNotice('Saved.');
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (data) setDraft(data.settings);
    setFormError(null);
  };

  // Change password.
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');
  const [pwRepeat, setPwRepeat] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const pwReady = pwCurrent.length > 0 && pwNext.length >= 8 && pwNext === pwRepeat;

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwReady || pwBusy) return;
    setPwBusy(true);
    setPwMessage(null);
    try {
      await onChangePassword(pwCurrent, pwNext);
      setPwCurrent('');
      setPwNext('');
      setPwRepeat('');
      setPwMessage({ ok: true, text: 'Password changed.' });
    } catch (err: any) {
      setPwMessage({ ok: false, text: err.message });
    } finally {
      setPwBusy(false);
    }
  };

  // This browser.
  const [home, setHome] = useState(() => readPrefString(HOME_PREF, 'dashboard'));

  // Destructive actions, each with its own in-place confirmation.
  const [clearConfirming, setClearConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleClear = async () => {
    setClearing(true);
    try {
      await onClearData();
      setClearConfirming(false);
    } catch {
      // Surfaced by App; keep the confirmation open.
    } finally {
      setClearing(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setFormError(null);
    try {
      await onReset();
      setResetConfirming(false);
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setResetting(false);
    }
  };

  const spent = data?.spentThisMonthUsd ?? 0;
  const cap = draft?.monthlyBudgetUsd ?? 0;
  const budgetPct = cap > 0 ? (spent / cap) * 100 : 0;
  const budgetTone =
    budgetPct >= 100 ? 'var(--bad)' : budgetPct >= 70 ? 'var(--warn)' : 'var(--good)';

  const subtitle = isAdmin
    ? 'Workspace defaults, sending, spend and your account'
    : 'Your account';

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 880 }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">{subtitle}</p>
        </div>
        {tabs.length > 1 && (
          <div className="seg" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className="seg-btn"
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isAdmin && tab !== 'account' && !draft && (
        <div className="card p-10 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
          Loading settings…
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === 'workspace' && draft && data && (
        <>
          <Card icon={Building2} title="Workspace">
            <Field label="Workspace name" hint="Shown under your name in the top bar.">
              <input
                type="text"
                value={draft.workspaceName}
                maxLength={80}
                aria-label="Workspace name"
                onChange={(e) => set('workspaceName', e.target.value)}
                className="field"
                style={{ maxWidth: 360 }}
              />
            </Field>
          </Card>

          <Card icon={Sparkles} title="Discovery defaults">
            <Note>
              What the Discover wizard opens with. Every run can still change them before any
              money is spent.
            </Note>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Companies per run"
                hint="1 to 10. Roughly twice as many are researched, and only those with a published address are kept."
              >
                <NumberInput
                  value={draft.defaultCompanyCount}
                  min={1}
                  max={10}
                  label="Companies per run"
                  onCommit={(n) => set('defaultCompanyCount', n)}
                />
              </Field>

              <Field
                label="Search area"
                hint="A hard filter, not a preference. Accounts from outside it are counted and reported after the run."
              >
                <div className="flex gap-2">
                  <select
                    value={draft.defaultGeoScope}
                    aria-label="Area type"
                    onChange={(e) => set('defaultGeoScope', e.target.value as GeoScope)}
                    className="field"
                    style={{ width: 'auto', flex: '0 0 auto' }}
                  >
                    {SCOPES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {draft.defaultGeoScope !== 'global' && (
                    <input
                      type="text"
                      value={draft.defaultGeoValue}
                      maxLength={120}
                      aria-label="Area"
                      placeholder={SCOPES.find((s) => s.key === draft.defaultGeoScope)?.placeholder}
                      onChange={(e) => set('defaultGeoValue', e.target.value)}
                      className="field"
                    />
                  )}
                </div>
              </Field>

              <Field
                label="Industry"
                hint="Free text. No fixed taxonomy survives contact with a real ICP."
              >
                <div className="flex gap-2">
                  <select
                    value={draft.defaultIndustryMode === 'all' ? 'all' : 'custom'}
                    aria-label="Industry mode"
                    onChange={(e) => set('defaultIndustryMode', e.target.value as IndustryMode)}
                    className="field"
                    style={{ width: 'auto', flex: '0 0 auto' }}
                  >
                    <option value="all">All industries</option>
                    <option value="custom">A specific sector</option>
                  </select>
                  {draft.defaultIndustryMode !== 'all' && (
                    <input
                      type="text"
                      value={draft.defaultIndustryValue}
                      maxLength={120}
                      aria-label="Sector"
                      placeholder="Manufacturing, FMCG, Healthcare…"
                      onChange={(e) => set('defaultIndustryValue', e.target.value)}
                      className="field"
                    />
                  )}
                </div>
              </Field>
            </div>
          </Card>

          <Card icon={Gauge} title="Qualification & refresh">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Qualified ICP score"
                hint="At or above this an account counts as qualified: on the dashboard, in the priority queue, and in cost per qualified account."
              >
                <NumberInput
                  value={draft.highIcpThreshold}
                  min={1}
                  max={100}
                  label="Qualified ICP score"
                  suffix="of 100"
                  onCommit={(n) => set('highIcpThreshold', n)}
                />
              </Field>
            </div>

            <div className="mt-5">
              <div className="eyebrow mb-2">Refresh policy</div>
              <Note>
                A record is re-verified when its freshness has decayed <em>and</em> something
                depends on it. Refreshing everything on a calendar is the expensive way to be
                wrong.
              </Note>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="High ICP, in a campaign">
                  <NumberInput
                    value={draft.refreshDaysHighIcpActive}
                    min={1}
                    max={3650}
                    label="High ICP in a campaign, days"
                    suffix="days"
                    onCommit={(n) => set('refreshDaysHighIcpActive', n)}
                  />
                </Field>
                <Field label="High ICP, dormant">
                  <NumberInput
                    value={draft.refreshDaysHighIcpDormant}
                    min={1}
                    max={3650}
                    label="High ICP dormant, days"
                    suffix="days"
                    onCommit={(n) => set('refreshDaysHighIcpDormant', n)}
                  />
                </Field>
                <Field label="Mid ICP">
                  <NumberInput
                    value={draft.refreshDaysMidIcp}
                    min={1}
                    max={3650}
                    label="Mid ICP, days"
                    suffix="days"
                    onCommit={(n) => set('refreshDaysMidIcp', n)}
                  />
                </Field>
              </div>
              <div className="text-[12px] mt-3 leading-relaxed" style={{ color: 'var(--ink-4)' }}>
                Mid ICP means half the qualified score or more. Low ICP that never engaged is
                refreshed on demand only.
              </div>
            </div>
          </Card>
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === 'sending' && draft && data && (
        <>
          <Card icon={Megaphone} title="Bulk outreach defaults">
            <Note>
              What the Send step opens with. The gap is deliverability, not politeness: a burst
              of near-identical mail from one address is the fastest route into a spam folder.
            </Note>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Batch size">
                <div className="flex gap-1.5">
                  {BATCH_SIZES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => set('defaultBatchSize', n)}
                      className={draft.defaultBatchSize === n ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                      style={{ minWidth: 42, padding: '0 10px' }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Gap between sends">
                <NumberInput
                  value={draft.defaultDelaySeconds}
                  min={5}
                  max={300}
                  label="Gap between sends, seconds"
                  suffix="seconds"
                  onCommit={(n) => set('defaultDelaySeconds', n)}
                />
              </Field>
              <Field
                label="Daily limit for new mailboxes"
                hint="Mailboxes already connected keep their own limit. Change those on Mailboxes."
              >
                <NumberInput
                  value={draft.defaultDailyLimit}
                  min={1}
                  max={500}
                  label="Daily limit for new mailboxes"
                  suffix="a day"
                  onCommit={(n) => set('defaultDailyLimit', n)}
                />
              </Field>
            </div>
          </Card>

          <Card
            icon={AtSign}
            title="Guessed addresses"
            aside={
              <div className="flex items-center gap-2.5">
                <span className="text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                  {draft.allowGuessedEmails ? 'On' : 'Off'}
                </span>
                <Toggle
                  on={draft.allowGuessedEmails}
                  label="Allow guessed email addresses"
                  onChange={(next) => set('allowGuessedEmails', next)}
                />
              </div>
            }
          >
            <Note>
              Off, an account whose company publishes no address arrives with an empty email
              until somebody finds one. On, it is given the most likely pattern guess instead,
              such as first.last@domain, so every client arrives sendable.
            </Note>
            <div
              className="mt-3 px-3.5 py-3 text-[12.5px] leading-relaxed"
              style={{
                background: 'var(--warn-soft)',
                border: '1px solid var(--warn-border)',
                borderRadius: 12,
                color: 'var(--warn)',
              }}
            >
              A guessed address that does not exist is a hard bounce, and hard bounces are the
              strongest spam signal there is. Enough of them and the sending domain stops
              reaching anyone, including the prospects you got right. Reasonable for a small
              send you are watching. A bad idea at volume.
            </div>
          </Card>

          <Card icon={PenLine} title="Email signatures">
            <Note>
              Put on at send time, never at drafting time, so a stored draft cannot go stale.
              A drafted campaign email gets the block for the business its brief belongs to.
              Every Bulk Outreach template ends with the same block, followed by the opt-out
              line.
            </Note>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {SIGNATURE_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  <textarea
                    value={draft[f.key]}
                    rows={7}
                    maxLength={2000}
                    aria-label={`${f.label} signature`}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="field"
                    style={{ fontSize: 12.5, resize: 'vertical', lineHeight: 1.5 }}
                  />
                  <button
                    type="button"
                    onClick={() => set(f.key, data.envDefaults[f.key])}
                    disabled={draft[f.key] === data.envDefaults[f.key]}
                    className="btn btn-ghost btn-sm mt-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                    Restore default
                  </button>
                </Field>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === 'spend' && draft && data && (
        <>
          <Card
            icon={Cpu}
            title="Models & keys"
            aside={<span className="pill mono">Backend/.env</span>}
          >
            <Note>
              Read from Backend/.env at startup, so they are reported here rather than edited.
              Change the file and restart the backend.
            </Note>
            <div className="mt-3">
              <Row label="Large model" hint="Discovery, research and personalization">
                <span className="pill pill-brand mono">{data.modelLarge}</span>
              </Row>
              <Row label="Small model" hint="Enrichment and reply triage">
                <span className="pill mono">{data.modelSmall}</span>
              </Row>
              <Row label="Claude API key" hint="ANTHROPIC_API_KEY">
                {data.claudeConfigured ? (
                  <span className="pill pill-good">Configured</span>
                ) : (
                  <span className="pill pill-bad">Missing</span>
                )}
              </Row>
              <Row label="Hunter lookup" hint="HUNTER_API_KEY, optional. Raises the hit rate of Find email.">
                {data.hunterConfigured ? (
                  <span className="pill pill-good">Configured</span>
                ) : (
                  <span className="pill">Not set, pattern guesses only</span>
                )}
              </Row>
              <Row label="Session length" hint="SESSION_HOURS">
                <span className="pill mono">{data.sessionHours} h</span>
              </Row>
            </div>
          </Card>

          <Card
            icon={Wallet}
            title="Monthly AI budget"
            aside={<span className="pill mono">{usd(spent)} this month</span>}
          >
            <Note>
              Measured from the real token usage of every call, never estimated. Once the
              month&apos;s spend reaches the cap, Discover and Enrich refuse to run until it is
              raised here or the month rolls over. Reply triage keeps running: losing a reply
              costs more than a fraction of a cent.
            </Note>
            <div className="mt-4">
              <Field label="Cap" hint="Whole dollars. 0 means no cap.">
                <NumberInput
                  value={draft.monthlyBudgetUsd}
                  min={0}
                  max={1000000}
                  label="Monthly cap in USD"
                  suffix="USD per calendar month"
                  width={130}
                  onCommit={(n) => set('monthlyBudgetUsd', n)}
                />
              </Field>
            </div>
            {cap > 0 && (
              <div className="mt-4">
                <div className="flex justify-between text-[12.5px]">
                  <span style={{ color: 'var(--ink-2)' }}>{usd(spent)} spent</span>
                  <span className="font-medium" style={{ color: budgetTone }}>
                    {Math.round(budgetPct)}% of {usd(cap)}
                  </span>
                </div>
                <div
                  className="mt-1.5"
                  style={{ height: 8, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, budgetPct)}%`,
                      height: '100%',
                      background: budgetTone,
                      transition: 'width 0.2s ease',
                    }}
                  />
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === 'account' && (
        <>
          <Card icon={UserRound} title="Signed in as">
            <div className="flex items-center gap-3">
              <div
                className="grid place-items-center rounded-full text-white shrink-0"
                style={{
                  width: 40,
                  height: 40,
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                  fontSize: 13,
                  fontWeight: 650,
                }}
              >
                {username.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="text-[14px] font-semibold">{username}</div>
                <div className="text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                  {isAdmin ? 'Admin' : 'Sales Executive'}
                  {data ? ` · a session lasts ${data.sessionHours} hours` : ''}
                </div>
              </div>
            </div>
          </Card>

          <Card icon={KeyRound} title="Change password">
            <form onSubmit={submitPassword}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="password"
                  value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)}
                  placeholder="Current password"
                  autoComplete="current-password"
                  aria-label="Current password"
                  disabled={pwBusy}
                  className="field"
                />
                <input
                  type="password"
                  value={pwNext}
                  onChange={(e) => setPwNext(e.target.value)}
                  placeholder="New password (8+ characters)"
                  autoComplete="new-password"
                  aria-label="New password"
                  disabled={pwBusy}
                  className="field"
                />
                <input
                  type="password"
                  value={pwRepeat}
                  onChange={(e) => setPwRepeat(e.target.value)}
                  placeholder="Repeat new password"
                  autoComplete="new-password"
                  aria-label="Repeat new password"
                  disabled={pwBusy}
                  className="field"
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="submit" disabled={!pwReady || pwBusy} className="btn btn-primary">
                  {pwBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <KeyRound className="w-4 h-4" strokeWidth={2} />
                  )}
                  Update password
                </button>
                {pwNext.length > 0 && pwRepeat.length > 0 && pwNext !== pwRepeat && (
                  <span className="text-[12.5px]" style={{ color: 'var(--warn)' }}>
                    The two new passwords differ.
                  </span>
                )}
                {pwMessage && (
                  <span
                    className="text-[12.5px]"
                    style={{ color: pwMessage.ok ? 'var(--good)' : 'var(--bad)' }}
                  >
                    {pwMessage.text}
                  </span>
                )}
              </div>
            </form>
            <div className="mt-4 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
              {isAdmin
                ? 'Passwords are stored bcrypt-hashed. Sessions are signed JWTs, re-checked against the database on every request, so disabling an account takes effect immediately rather than when its token expires. Other logins are managed from Team, or from the terminal:'
                : 'Locked out? An admin can set a new password for you from Team.'}
            </div>
            {isAdmin && (
              <div
                className="mt-2.5 rounded-[10px] px-3.5 py-2.5 mono text-[12px]"
                style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}
              >
                python scripts/manage_user.py set &lt;username&gt; &lt;password&gt;
              </div>
            )}
          </Card>

          <Card icon={MonitorSmartphone} title="This browser">
            <Field label="Open on sign-in" hint="Remembered on this device only, not on the account.">
              <select
                value={home}
                aria-label="Screen to open on sign-in"
                onChange={(e) => {
                  setHome(e.target.value);
                  writePrefString(HOME_PREF, e.target.value);
                }}
                className="field"
                style={{ maxWidth: 260 }}
              >
                {HOME_CHOICES.filter((c) => canView(role, c.id)).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </Card>
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === 'data' && isAdmin && (
        <>
          <Card
            icon={Database}
            title="Stored data"
            aside={<span className="pill mono">{companyCount} accounts</span>}
          >
            <Note>
              Accounts, contacts and campaigns live in PostgreSQL and survive restarts. Clearing
              removes every saved account and everything attached to it. Logins, these settings,
              the cost ledger and the suppression list are not touched. A do-not-contact entry
              that a button could clear is not a do-not-contact list.
            </Note>
            <div className="mt-4">
              {clearConfirming ? (
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setClearConfirming(false)} disabled={clearing} className="btn">
                    Cancel
                  </button>
                  <button onClick={handleClear} disabled={clearing} className="btn btn-danger">
                    {clearing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" strokeWidth={2} />
                    )}
                    Yes, delete every account
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setClearConfirming(true)}
                  disabled={companyCount === 0}
                  className="btn"
                  style={{ color: companyCount === 0 ? undefined : 'var(--bad)' }}
                >
                  <Trash2 className="w-4 h-4" strokeWidth={2} />
                  Clear generated data
                </button>
              )}
            </div>
          </Card>

          <Card
            icon={RotateCcw}
            title="These settings"
            aside={
              data?.updatedAt ? (
                <span className="text-[12px]" style={{ color: 'var(--ink-4)' }}>
                  last changed {when(data.updatedAt)}
                </span>
              ) : undefined
            }
          >
            <Note>
              Everything on the Workspace, Sending and AI &amp; spend tabs is stored in
              PostgreSQL. Backend/.env seeded it the first time and is not read again for these
              values. Reset puts every one of them back to what .env says now, or to the
              built-in defaults where .env is silent.
            </Note>
            <div className="mt-4">
              {resetConfirming ? (
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setResetConfirming(false)} disabled={resetting} className="btn">
                    Cancel
                  </button>
                  <button onClick={handleReset} disabled={resetting} className="btn btn-danger">
                    {resetting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RotateCcw className="w-4 h-4" strokeWidth={2} />
                    )}
                    Yes, reset every setting
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setResetConfirming(true)}
                  disabled={!data}
                  className="btn"
                  style={{ color: data ? 'var(--bad)' : undefined }}
                >
                  <RotateCcw className="w-4 h-4" strokeWidth={2} />
                  Reset to .env defaults
                </button>
              )}
              {formError && (
                <div className="mt-2.5 text-[12.5px]" style={{ color: 'var(--bad)' }}>
                  {formError}
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {/* The one save bar for the three workspace tabs. */}
      {isAdmin && draft && tab !== 'account' && tab !== 'data' && (dirty || formError || savedNotice) && (
        <div
          className="flex flex-wrap items-center gap-3 px-5 py-3.5"
          style={{
            position: 'sticky',
            bottom: 8,
            borderRadius: 16,
            background: dirty ? 'var(--brand-soft)' : 'var(--good-soft)',
            border: `1px solid ${dirty ? 'var(--brand-border)' : 'var(--good-border)'}`,
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div
            className="flex-1 text-[13px] font-medium"
            style={{ color: formError || problem ? 'var(--bad)' : dirty ? 'var(--ink)' : 'var(--good)' }}
          >
            {formError ?? problem ?? (dirty ? 'Unsaved changes' : savedNotice)}
          </div>
          {dirty && (
            <>
              <button onClick={discard} disabled={saving} className="btn btn-sm">
                <Undo2 className="w-3.5 h-3.5" strokeWidth={2} />
                Discard
              </button>
              <button onClick={save} disabled={saving || !!problem} className="btn btn-primary btn-sm">
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" strokeWidth={2} />
                )}
                Save changes
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
