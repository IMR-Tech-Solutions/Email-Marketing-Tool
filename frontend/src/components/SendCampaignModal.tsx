import React, { useMemo, useState } from 'react';
import { CampaignSendPreview, CampaignSendResult, Mailbox } from '../types';
import { X, Loader2, Send, CheckCircle2, AlertTriangle, MinusCircle } from 'lucide-react';

interface SendCampaignModalProps {
  open: boolean;
  preview: CampaignSendPreview | null;
  mailboxes: Mailbox[];
  preselected: string[];
  onClose: () => void;
  onSend: (mailboxId: string, companyIds: string[]) => Promise<CampaignSendResult[]>;
  onNavigate: (view: string) => void;
}

const MAX_PER_BATCH = 10;

const STATUS_ICON = {
  sent: { icon: CheckCircle2, color: 'var(--good)' },
  skipped: { icon: MinusCircle, color: 'var(--ink-4)' },
  failed: { icon: AlertTriangle, color: 'var(--bad)' },
};

export function SendCampaignModal({
  open,
  preview,
  mailboxes,
  preselected,
  onClose,
  onSend,
  onNavigate,
}: SendCampaignModalProps) {
  const sendable = useMemo(
    () => (preview?.targets ?? []).filter((t) => t.sendable),
    [preview],
  );
  const blocked = useMemo(
    () => (preview?.targets ?? []).filter((t) => !t.sendable),
    [preview],
  );

  const usable = mailboxes.filter((m) => m.isActive && m.status === 'connected');
  const [mailboxId, setMailboxId] = useState('');
  const activeMailbox = mailboxId || usable[0]?.id || '';

  const [chosen, setChosen] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CampaignSendResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Which draft is open to read. null = not chosen yet, '' = closed on purpose.
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!open) return null;

  // Opened for one client - from Campaigns, or a single tick on Clients - the
  // email is shown straight away. Nobody should have to click to see what
  // they are about to send.
  const defaultExpanded = preselected.length === 1 ? preselected[0] : null;
  const shown = expanded === null ? defaultExpanded : expanded || null;

  // Default: whatever the user ticked on the Clients table, else everything sendable.
  const selected =
    chosen ??
    sendable
      .filter((t) => preselected.length === 0 || preselected.includes(t.companyId))
      .slice(0, MAX_PER_BATCH)
      .map((t) => t.companyId);

  const toggle = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : selected.length >= MAX_PER_BATCH
        ? selected
        : [...selected, id];
    setChosen(next);
  };

  const capacity = preview?.remainingToday ?? 0;
  const overCapacity = selected.length > capacity;

  const submit = async () => {
    if (!activeMailbox || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await onSend(activeMailbox, selected));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setResults(null);
    setChosen(null);
    setError(null);
    setExpanded(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(38,35,34,0.42)' }}
      onClick={close}
    >
      <div
        className="w-full rise flex flex-col"
        style={{
          maxWidth: 640,
          maxHeight: '86vh',
          background: 'var(--surface)',
          borderRadius: 24,
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="display" style={{ fontSize: 22 }}>
              {results ? 'Send complete' : 'Send outreach'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>
              {results
                ? 'Every recipient is reported individually.'
                : 'Read each email before it goes. Up to 10 at a time.'}
            </p>
          </div>
          <button onClick={close} className="btn btn-ghost btn-sm" aria-label="Close">
            <X className="w-4 h-4" strokeWidth={2.4} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-5">
          {results ? (
            <div className="flex flex-col gap-2.5">
              {results.map((r) => {
                const meta = STATUS_ICON[r.status];
                const Icon = meta.icon;
                return (
                  <div
                    key={r.companyId}
                    className="flex items-start gap-3 px-4 py-3"
                    style={{ background: 'var(--surface-2)', borderRadius: 14 }}
                  >
                    <Icon className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2.4} style={{ color: meta.color }} />
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 13.5, fontWeight: 550 }}>{r.company}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{r.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : usable.length === 0 ? (
            <div className="text-center py-8">
              <p style={{ fontSize: 13.5, color: 'var(--ink-3)', marginBottom: 16 }}>
                No verified mailbox. Connect one before sending.
              </p>
              <button onClick={() => { close(); onNavigate('mailboxes'); }} className="btn btn-primary">
                Connect a mailbox
              </button>
            </div>
          ) : (
            <>
              <div className="mb-5">
                <label className="block mb-2" style={{ fontSize: 12.5, fontWeight: 550 }}>
                  Send from
                </label>
                <select
                  value={activeMailbox}
                  onChange={(e) => setMailboxId(e.target.value)}
                  className="field"
                >
                  {usable.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.address} — {m.remainingToday} left today
                    </option>
                  ))}
                </select>
              </div>

              {sendable.length === 0 ? (
                <p style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
                  Nothing is ready to send. Every drafted campaign is blocked — see below.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2.5">
                    <span style={{ fontSize: 12.5, fontWeight: 550 }}>
                      Ready to send ({selected.length}/{Math.min(sendable.length, MAX_PER_BATCH)})
                    </span>
                    <button
                      onClick={() =>
                        setChosen(
                          selected.length === Math.min(sendable.length, MAX_PER_BATCH)
                            ? []
                            : sendable.slice(0, MAX_PER_BATCH).map((t) => t.companyId),
                        )
                      }
                      style={{ fontSize: 12.5, fontWeight: 550, color: 'var(--green)' }}
                    >
                      {selected.length ? 'Clear' : 'Select all'}
                    </button>
                  </div>

                  <div className="flex flex-col gap-2">
                    {sendable.map((t) => {
                      const on = selected.includes(t.companyId);
                      const isShown = shown === t.companyId;
                      return (
                        <div
                          key={t.companyId}
                          className="flex flex-col transition-colors"
                          style={{
                            borderRadius: 14,
                            border: `1.5px solid ${on ? 'var(--green-border)' : 'var(--border)'}`,
                            background: on ? 'var(--green-soft)' : 'var(--surface)',
                          }}
                        >
                          <button
                            onClick={() => toggle(t.companyId)}
                            className="flex items-start gap-3 px-4 pt-3 pb-2 text-left w-full"
                          >
                            <span
                              className="grid place-items-center shrink-0 mt-0.5"
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: 6,
                                border: `1.5px solid ${on ? 'var(--green)' : 'var(--border-strong)'}`,
                                background: on ? 'var(--green)' : 'transparent',
                              }}
                            >
                              {on && <CheckCircle2 className="w-3 h-3 text-white" strokeWidth={3} />}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="flex items-baseline gap-2">
                                <span style={{ fontSize: 13.5, fontWeight: 550 }}>{t.company}</span>
                                <span className="mono truncate" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                                  {t.email}
                                </span>
                              </span>
                              <span className="block truncate" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                                {t.subject}
                              </span>
                            </span>
                          </button>

                          <div className="px-4 pb-2.5" style={{ paddingLeft: 46 }}>
                            <button
                              type="button"
                              onClick={() => setExpanded(isShown ? '' : t.companyId)}
                              style={{ fontSize: 12.5, fontWeight: 550, color: 'var(--green)' }}
                            >
                              {isShown ? 'Hide the email' : 'Read the email'}
                            </button>
                          </div>

                          {isShown && (
                            <div className="px-4 pb-4">
                              <div className="letter">
                                <div className="letter-head">{t.subject}</div>
                                <div
                                  className="mono"
                                  style={{ fontSize: 11.5, color: 'var(--ink-4)', paddingBottom: 10 }}
                                >
                                  To {t.contact} &lt;{t.email}&gt;
                                </div>
                                <div className="letter-body">{t.body}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {blocked.length > 0 && (
                <div className="mt-6">
                  <div className="mb-2.5" style={{ fontSize: 12.5, fontWeight: 550, color: 'var(--ink-3)' }}>
                    Blocked ({blocked.length})
                  </div>
                  <div className="flex flex-col gap-2">
                    {blocked.map((t) => (
                      <div
                        key={t.companyId}
                        className="flex items-center gap-3 px-4 py-2.5"
                        style={{ background: 'var(--surface-2)', borderRadius: 14 }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 550 }}>{t.company}</span>
                        <span className="ml-auto pill">{t.blockedReason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div
                  className="mt-5 px-4 py-3"
                  style={{ background: 'var(--bad-soft)', border: '1.5px solid var(--bad-border)', borderRadius: 14, color: 'var(--bad)', fontSize: 13 }}
                >
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {!results && usable.length > 0 && sendable.length > 0 && (
          <div
            className="flex items-center justify-between gap-4 px-7 py-5 flex-wrap"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <span style={{ fontSize: 12.5, color: overCapacity ? 'var(--bad)' : 'var(--ink-3)' }}>
              {overCapacity
                ? `Only ${capacity} sends left today on this mailbox`
                : `${capacity} sends left today · this is a real email`}
            </span>
            <button
              onClick={submit}
              disabled={busy || selected.length === 0 || overCapacity}
              className="btn btn-primary"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Sending…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" strokeWidth={2.4} />
                  Send {selected.length} email{selected.length === 1 ? '' : 's'}
                </>
              )}
            </button>
          </div>
        )}

        {results && (
          <div className="flex justify-end gap-2 px-7 py-5" style={{ borderTop: '1px solid var(--border)' }}>
            <button onClick={close} className="btn">Close</button>
            <button onClick={() => { close(); onNavigate('inbox'); }} className="btn btn-primary">
              Open Inbox
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
