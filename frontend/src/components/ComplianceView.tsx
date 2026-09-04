import React, { useState } from 'react';
import { SuppressionEntry } from '../types';
import { ShieldOff, Plus, Trash2, Loader2 } from 'lucide-react';

interface ComplianceViewProps {
  entries: SuppressionEntry[];
  isLoading: boolean;
  onAdd: (value: string, reason: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const REASONS = ['manual', 'unsubscribed', 'complaint', 'bounced', 'do-not-contact'];

export function ComplianceView({ entries, isLoading, onAdd, onRemove }: ComplianceViewProps) {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('manual');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onAdd(value.trim(), reason);
      setValue('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    try {
      await onRemove(id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 900 }}>
      <div>
        <h1 className="page-title">Compliance</h1>
        <p className="page-sub">
          {entries.length} suppressed · checked before any outreach is generated
        </p>
      </div>

      <div className="card p-5 flex items-start gap-3.5">
        <div
          className="grid place-items-center rounded-[10px] shrink-0"
          style={{ width: 34, height: 34, background: 'var(--green-soft)' }}
        >
          <ShieldOff className="w-4 h-4" strokeWidth={2} style={{ color: 'var(--green)' }} />
        </div>
        <div>
          <div className="text-[13.5px] font-semibold mb-1">
            A business email address is not permission to use it.
          </div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            Add an address, or a bare domain to suppress everyone there — a complaint should
            stop contact with the whole company, not just one person. Suppressed contacts are
            removed before the personalization agent runs, so you never pay to write a message
            that must not be sent.
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <form
          onSubmit={handleAdd}
          className="p-5"
          style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}
        >
          <label className="block text-[12.5px] font-medium mb-2">Add to do-not-contact list</label>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="someone@example.com or example.com"
              disabled={isSaving}
              className="field"
              style={{ flex: '1 1 18rem', width: 'auto', height: 36 }}
            />
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isSaving}
              className="field"
              style={{ width: 'auto', height: 36 }}
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button type="submit" disabled={!value.trim() || isSaving} className="btn btn-primary">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" strokeWidth={2} />}
              Suppress
            </button>
          </div>
          {error && (
            <div className="mt-2.5 text-[12.5px]" style={{ color: 'var(--bad)' }}>{error}</div>
          )}
        </form>

        {isLoading ? (
          <div className="p-10 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
            Nothing suppressed yet.
          </div>
        ) : (
          <table className="w-full">
            <thead className="thead">
              <tr>
                <th className="text-left font-medium px-5 py-2.5">Address or domain</th>
                <th className="text-left font-medium px-3 py-2.5">Reason</th>
                <th className="text-left font-medium px-3 py-2.5">Added</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="trow group">
                  <td className="px-5 py-3 mono text-[12.5px]">{entry.value}</td>
                  <td className="px-3 py-3"><span className="pill">{entry.reason}</span></td>
                  <td className="px-3 py-3 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                    {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => handleRemove(entry.id)}
                      disabled={removingId === entry.id}
                      title="Remove from list"
                      className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--bad)' }}
                    >
                      {removingId === entry.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
