import React, { useEffect, useMemo, useState } from 'react';
import { OutboxResponse, ReplyClass, SendSource, SentMessage } from '../types';
import {
  Loader2,
  Search,
  SendHorizontal,
  CornerDownLeft,
  RefreshCw,
  Inbox as InboxIcon,
} from 'lucide-react';

interface OutboxViewProps {
  data: OutboxResponse | null;
  isLoading: boolean;
  isSyncing: boolean;
  /** Same pull the Inbox does — replies only appear once mail is fetched. */
  onSync: () => void;
  onNavigate: (view: string) => void;
}

type Filter = 'all' | 'replied' | 'waiting';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'replied', label: 'Replied' },
  { id: 'waiting', label: 'No reply yet' },
];

const SOURCE_LABEL: Record<SendSource, string> = {
  campaign: 'Client',
  bulk: 'Bulk',
  manual: 'Manual',
};

const CLASS_STYLE: Record<ReplyClass, { label: string; pill: string }> = {
  positive: { label: 'Positive', pill: 'pill pill-good' },
  referral: { label: 'Referral', pill: 'pill pill-good' },
  neutral: { label: 'Neutral', pill: 'pill' },
  not_interested: { label: 'Not interested', pill: 'pill pill-warn' },
  unsubscribe: { label: 'Unsubscribed', pill: 'pill pill-bad' },
  auto_reply: { label: 'Auto-reply', pill: 'pill' },
};

function when(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString();
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <span className="figure">{value}</span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

export function OutboxView({ data, isLoading, isSyncing, onSync, onNavigate }: OutboxViewProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const messages = data?.messages ?? [];
  const q = query.trim().toLowerCase();

  const visible = useMemo(
    () =>
      messages.filter((m) => {
        if (filter === 'replied' && !m.replied) return false;
        if (filter === 'waiting' && m.replied) return false;
        if (!q) return true;
        return (
          m.toAddress.toLowerCase().includes(q) ||
          m.subject.toLowerCase().includes(q) ||
          m.recipient.toLowerCase().includes(q) ||
          m.company.toLowerCase().includes(q)
        );
      }),
    [messages, filter, q],
  );

  const selected = visible.find((m) => m.id === openId) ?? visible[0] ?? null;

  useEffect(() => {
    if (selected && selected.id !== openId) setOpenId(selected.id);
  }, [selected, openId]);

  if (isLoading && !data) {
    return (
      <div className="card p-16 text-center">
        <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--ink-4)' }} />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="page-title">Outbox</h1>
          <p className="page-sub">Every email this workspace has sent.</p>
        </div>
        <div className="card p-16 text-center">
          <SendHorizontal
            className="w-6 h-6 mx-auto mb-3"
            strokeWidth={1.8}
            style={{ color: 'var(--ink-4)' }}
          />
          <div className="card-title mb-1.5">Nothing sent yet</div>
          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            Send from <span style={{ fontWeight: 550 }}>Clients</span>, or in bulk from{' '}
            <span style={{ fontWeight: 550 }}>Bulk Outreach</span>, and every message lands here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Outbox</h1>
          <p className="page-sub">Every email this workspace has sent, and who answered.</p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search
              className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
              strokeWidth={2.4}
              style={{ color: 'var(--ink-4)' }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sent mail…"
              className="field"
              style={{ paddingLeft: 40, width: 220, borderRadius: 999 }}
            />
          </div>
          <button onClick={onSync} disabled={isSyncing} className="btn btn-sm" title="Pull new replies">
            {isSyncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.4} />
            )}
            Check for replies
          </button>
        </div>
      </div>

      <div className="card stat-strip">
        <Stat value={data?.total ?? 0} label="Sent" />
        <Stat value={data?.sentToday ?? 0} label="Sent today" />
        <Stat value={data?.replied ?? 0} label="Replied" />
        <Stat value={`${data?.replyRate ?? 0}%`} label="Reply rate" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-5 items-start">

        {/* Sent list */}
        <div className="card overflow-hidden">
          <div className="card-head">
            <div className="seg" role="tablist">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className="seg-btn"
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="quiet">{visible.length} shown</span>
          </div>

          <div style={{ maxHeight: 620, overflowY: 'auto' }}>
            {visible.map((m) => {
              const active = selected?.id === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setOpenId(m.id)}
                  className="w-full text-left px-5 py-3.5 trow"
                  style={{ background: active ? 'var(--surface-2)' : undefined }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="mono truncate" style={{ fontSize: 12, fontWeight: 550 }}>
                      {m.toAddress}
                    </span>
                    <span className="mono ml-auto shrink-0 quiet">{when(m.sentAt)}</span>
                  </div>
                  <div className="truncate" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                    {m.subject}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className="pill">{SOURCE_LABEL[m.source]}</span>
                    {(m.recipient || m.company) && (
                      <span className="truncate quiet">
                        {[m.recipient, m.company].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {m.replied && (
                      <span
                        className={
                          m.replyClassification
                            ? CLASS_STYLE[m.replyClassification].pill
                            : 'pill pill-good'
                        }
                      >
                        {m.replyClassification
                          ? CLASS_STYLE[m.replyClassification].label
                          : 'Replied'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {visible.length === 0 && (
              <div className="p-10 text-center" style={{ fontSize: 13, color: 'var(--ink-4)' }}>
                Nothing matches that filter.
              </div>
            )}
          </div>

          {data?.truncated && (
            <div className="px-5 py-3 quiet" style={{ borderTop: '1px solid var(--border)' }}>
              Showing the most recent {messages.length} of {data.total}. Export from Bulk
              Outreach for the full history.
            </div>
          )}
        </div>

        {/* The message */}
        {selected && (
          <div className="card xl:sticky xl:top-4 overflow-hidden">
            <div className="card-head">
              <div className="min-w-0">
                <div className="card-title truncate">
                  {selected.recipient || selected.toAddress}
                </div>
                <div className="truncate" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                  {selected.company ? `${selected.company} · ` : ''}
                  {new Date(selected.sentAt).toLocaleString()}
                </div>
              </div>
              <span className="pill shrink-0">{SOURCE_LABEL[selected.source]}</span>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div className="meta">
                <span>
                  From <span className="mono">{selected.fromAddress}</span>
                </span>
                <span>
                  To <span className="mono">{selected.toAddress}</span>
                </span>
              </div>

              <div className="letter">
                <div className="letter-head">{selected.subject}</div>
                <div className="letter-body">{selected.body}</div>
              </div>

              {selected.replied ? (
                <button
                  onClick={() => onNavigate('inbox')}
                  className="flex items-center gap-2.5 px-4 py-3 text-left"
                  style={{
                    background: 'var(--green-soft)',
                    border: '1px solid var(--green-border)',
                    borderRadius: 14,
                  }}
                >
                  <CornerDownLeft
                    className="w-4 h-4 shrink-0"
                    strokeWidth={2.2}
                    style={{ color: 'var(--green)' }}
                  />
                  <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                    They replied
                    {selected.replyClassification
                      ? ` — ${CLASS_STYLE[selected.replyClassification].label.toLowerCase()}`
                      : ''}
                    . Open the thread in the Inbox to answer.
                  </span>
                </button>
              ) : (
                <div
                  className="flex items-center gap-2.5 px-4 py-3"
                  style={{ background: 'var(--surface-2)', borderRadius: 14 }}
                >
                  <InboxIcon
                    className="w-4 h-4 shrink-0"
                    strokeWidth={2.2}
                    style={{ color: 'var(--ink-4)' }}
                  />
                  <span className="quiet">
                    No reply on this thread yet. Replies only appear after mail is fetched —
                    press <span style={{ fontWeight: 550 }}>Check for replies</span> above.
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
