import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brand,
  BroadcastState,
  MessageTemplate,
  ClearResult,
  ExportFormat,
  ExportScope,
  Recipient,
  UploadResult,
} from '../types';
import {
  Upload,
  Download,
  Trash2,
  Send,
  Loader2,
  Square,
  Clock,
  AlertTriangle,
  Check,
  Search,
  Mail,
  X,
  FileSpreadsheet,
  ChevronDown,
} from 'lucide-react';

interface BroadcastViewProps {
  state: BroadcastState | null;
  mailboxes: { id: string; address: string; remainingToday: number; status: string }[];
  isLoading: boolean;
  onUpload: (file: File) => Promise<UploadResult>;
  onStart: (body: {
    mailboxId: string;
    brand: string;
    subject: string;
    body: string;
    count: number;
    delaySeconds: number;
  }) => Promise<void>;
  onCancel: (jobId: string) => Promise<void>;
  onClear: (only: 'all' | 'pending' | 'sent', sourceFile?: string) => Promise<ClearResult>;
  onExport: (format: ExportFormat, scope: ExportScope) => Promise<string>;
  onRefresh: () => void;
}

/**
 * Upload, compose and send used to sit in one column as a single long form.
 * Three steps, one at a time, is the same work with a fifth of the noise.
 */
type Step = 'list' | 'message' | 'send';

const STEPS: { key: Step; label: string }[] = [
  { key: 'list', label: '1 · List' },
  { key: 'message', label: '2 · Message' },
  { key: 'send', label: '3 · Send' },
];

const BATCH_SIZES = [1, 10, 50, 100];

const EXPORT_FORMATS: { key: ExportFormat; label: string }[] = [
  { key: 'xlsx', label: 'Excel (.xlsx)' },
  { key: 'docx', label: 'Word (.docx)' },
  { key: 'pdf', label: 'PDF' },
  { key: 'csv', label: 'CSV' },
];

const STATUS_PILL: Record<Recipient['status'], string> = {
  pending: 'pill',
  sent: 'pill pill-good',
  skipped: 'pill pill-warn',
  failed: 'pill pill-bad',
};

const REPLY_PILL: Record<string, string> = {
  positive: 'pill pill-good',
  referral: 'pill pill-good',
  neutral: 'pill',
  not_interested: 'pill pill-warn',
  unsubscribe: 'pill pill-bad',
  auto_reply: 'pill',
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (mins < 60) return rest ? `${mins}m ${rest}s` : `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <span className="figure">{value}</span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

export function BroadcastView({
  state,
  mailboxes,
  isLoading,
  onUpload,
  onStart,
  onCancel,
  onClear,
  onExport,
  onRefresh,
}: BroadcastViewProps) {
  const [step, setStep] = useState<Step>('list');
  const [brandKey, setBrandKey] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [count, setCount] = useState(10);
  const [delay, setDelay] = useState(15);
  const [mailboxId, setMailboxId] = useState('');
  const [tab, setTab] = useState<'list' | 'replies'>('list');
  const [query, setQuery] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const confirmTimer = useRef<number | undefined>(undefined);

  const brands = state?.brands ?? [];
  const activeJob = state?.jobs.find((j) => j.id === state.activeJobId) ?? null;
  const lastJob = state?.jobs[0] ?? null;
  const recipients = state?.recipients ?? [];

  useEffect(() => {
    if (!brandKey && brands.length > 0 && brands[0].templates.length > 0) {
      const first = brands[0].templates[0];
      setBrandKey(brands[0].key);
      setTemplateKey(first.key);
      setSubject(first.subject);
      setBody(first.body);
    }
  }, [brands, brandKey]);

  useEffect(() => {
    if (!mailboxId && mailboxes.length > 0) setMailboxId(mailboxes[0].id);
  }, [mailboxes, mailboxId]);

  // While a send works through the list, keep the screen honest.
  useEffect(() => {
    if (!activeJob) return;
    const timer = window.setInterval(onRefresh, 3000);
    return () => window.clearInterval(timer);
  }, [activeJob, onRefresh]);

  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);

  /** Arms a delete for a few seconds, then disarms itself. */
  const arm = (key: string) => {
    window.clearTimeout(confirmTimer.current);
    setConfirming(key);
    confirmTimer.current = window.setTimeout(() => setConfirming(null), 5000);
  };
  const disarm = () => {
    window.clearTimeout(confirmTimer.current);
    setConfirming(null);
  };

  const run = async (fn: () => Promise<unknown>, key: string, done?: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const removeRows = (key: string, sourceFile: string, label: string) => {
    disarm();
    return run(async () => {
      const result = await onClear('all', sourceFile);
      setNotice(`Removed ${result.removed} ${label}. ${result.remaining} still on the list.`);
    }, key);
  };

  const handleFile = (file: File) =>
    run(async () => {
      const r = await onUpload(file);
      const parts = [`${r.added} mailable from ${r.fileName}`];
      if (r.sharedAddress)
        parts.push(`${r.sharedAddress} kept but not mailable — they share an address`);
      if (r.alreadyOnList) parts.push(`${r.alreadyOnList} already on the list`);
      if (r.invalid) parts.push(`${r.invalid} without a valid address`);
      if (r.suppressed) parts.push(`${r.suppressed} on the do-not-contact list`);
      if (r.truncated) parts.push('file truncated at 5,000 rows');
      setNotice(parts.join(' · '));
    }, 'upload');

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      recipients.filter(
        (r) =>
          !q ||
          r.email.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.company.toLowerCase().includes(q),
      ),
    [recipients, q],
  );

  const pending = state?.pending ?? 0;
  const remaining = state?.remainingToday ?? 0;
  const eligible = state?.eligible ?? 0;
  const willSend = Math.min(count, eligible, remaining || count);
  const eta = willSend > 1 ? (willSend - 1) * delay : 0;

  const byId = useMemo(() => new Map(recipients.map((r) => [r.id, r])), [recipients]);
  const upNext = (state?.nextUp ?? [])
    .slice(0, willSend)
    .map((id) => byId.get(id))
    .filter((r): r is Recipient => Boolean(r));

  const noMailbox = mailboxes.length === 0;
  const brand = brands.find((b) => b.key === brandKey);

  /** Switching brand lands on that brand's first angle. */
  const chooseBrand = (b: Brand) => {
    setBrandKey(b.key);
    const first = b.templates[0];
    if (first) chooseTemplate(first);
  };

  const chooseTemplate = (t: MessageTemplate) => {
    setTemplateKey(t.key);
    setSubject(t.subject);
    setBody(t.body);
  };

  // Edited copy should not be silently replaced, so the picker highlights
  // only while the fields still match the template it came from.
  const activeTemplate = brand?.templates.find((t) => t.key === templateKey) ?? null;
  const edited = Boolean(
    activeTemplate && (subject !== activeTemplate.subject || body !== activeTemplate.body),
  );

  const startSend = () =>
    run(
      () => onStart({ mailboxId, brand: brandKey, subject, body, count, delaySeconds: delay }),
      'send',
      `Sending started — ${willSend} message${willSend === 1 ? '' : 's'}, ${delay}s apart.`,
    );

  const exportAs = (format: ExportFormat, scope: ExportScope) => {
    setExportOpen(false);
    return run(async () => {
      setNotice(`Downloaded ${await onExport(format, scope)}`);
    }, `export-${format}-${scope}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Bulk Outreach</h1>
          <p className="page-sub">Upload a list, send it paced, watch the replies land.</p>
        </div>

        <div className="relative">
          <button onClick={() => setExportOpen((v) => !v)} className="btn btn-sm">
            <Download className="w-3.5 h-3.5" strokeWidth={2.4} />
            Export
            <ChevronDown className="w-3.5 h-3.5" strokeWidth={2.4} />
          </button>

          {exportOpen && (
            <>
              <div className="fixed inset-0" style={{ zIndex: 30 }} onClick={() => setExportOpen(false)} />
              <div className="pop" style={{ right: 0, top: 40 }}>
                <div className="eyebrow px-2.5 pt-1.5 pb-1">
                  {tab === 'replies' ? 'Replies' : 'Outreach list'}
                </div>
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.key}
                    className="pop-item"
                    onClick={() => exportAs(f.key, tab === 'replies' ? 'replies' : 'recipients')}
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
                    {f.label}
                  </button>
                ))}
                <div
                  className="eyebrow px-2.5 pt-2.5 pb-1 mt-1.5"
                  style={{ borderTop: '1px solid var(--border)' }}
                >
                  Pipeline
                </div>
                <button className="pop-item" onClick={() => exportAs('xlsx', 'clients')}>
                  <Download className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
                  Clients + contacts
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card stat-strip">
        <Stat value={recipients.length} label="On the list" />
        <Stat value={eligible} label="Mailable" />
        <Stat value={pending} label="Never contacted" />
        <Stat value={state?.replies.length ?? 0} label="Replied" />
        <Stat value={remaining} label="Sends left today" />
        <Stat value={state?.currentRound ?? 1} label="Round" />
      </div>

      {notice && (
        <div
          className="card px-4 py-3"
          style={{ background: 'var(--green-soft)', borderColor: 'var(--green-border)', fontSize: 13 }}
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          className="card px-4 py-3 flex items-start gap-2.5"
          style={{ background: 'var(--bad-soft)', borderColor: 'var(--bad-border)', fontSize: 13 }}
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2.2} style={{ color: 'var(--bad)' }} />
          <span>{error}</span>
        </div>
      )}

      {activeJob && (
        <div className="card p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--green)' }} />
              <span style={{ fontSize: 14, fontWeight: 550 }}>
                Sending {activeJob.total} as{' '}
                {brands.find((b) => b.key === activeJob.brand)?.name ?? activeJob.brand}
              </span>
              <span className="pill">{activeJob.delaySeconds}s apart</span>
            </div>
            <button
              onClick={() => run(() => onCancel(activeJob.id), 'cancel')}
              disabled={busy === 'cancel' || activeJob.status === 'cancelling'}
              className="btn btn-sm btn-danger"
            >
              <Square className="w-3.5 h-3.5" strokeWidth={2.4} />
              {activeJob.status === 'cancelling' ? 'Stopping…' : 'Stop'}
            </button>
          </div>

          <div
            className="w-full overflow-hidden"
            style={{ height: 8, borderRadius: 999, background: 'var(--surface-3)' }}
          >
            <div
              style={{
                width: `${Math.round(
                  ((activeJob.sent + activeJob.skipped + activeJob.failed) /
                    Math.max(1, activeJob.total)) * 100,
                )}%`,
                height: '100%',
                background: 'var(--green)',
                transition: 'width .4s ease',
              }}
            />
          </div>

          <div className="flex items-center gap-4 mt-3" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            <span>{activeJob.sent} sent</span>
            <span>{activeJob.skipped} skipped</span>
            <span>{activeJob.failed} failed</span>
            <span className="flex items-center gap-1.5 ml-auto">
              <Clock className="w-3.5 h-3.5" strokeWidth={2.2} />
              about{' '}
              {formatDuration(
                Math.max(
                  0,
                  activeJob.total - (activeJob.sent + activeJob.skipped + activeJob.failed),
                ) * activeJob.delaySeconds,
              )}{' '}
              left
            </span>
          </div>
        </div>
      )}

      {!activeJob && lastJob && lastJob.status !== 'done' && (
        <div
          className="card px-4 py-3 flex items-start gap-2.5"
          style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn-border)', fontSize: 13 }}
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2.2} style={{ color: 'var(--warn)' }} />
          <span>
            Last run {lastJob.status}: {lastJob.sent} sent, {lastJob.skipped} skipped,{' '}
            {lastJob.failed} failed. {lastJob.detail}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-5 items-start">

        {/* The three steps */}
        <div className="card overflow-hidden">
          <div className="card-head">
            <div className="seg" role="tablist">
              {STEPS.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={step === s.key}
                  onClick={() => setStep(s.key)}
                  className="seg-btn"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* 1 — the list */}
          {step === 'list' && (
            <div className="p-5 flex flex-col gap-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFile(file);
                }}
                onClick={() => fileInput.current?.click()}
                className="grid place-items-center text-center cursor-pointer"
                style={{
                  padding: '30px 20px',
                  borderRadius: 16,
                  border: `1.5px dashed ${dragging ? 'var(--green)' : 'var(--border-strong)'}`,
                  background: dragging ? 'var(--green-soft)' : 'var(--surface-2)',
                }}
              >
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.xlsm,.csv,.txt,.tsv"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = '';
                  }}
                />
                {busy === 'upload' ? (
                  <Loader2 className="w-5 h-5 animate-spin mb-2" style={{ color: 'var(--green)' }} />
                ) : (
                  <Upload className="w-5 h-5 mb-2" strokeWidth={2.2} style={{ color: 'var(--ink-4)' }} />
                )}
                <div style={{ fontSize: 13.5, fontWeight: 550 }}>
                  Drop a spreadsheet, or click to browse
                </div>
                <div className="quiet mt-1">.xlsx, .csv or .txt — a column of addresses is enough</div>
              </div>

              {(state?.sources.length ?? 0) > 0 && (
                <div className="flex flex-col gap-1.5">
                  {state?.sources.map((source) => (
                    <div
                      key={source.fileName}
                      className="flex items-center gap-2.5 px-3 py-2.5"
                      style={{ background: 'var(--surface-2)', borderRadius: 12 }}
                    >
                      <FileSpreadsheet
                        className="w-4 h-4 shrink-0"
                        strokeWidth={2.2}
                        style={{ color: 'var(--ink-4)' }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate" style={{ fontSize: 12.5 }}>
                          {source.fileName}
                        </div>
                        <div className="quiet">
                          {source.count} row{source.count === 1 ? '' : 's'} · {source.mailable} mailable
                        </div>
                      </div>
                      {confirming === source.fileName ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() =>
                              removeRows(
                                `file-${source.fileName}`,
                                source.fileName,
                                `row${source.count === 1 ? '' : 's'} from ${source.fileName}`,
                              )
                            }
                            disabled={busy !== null}
                            className="btn btn-sm btn-danger"
                            style={{ padding: '0 10px' }}
                          >
                            {busy === `file-${source.fileName}` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              `Remove ${source.count}`
                            )}
                          </button>
                          <button onClick={disarm} className="btn btn-sm" style={{ padding: '0 10px' }}>
                            Keep
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => arm(source.fileName)}
                          disabled={busy !== null || Boolean(activeJob)}
                          title={`Remove only the rows from ${source.fileName}`}
                          className="btn btn-ghost btn-sm shrink-0"
                          style={{ padding: '0 8px' }}
                        >
                          <X className="w-3.5 h-3.5" strokeWidth={2.6} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {recipients.length > 0 && (
                <div className="flex items-end justify-between gap-3">
                  <p className="quiet" style={{ maxWidth: 300 }}>
                    Saved in the database — survives sign-out and restarts. Uploads add to the
                    list rather than replacing it.
                  </p>
                  {confirming === 'all' ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() =>
                          removeRows('clear', '', `recipient${recipients.length === 1 ? '' : 's'}`)
                        }
                        disabled={busy !== null}
                        className="btn btn-sm btn-danger"
                      >
                        {busy === 'clear' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={2.4} />
                        )}
                        Delete all {recipients.length}
                      </button>
                      <button onClick={disarm} className="btn btn-sm">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => arm('all')}
                      disabled={busy !== null || Boolean(activeJob)}
                      className="btn btn-ghost btn-sm shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={2.4} />
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 2 — the message */}
          {step === 'message' && (
            <div className="p-5 flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {brands.map((b) => {
                  const on = brandKey === b.key;
                  return (
                    <button
                      key={b.key}
                      onClick={() => chooseBrand(b)}
                      className="text-left"
                      style={{
                        padding: '11px 13px',
                        borderRadius: 12,
                        border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`,
                        background: on ? 'var(--green-soft)' : 'var(--surface)',
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span style={{ fontSize: 13, fontWeight: 550 }}>{b.name}</span>
                        {on && (
                          <Check
                            className="w-3.5 h-3.5 ml-auto shrink-0"
                            strokeWidth={3}
                            style={{ color: 'var(--green)' }}
                          />
                        )}
                      </div>
                      <div className="mono quiet truncate" style={{ marginTop: 2 }}>
                        {b.site}
                      </div>
                    </button>
                  );
                })}
              </div>

              {brand && brand.templates.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="eyebrow">Angle</span>
                    {edited && <span className="pill pill-warn">Edited</span>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {brand.templates.map((t) => {
                      const on = templateKey === t.key;
                      return (
                        <button
                          key={t.key}
                          onClick={() => chooseTemplate(t)}
                          className="text-left px-3 py-2.5"
                          style={{
                            borderRadius: 12,
                            border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`,
                            background: on ? 'var(--green-soft)' : 'var(--surface)',
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span style={{ fontSize: 12.5, fontWeight: 550 }}>{t.label}</span>
                            {on && (
                              <Check
                                className="w-3.5 h-3.5 ml-auto shrink-0"
                                strokeWidth={3}
                                style={{ color: 'var(--green)' }}
                              />
                            )}
                          </div>
                          <div className="quiet" style={{ marginTop: 2 }}>
                            {t.hint}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="quiet" style={{ marginTop: 8 }}>
                    Pick a different angle for the next round — the rotation comes back to
                    the same people, and the same email twice is what gets reported as spam.
                    {edited && ' Your edits are kept until you pick another angle.'}
                  </p>
                </div>
              )}

              <label className="block">
                <span className="eyebrow">Subject</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="field"
                  style={{ fontSize: 13, marginTop: 6 }}
                />
              </label>

              <label className="block">
                <span className="eyebrow">Message</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  className="field"
                  style={{ fontSize: 12.5, marginTop: 6, resize: 'vertical', lineHeight: 1.65 }}
                />
              </label>

              <p className="quiet">
                <span className="mono">{'{{first_name}}'}</span>{' '}
                <span className="mono">{'{{company_name}}'}</span>{' '}
                <span className="mono">{'{{job_title}}'}</span>{' '}
                <span className="mono">{'{{industry}}'}</span>{' '}
                <span className="mono">{'{{location}}'}</span> fill from the uploaded row. A
                missing name becomes “there”, not a blank.
              </p>

              <button onClick={() => setStep('send')} className="btn btn-primary self-start">
                Next — choose how many
              </button>
            </div>
          )}

          {/* 3 — the send */}
          {step === 'send' && (
            <div className="p-5 flex flex-col gap-4">
              <div className="px-3.5 py-3" style={{ background: 'var(--surface-2)', borderRadius: 12 }}>
                <div className="eyebrow mb-1">Sending as</div>
                <div style={{ fontSize: 13, fontWeight: 550 }}>
                  {brand?.name ?? '—'}
                  {activeTemplate && (
                    <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>
                      {' · '}
                      {activeTemplate.label}
                      {edited ? ' (edited)' : ''}
                    </span>
                  )}
                </div>
                <div className="truncate quiet" style={{ marginTop: 2 }}>
                  {subject}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="eyebrow mb-1.5">How many</div>
                  <div className="flex gap-1.5">
                    {BATCH_SIZES.map((n) => (
                      <button
                        key={n}
                        onClick={() => setCount(n)}
                        className={count === n ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                        style={{ minWidth: 42, padding: '0 10px' }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="eyebrow mb-1.5">Gap between sends</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={delay}
                      onChange={(e) =>
                        setDelay(Math.max(5, Math.min(300, Number(e.target.value) || 15)))
                      }
                      className="field"
                      style={{ fontSize: 13, width: 84 }}
                    />
                    <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>seconds</span>
                  </div>
                </div>
              </div>

              <label className="block">
                <span className="eyebrow">From</span>
                <select
                  value={mailboxId}
                  onChange={(e) => setMailboxId(e.target.value)}
                  className="field"
                  style={{ fontSize: 13, marginTop: 6 }}
                >
                  {mailboxes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.address} — {m.remainingToday} left today
                    </option>
                  ))}
                  {noMailbox && <option value="">No mailbox connected</option>}
                </select>
              </label>

              {upNext.length > 0 && (
                <div className="px-3.5 py-3" style={{ background: 'var(--surface-2)', borderRadius: 12 }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="eyebrow">Next out, in this order</div>
                    <span className="pill">Round {state?.currentRound ?? 1}</span>
                  </div>
                  <ol className="flex flex-col gap-1">
                    {upNext.slice(0, 8).map((r, i) => (
                      <li key={r.id} className="flex items-center gap-2" style={{ fontSize: 11.5 }}>
                        <span
                          className="mono shrink-0 text-right"
                          style={{ width: 16, color: 'var(--ink-4)' }}
                        >
                          {i + 1}
                        </span>
                        <span className="mono truncate" style={{ color: 'var(--ink-2)' }}>
                          {r.email}
                        </span>
                        {r.sendCount > 0 && (
                          <span className="pill shrink-0 ml-auto">
                            {r.sendCount === 1 ? '2nd time' : `${r.sendCount + 1}th time`}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                  {upNext.length > 8 && (
                    <div className="quiet" style={{ marginTop: 6 }}>
                      …and {upNext.length - 8} more
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={startSend}
                disabled={
                  busy !== null ||
                  Boolean(activeJob) ||
                  noMailbox ||
                  eligible === 0 ||
                  !subject.trim() ||
                  !body.trim()
                }
                className="btn btn-primary w-full"
              >
                {busy === 'send' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" strokeWidth={2.4} />
                )}
                Send {willSend} {willSend === 1 ? 'email' : 'emails'}
                {eta > 0 && ` · ${formatDuration(eta)}`}
              </button>

              {noMailbox && (
                <p style={{ fontSize: 12, color: 'var(--warn)' }}>
                  Connect a mailbox on the Mailboxes screen first.
                </p>
              )}
              {!noMailbox && eligible === 0 && recipients.length > 0 && (
                <p className="quiet">Everyone on this list has opted out. Upload more to keep going.</p>
              )}
              <p className="quiet">
                The list is a circle: whoever was emailed least often, and longest ago, goes
                next, and nobody appears twice in one run. The daily ceiling and the
                do-not-contact list are re-checked before every message.
              </p>
            </div>
          )}
        </div>

        {/* Recipients / replies */}
        <div className="card overflow-hidden">
          <div className="card-head">
            <div className="seg" role="tablist">
              <button
                role="tab"
                aria-selected={tab === 'list'}
                onClick={() => setTab('list')}
                className="seg-btn"
              >
                Recipients{recipients.length > 0 ? ` ${recipients.length}` : ''}
              </button>
              <button
                role="tab"
                aria-selected={tab === 'replies'}
                onClick={() => setTab('replies')}
                className="seg-btn"
              >
                Replies{(state?.replies.length ?? 0) > 0 ? ` ${state?.replies.length}` : ''}
              </button>
            </div>
            {tab === 'list' && recipients.length > 0 && (
              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  strokeWidth={2.4}
                  style={{ color: 'var(--ink-4)' }}
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="field"
                  style={{ width: 150, borderRadius: 999, fontSize: 12.5, padding: '7px 12px 7px 32px' }}
                />
              </div>
            )}
          </div>

          {isLoading && !state && (
            <div className="p-10 text-center">
              <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--ink-4)' }} />
            </div>
          )}

          {tab === 'list' &&
            (recipients.length === 0 ? (
              <div className="p-12 text-center" style={{ fontSize: 13.5, color: 'var(--ink-4)' }}>
                Nothing uploaded yet. Drop a spreadsheet on the left.
              </div>
            ) : (
              <div className="overflow-x-auto" style={{ maxHeight: 560 }}>
                <table className="w-full" style={{ minWidth: 420 }}>
                  <thead className="thead">
                    <tr>
                      <th className="text-left font-bold px-5 py-3">Recipient</th>
                      <th className="text-right font-bold px-3 py-3">Sent</th>
                      <th className="text-right font-bold px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.id} className="trow">
                        <td className="px-5 py-3">
                          <div className="mono truncate" style={{ fontSize: 12 }}>
                            {r.email}
                          </div>
                          <div className="truncate quiet">
                            {[r.name, r.company, r.location].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span
                            className="figure"
                            style={{
                              fontSize: 13,
                              color: r.sendCount === 0 ? 'var(--ink-4)' : 'var(--ink-2)',
                            }}
                            title={
                              r.sendCount === 0 ? 'Never contacted' : `Emailed ${r.sendCount} times`
                            }
                          >
                            {r.sendCount === 0 ? '—' : `${r.sendCount}×`}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          {r.sharesAddressWith ? (
                            <span
                              className="pill pill-warn"
                              title={`This address belongs to ${r.sharesAddressWith}, who receives the mail instead.`}
                            >
                              Shared address
                            </span>
                          ) : (
                            <>
                              {r.replied && <span className="pill pill-good mr-1">Replied</span>}
                              {r.suppressed && <span className="pill pill-bad mr-1">Opted out</span>}
                              <span className={STATUS_PILL[r.status]}>
                                {r.status === 'pending' ? 'not yet' : r.status}
                              </span>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visible.length === 0 && (
                  <div className="p-8 text-center" style={{ fontSize: 13, color: 'var(--ink-4)' }}>
                    Nothing matches that search.
                  </div>
                )}
              </div>
            ))}

          {tab === 'replies' && (
            <div style={{ maxHeight: 560 }} className="overflow-y-auto">
              {(state?.replies.length ?? 0) === 0 ? (
                <div className="p-12 text-center" style={{ fontSize: 13.5, color: 'var(--ink-4)' }}>
                  <Mail className="w-5 h-5 mx-auto mb-2" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
                  No replies yet. Press <span style={{ fontWeight: 550 }}>Sync replies</span> on the
                  Inbox screen to pull new mail in.
                </div>
              ) : (
                state?.replies.map((reply) => (
                  <div key={reply.id} className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="mono truncate" style={{ fontSize: 12, fontWeight: 550 }}>
                        {reply.fromAddress}
                      </span>
                      {reply.classification && (
                        <span className={REPLY_PILL[reply.classification] ?? 'pill'}>
                          {reply.classification.replace('_', ' ')}
                        </span>
                      )}
                      <span className="mono ml-auto quiet">
                        {reply.receivedAt.slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>
                    <div className="truncate" style={{ fontSize: 12.5, fontWeight: 550, marginBottom: 4 }}>
                      {reply.subject}
                    </div>
                    <p
                      style={{
                        fontSize: 12.5,
                        color: 'var(--ink-3)',
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {reply.body.slice(0, 500)}
                      {reply.body.length > 500 ? '…' : ''}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
