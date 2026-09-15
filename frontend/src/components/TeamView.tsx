import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Role, TeamUser } from '../types';
import { Users, Plus, Loader2, KeyRound, Trash2, Ban, CheckCircle2, ShieldCheck } from 'lucide-react';

interface TeamViewProps {
  /** Who is signed in - their own row gets no self-destruct buttons. */
  currentUsername: string;
}

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', sales: 'Sales Executive' };

const ROLE_HINT: Record<Role, string> = {
  admin: 'Everything - including Discover, Bulk Outreach, Mailboxes, Templates, Integrations, the workspace tabs of Settings, and this page.',
  sales: 'Works the pipeline: Clients, Deal Board, Priority Queue, Campaigns, Inbox, Outbox, Analytics, Compliance, and their own password under Settings. Cannot run Discover, send bulk mail, or change configuration.',
};

function when(iso?: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString();
}

export function TeamView({ currentUsername }: TeamViewProps) {
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create form.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('sales');
  const [isSaving, setIsSaving] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  // Inline password reset.
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      setUsers((await api.listUsers()).users);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || password.length < 8 || isSaving) return;
    setIsSaving(true);
    setError(null);
    setCreated(null);
    try {
      const user = await api.createUser({ username: username.trim(), password, role });
      setCreated(`${user.username} can sign in now as ${ROLE_LABEL[user.role]}.`);
      setUsername('');
      setPassword('');
      setRole('sales');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const submitReset = async (id: string) => {
    if (resetPassword.length < 8) return;
    await run(id, () => api.updateUser(id, { password: resetPassword }));
    setResetId(null);
    setResetPassword('');
  };

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 960 }}>
      <div>
        <h1 className="page-title">Team</h1>
        <p className="page-sub">
          {users ? `${users.length} account${users.length === 1 ? '' : 's'}` : 'Loading…'} ·
          logins are created here and nowhere else
        </p>
      </div>

      <div className="card p-5 flex items-start gap-3.5">
        <div
          className="grid place-items-center rounded-[10px] shrink-0"
          style={{ width: 34, height: 34, background: 'var(--green-soft)' }}
        >
          <ShieldCheck className="w-4 h-4" strokeWidth={2} style={{ color: 'var(--green)' }} />
        </div>
        <div className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          <div className="text-[13.5px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>
            Two roles. The difference is what costs money or changes the setup.
          </div>
          <div><span style={{ fontWeight: 550, color: 'var(--ink-2)' }}>Sales Executive</span> — {ROLE_HINT.sales}</div>
          <div className="mt-1"><span style={{ fontWeight: 550, color: 'var(--ink-2)' }}>Admin</span> — {ROLE_HINT.admin}</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <form
          onSubmit={handleCreate}
          className="p-5"
          style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}
        >
          <label className="block text-[12.5px] font-medium mb-2">Create a login</label>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoComplete="off"
              disabled={isSaving}
              className="field"
              style={{ flex: '1 1 12rem', width: 'auto', height: 36 }}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password (8+ characters)"
              autoComplete="new-password"
              disabled={isSaving}
              className="field"
              style={{ flex: '1 1 14rem', width: 'auto', height: 36 }}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              disabled={isSaving}
              className="field"
              style={{ width: 'auto', height: 36, padding: '0 36px 0 12px', lineHeight: '34px' }}
            >
              <option value="sales">Sales Executive</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={!username.trim() || password.length < 8 || isSaving}
              className="btn btn-primary"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" strokeWidth={2} />}
              Create
            </button>
          </div>
          {created && (
            <div className="mt-2.5 text-[12.5px]" style={{ color: 'var(--good)' }}>{created}</div>
          )}
          {error && (
            <div className="mt-2.5 text-[12.5px]" style={{ color: 'var(--bad)' }}>{error}</div>
          )}
        </form>

        {users === null ? (
          <div className="p-10 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>Loading…</div>
        ) : (
          <table className="w-full">
            <thead className="thead">
              <tr>
                <th className="text-left font-medium px-5 py-2.5">Account</th>
                <th className="text-left font-medium px-3 py-2.5">Role</th>
                <th className="text-left font-medium px-3 py-2.5">Status</th>
                <th className="text-left font-medium px-3 py-2.5">Last sign-in</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.username.toLowerCase() === currentUsername.toLowerCase();
                const busy = busyId === u.id;
                return (
                  <React.Fragment key={u.id}>
                    <tr className="trow">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="grid place-items-center rounded-full shrink-0 text-[11px] font-semibold"
                            style={{ width: 28, height: 28, background: 'var(--surface-3)', color: 'var(--ink-2)' }}
                          >
                            {u.username.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="text-[13px] font-medium">
                            {u.username}
                            {self && <span className="ml-1.5 text-[11.5px]" style={{ color: 'var(--ink-4)' }}>(you)</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={u.role}
                          disabled={self || busy}
                          onChange={(e) => run(u.id, () => api.updateUser(u.id, { role: e.target.value as Role }))}
                          className="field"
                          style={{ width: 'auto', height: 30, fontSize: 12.5, padding: '0 30px 0 10px', lineHeight: '28px' }}
                          title={self ? 'You cannot change your own role' : 'Change role'}
                        >
                          <option value="sales">Sales Executive</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <span className={u.isActive ? 'pill pill-good' : 'pill pill-bad'}>
                          {u.isActive ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                        {when(u.lastLoginAt)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setResetId(resetId === u.id ? null : u.id); setResetPassword(''); }}
                            disabled={busy}
                            title="Set a new password"
                            className="btn btn-ghost btn-sm"
                          >
                            <KeyRound className="w-3.5 h-3.5" strokeWidth={2} />
                          </button>
                          {!self && (
                            <>
                              <button
                                onClick={() => run(u.id, () => api.updateUser(u.id, { isActive: !u.isActive }))}
                                disabled={busy}
                                title={u.isActive ? 'Disable - they cannot sign in until re-enabled' : 'Enable'}
                                className="btn btn-ghost btn-sm"
                              >
                                {u.isActive
                                  ? <Ban className="w-3.5 h-3.5" strokeWidth={2} />
                                  : <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />}
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm(`Delete the login for ${u.username}? This cannot be undone.`)) {
                                    void run(u.id, () => api.deleteUser(u.id));
                                  }
                                }}
                                disabled={busy}
                                title="Delete this login"
                                className="btn btn-ghost btn-sm"
                                style={{ color: 'var(--bad)' }}
                              >
                                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {resetId === u.id && (
                      <tr>
                        <td colSpan={5} className="px-5 pb-3" style={{ background: 'var(--surface-2)' }}>
                          <div className="flex flex-wrap items-center gap-2 pt-3">
                            <span className="text-[12.5px] font-medium">New password for {u.username}</span>
                            <input
                              type="password"
                              value={resetPassword}
                              onChange={(e) => setResetPassword(e.target.value)}
                              placeholder="8+ characters"
                              autoComplete="new-password"
                              className="field"
                              style={{ flex: '1 1 14rem', width: 'auto', height: 32 }}
                              onKeyDown={(e) => { if (e.key === 'Enter') void submitReset(u.id); }}
                            />
                            <button
                              onClick={() => submitReset(u.id)}
                              disabled={resetPassword.length < 8 || busy}
                              className="btn btn-primary btn-sm"
                            >
                              Save
                            </button>
                            <button onClick={() => setResetId(null)} className="btn btn-sm">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
                    <Users className="w-5 h-5 mx-auto mb-2" strokeWidth={1.8} />
                    No accounts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
