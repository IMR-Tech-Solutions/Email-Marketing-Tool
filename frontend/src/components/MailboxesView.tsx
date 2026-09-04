import React, { useState } from 'react';
import { Mailbox } from '../types';
import { Plus, Loader2, Trash2, CheckCircle2, AlertTriangle, Mail } from 'lucide-react';

interface MailboxesViewProps {
  mailboxes: Mailbox[];
  totalRemainingToday: number;
  isLoading: boolean;
  onConnect: (body: {
    address: string;
    displayName: string;
    smtpHost: string;
    smtpPort: number;
    imapHost: string;
    imapPort: number;
    username: string;
    password: string;
    dailyLimit: number;
  }) => Promise<void>;
  onTest: (id: string) => Promise<void>;
  onUpdate: (id: string, body: { dailyLimit?: number; isActive?: boolean }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/** Common hosts, so nobody has to go looking them up. */
const PRESETS: Record<string, { smtp: string; smtpPort: number; imap: string; imapPort: number; note: string }> = {
  Gmail: {
    smtp: 'smtp.gmail.com',
    smtpPort: 587,
    imap: 'imap.gmail.com',
    imapPort: 993,
    note: 'Requires an App Password (Google Account → Security → 2-Step Verification → App passwords). Your normal password will be rejected.',
  },
  'Outlook / Microsoft 365': {
    smtp: 'smtp.office365.com',
    smtpPort: 587,
    imap: 'outlook.office365.com',
    imapPort: 993,
    note: 'Requires an app password if your account has MFA enabled.',
  },
  Custom: { smtp: '', smtpPort: 587, imap: '', imapPort: 993, note: 'Ask your host for the SMTP and IMAP settings.' },
};

const STATUS_PILL: Record<string, string> = {
  connected: 'pill pill-good',
  error: 'pill pill-bad',
  untested: 'pill pill-warn',
  disabled: 'pill',
};

export function MailboxesView({
  mailboxes,
  totalRemainingToday,
  isLoading,
  onConnect,
  onTest,
  onUpdate,
  onDelete,
}: MailboxesViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [preset, setPreset] = useState<keyof typeof PRESETS>('Gmail');
  const [form, setForm] = useState({
    address: '',
    displayName: '',
    username: '',
    password: '',
    smtpHost: PRESETS.Gmail.smtp,
    smtpPort: PRESETS.Gmail.smtpPort,
    imapHost: PRESETS.Gmail.imap,
    imapPort: PRESETS.Gmail.imapPort,
    dailyLimit: 40,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [usernameTouched, setUsernameTouched] = useState(false);

  /*
   * Providers that authenticate on the full address. Browsers love to autofill
   * this app's own login into these boxes, and a bare username fails against
   * Gmail and Microsoft every time - so catch it here rather than after a
   * round trip to the mail server.
   */
  const needsFullAddress = /gmail|googlemail|office365|outlook/i.test(form.smtpHost);
  const usernameLooksWrong = needsFullAddress && form.username.trim() !== '' && !form.username.includes('@');

  const applyPreset = (name: keyof typeof PRESETS) => {
    const p = PRESETS[name];
    setPreset(name);
    setForm((f) => ({
      ...f,
      smtpHost: p.smtp,
      smtpPort: p.smtpPort,
      imapHost: p.imap,
      imapPort: p.imapPort,
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (usernameLooksWrong) {
      setError(
        `${form.smtpHost} signs in with the full email address. Set the username to ` +
          `${form.address || 'your address'} or leave it blank.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConnect({
        ...form,
        username: form.username.trim() || form.address.trim(),
      });
      setShowForm(false);
      setForm((f) => ({ ...f, address: '', displayName: '', username: '', password: '' }));
      setUsernameTouched(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (id: string) => {
    setTestingId(id);
    try {
      await onTest(id);
    } catch {
      // Status is refreshed from the server either way.
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 940 }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Mailboxes</h1>
          <p className="page-sub">
            {mailboxes.length} connected · {totalRemainingToday} sends available today
          </p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn btn-primary">
          <Plus className="w-4 h-4" strokeWidth={2} />
          Add mailbox
        </button>
      </div>

      <div className="card p-4 flex items-start gap-3">
        <Mail className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          <span className="font-medium">Mailbox rotation is a deliverability strategy, not a volume one.</span>{' '}
          The daily limit is a real ceiling — sending stops when it is reached rather than
          spilling over. Credentials are encrypted at rest and only decrypted when a
          connection is opened.
        </p>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card overflow-hidden rise">
          <div className="card-head">
            <div className="card-title">Connect a mailbox</div>
            <div className="flex gap-1.5">
              {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => applyPreset(name)}
                  className={preset === name ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="p-5 flex flex-col gap-4">
            <div
              className="px-3.5 py-2.5 rounded-[10px] text-[12.5px] leading-relaxed"
              style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn-border)', color: 'var(--ink-2)' }}
            >
              {PRESETS[preset].note}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12.5px] font-medium mb-1.5">Email address</label>
                <input
                  type="email"
                  required
                  value={form.address}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      address: e.target.value,
                      // Mirror into the username until the user edits it themselves.
                      username: usernameTouched ? f.username : e.target.value,
                    }))
                  }
                  placeholder="you@company.com"
                  className="field"
                  autoComplete="off"
                  name="mailbox-address"
                />
              </div>
              <div>
                <label className="block text-[12.5px] font-medium mb-1.5">Display name</label>
                <input
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="Your Name"
                  className="field"
                />
              </div>
              <div>
                <label className="block text-[12.5px] font-medium mb-1.5">
                  Username <span style={{ color: 'var(--ink-4)' }}>(blank = address)</span>
                </label>
                <input
                  value={form.username}
                  onChange={(e) => {
                    setUsernameTouched(true);
                    setForm({ ...form, username: e.target.value });
                  }}
                  placeholder="you@company.com"
                  className="field"
                  autoComplete="off"
                  name="mailbox-username"
                  style={usernameLooksWrong ? { borderColor: 'var(--bad)' } : undefined}
                />
                {usernameLooksWrong && (
                  <p style={{ fontSize: 11.5, color: 'var(--bad)', marginTop: 6 }}>
                    This provider signs in with the full email address, not{' '}
                    <span className="mono">{form.username}</span>. Your browser may have
                    autofilled it.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[12.5px] font-medium mb-1.5">App password</label>
                <input
                  type="password"
                  required
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="16-character app password"
                  className="field"
                  autoComplete="new-password"
                  name="mailbox-app-password"
                />
              </div>
              <div className="grid grid-cols-[1fr_88px] gap-2">
                <div>
                  <label className="block text-[12.5px] font-medium mb-1.5">SMTP host</label>
                  <input
                    required
                    value={form.smtpHost}
                    onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                    className="field"
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-medium mb-1.5">Port</label>
                  <input
                    type="number"
                    value={form.smtpPort}
                    onChange={(e) => setForm({ ...form, smtpPort: Number(e.target.value) })}
                    className="field"
                  />
                </div>
              </div>
              <div className="grid grid-cols-[1fr_88px] gap-2">
                <div>
                  <label className="block text-[12.5px] font-medium mb-1.5">IMAP host</label>
                  <input
                    required
                    value={form.imapHost}
                    onChange={(e) => setForm({ ...form, imapHost: e.target.value })}
                    className="field"
                  />
                </div>
                <div>
                  <label className="block text-[12.5px] font-medium mb-1.5">Port</label>
                  <input
                    type="number"
                    value={form.imapPort}
                    onChange={(e) => setForm({ ...form, imapPort: Number(e.target.value) })}
                    className="field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[12.5px] font-medium mb-1.5">Daily send limit</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={form.dailyLimit}
                  onChange={(e) => setForm({ ...form, dailyLimit: Number(e.target.value) })}
                  className="field"
                />
              </div>
            </div>

            {error && (
              <div
                className="px-3.5 py-3 rounded-[10px] text-[12.5px] leading-relaxed"
                style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-border)', color: 'var(--bad)' }}
              >
                {error}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[12px]" style={{ color: 'var(--ink-4)' }}>
                Both SMTP and IMAP are verified before anything is saved.
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn">
                  Cancel
                </button>
                <button
                type="submit"
                disabled={busy || usernameLooksWrong}
                className="btn btn-primary"
              >
                  {busy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
                    </>
                  ) : (
                    'Verify and connect'
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        {isLoading && mailboxes.length === 0 ? (
          <div className="p-10 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
            Loading…
          </div>
        ) : mailboxes.length === 0 ? (
          <div className="p-12 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
            No mailbox connected yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 640 }}>
              <thead className="thead">
                <tr>
                  <th className="text-left font-medium px-5 py-2.5">Mailbox</th>
                  <th className="text-left font-medium px-3 py-2.5">Status</th>
                  <th className="text-right font-medium px-3 py-2.5">Sent today</th>
                  <th className="text-right font-medium px-3 py-2.5">Limit</th>
                  <th className="text-right font-medium px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {mailboxes.map((m) => (
                  <tr key={m.id} className="trow">
                    <td className="px-5 py-3.5">
                      <div className="text-[13.5px] font-medium">{m.address}</div>
                      <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-3)' }}>
                        {m.smtpHost}:{m.smtpPort} · {m.imapHost}:{m.imapPort}
                      </div>
                      {m.status === 'error' && m.statusDetail && (
                        <div className="text-[12px] mt-1.5 flex items-start gap-1.5" style={{ color: 'var(--bad)' }}>
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" strokeWidth={2} />
                          <span>{m.statusDetail}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <span className={STATUS_PILL[m.isActive ? m.status : 'disabled']}>
                        {m.status === 'connected' && m.isActive && (
                          <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />
                        )}
                        {!m.isActive ? 'Disabled' : m.status}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      <div className="mono text-[13px]">
                        {m.sentToday} / {m.dailyLimit}
                      </div>
                      <div
                        className="rounded-full overflow-hidden ml-auto mt-1.5"
                        style={{ width: 68, height: 4, background: 'var(--surface-3)' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (m.sentToday / m.dailyLimit) * 100)}%`,
                            background: m.remainingToday === 0 ? 'var(--warn)' : 'var(--green)',
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={m.dailyLimit}
                        onChange={(e) => onUpdate(m.id, { dailyLimit: Number(e.target.value) })}
                        className="field mono"
                        style={{ width: 74, height: 30, padding: '0 8px', textAlign: 'right' }}
                      />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => runTest(m.id)}
                          disabled={testingId === m.id}
                          className="btn btn-sm"
                        >
                          {testingId === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Test'}
                        </button>
                        <button
                          onClick={() => onUpdate(m.id, { isActive: !m.isActive })}
                          className="btn btn-sm"
                        >
                          {m.isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => onDelete(m.id)}
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--bad)' }}
                          title="Remove mailbox"
                        >
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
