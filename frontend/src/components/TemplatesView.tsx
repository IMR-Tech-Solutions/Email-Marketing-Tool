import React, { useState } from 'react';
import { Template, TemplateListResponse } from '../types';
import { Plus, Trash2, Loader2, FileText } from 'lucide-react';

interface TemplatesViewProps {
  data: TemplateListResponse | null;
  isLoading: boolean;
  onCreate: (body: { name: string; whenToUse: string; subject: string; body: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const EMPTY = { name: '', whenToUse: '', subject: '', body: '' };

export function TemplatesView({ data, isLoading, onCreate, onDelete }: TemplatesViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Template | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate(form);
      setForm(EMPTY);
      setShowForm(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const templates = data?.templates ?? [];
  const shown = selected ?? templates[0] ?? null;

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 1040 }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Templates</h1>
          <p className="page-sub">
            Shared starting points. Personalization is applied on top, never instead.
          </p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn btn-primary">
          <Plus className="w-4 h-4" strokeWidth={2} />
          New template
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card overflow-hidden rise">
          <div className="card-head">
            <div className="card-title">New template</div>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12.5px] font-medium mb-1.5">Name</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="field"
                  placeholder="Expansion signal"
                />
              </div>
              <div>
                <label className="block text-[12.5px] font-medium mb-1.5">When to use</label>
                <input
                  value={form.whenToUse}
                  onChange={(e) => setForm({ ...form, whenToUse: e.target.value })}
                  className="field"
                  placeholder="A company announced growth"
                />
              </div>
            </div>

            <div>
              <label className="block text-[12.5px] font-medium mb-1.5">Subject</label>
              <input
                required
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="field"
                placeholder="{{ company_name }} and the new line"
              />
            </div>

            <div>
              <label className="block text-[12.5px] font-medium mb-1.5">Body</label>
              <textarea
                required
                rows={6}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="field"
                style={{ resize: 'vertical', lineHeight: 1.6 }}
                placeholder="Hi {{ first_name }}, saw {{ trigger_event }}…"
              />
            </div>

            <div>
              <div className="eyebrow mb-2">Supported variables</div>
              <div className="flex flex-wrap gap-1.5">
                {(data?.supportedVariables ?? []).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setForm({ ...form, body: `${form.body}{{ ${v} }}` })}
                    className="pill mono"
                    style={{ cursor: 'pointer' }}
                  >
                    {v}
                  </button>
                ))}
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

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="btn btn-primary">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save template'}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="card p-4 flex items-start gap-3">
        <FileText className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          A template referencing <span className="mono text-[12px]">trigger_event</span> or{' '}
          <span className="mono text-[12px]">research_snippet</span> will not send to a prospect
          where that variable is empty — it never sends a sentence with a hole in it.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="card-title mb-1.5">No templates yet</div>
          <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
            {isLoading ? 'Loading…' : 'Create one to reuse a proven opening.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-4 items-start">
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead className="thead">
                <tr>
                  <th className="text-left font-medium px-5 py-2.5">Template</th>
                  <th className="text-right font-medium px-3 py-2.5">Uses</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr
                    key={t.id}
                    className="trow cursor-pointer group"
                    onClick={() => setSelected(t)}
                    style={{ background: shown?.id === t.id ? 'var(--green-soft)' : undefined }}
                  >
                    <td className="px-5 py-3">
                      <div className="text-[13.5px] font-medium">{t.name}</div>
                      <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-3)' }}>
                        {t.whenToUse || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right mono text-[13px]">{t.uses}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(t.id);
                        }}
                        className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: 'var(--bad)' }}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {shown && (
            <div className="card overflow-hidden">
              <div className="card-head">
                <div className="card-title truncate">{shown.name}</div>
                {shown.variables.length > 0 && (
                  <span className="pill">{shown.variables.length} variables</span>
                )}
              </div>
              <div className="p-5 flex flex-col gap-4">
                <div>
                  <div className="eyebrow mb-1.5">Subject</div>
                  <p className="text-[13.5px] font-medium">{shown.subject}</p>
                </div>
                <div>
                  <div className="eyebrow mb-1.5">Body</div>
                  <p
                    className="text-[13px] leading-relaxed rounded-[10px] px-3.5 py-3"
                    style={{ background: 'var(--surface-2)', color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}
                  >
                    {shown.body}
                  </p>
                </div>
                {shown.variables.length > 0 && (
                  <div>
                    <div className="eyebrow mb-2">Variables used</div>
                    <div className="flex flex-wrap gap-1.5">
                      {shown.variables.map((v) => (
                        <span key={v} className="pill mono">{v}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
