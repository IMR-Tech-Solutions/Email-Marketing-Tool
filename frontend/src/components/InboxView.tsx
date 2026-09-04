import React, { useMemo, useState } from 'react';
import { EmailThread, InboxResponse, Mailbox, ReplyClass } from '../types';
import { RefreshCw, Loader2, Send, Inbox as InboxIcon, AlertTriangle, CornerUpLeft } from 'lucide-react';

interface InboxViewProps {
  data: InboxResponse | null;
  mailboxes: Mailbox[];
  isLoading: boolean;
  isSyncing: boolean;
  onSync: () => void;
  onReply: (threadKey: string, mailboxId: string, body: string) => Promise<void>;
  onMarkRead: (threadKey: string) => void;
  onNavigate: (view: string) => void;
}

const CLASS_STYLE: Record<ReplyClass, { label: string; pill: string }> = {
  positive: { label: 'Positive', pill: 'pill pill-good' },
  referral: { label: 'Referral', pill: 'pill pill-good' },
  neutral: { label: 'Neutral', pill: 'pill' },
  not_interested: { label: 'Not interested', pill: 'pill' },
  unsubscribe: { label: 'Unsubscribed', pill: 'pill pill-bad' },
  auto_reply: { label: 'Auto-reply', pill: 'pill' },
};

type Filter = 'all' | 'needs_response' | 'positive' | 'unread';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'needs_response', label: 'Needs response' },
  { id: 'positive', label: 'Positive' },
  { id: 'unread', label: 'Unread' },
  { id: 'all', label: 'All' },
];

function when(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString();
}

export function InboxView({
  data,
  mailboxes,
  isLoading,
  isSyncing,
  onSync,
  onReply,
  onMarkRead,
  onNavigate,
}: InboxViewProps) {
  const [filter, setFilter] = useState<Filter>('needs_response');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const sendable = mailboxes.filter((m) => m.isActive && m.status === 'connected');
  const [mailboxId, setMailboxId] = useState('');
  const activeMailbox = mailboxId || sendable[0]?.id || '';

  const threads = useMemo(() => {
    const all = data?.threads ?? [];
    if (filter === 'needs_response') return all.filter((t) => t.awaitingReply);
    if (filter === 'positive')
      return all.filter((t) => t.classification === 'positive' || t.classification === 'referral');
    if (filter === 'unread') return all.filter((t) => t.unread > 0);
    return all;
  }, [data, filter]);

  const selected: EmailThread | null =
    threads.find((t) => t.threadKey === selectedKey) ?? threads[0] ?? null;

  const openThread = (thread: EmailThread) => {
    setSelectedKey(thread.threadKey);
    setDraft('');
    setReplyError(null);
    if (thread.unread > 0) onMarkRead(thread.threadKey);
  };

  const submitReply = async () => {
    if (!selected || !draft.trim() || !activeMailbox) return;
    setSending(true);
    setReplyError(null);
    try {
      await onReply(selected.threadKey, activeMailbox, draft.trim());
      setDraft('');
    } catch (err: any) {
      setReplyError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (mailboxes.length === 0) {
    return (
      <div className="flex flex-col gap-5" style={{ maxWidth: 640 }}>
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-sub">Send outreach and handle replies in one place</p>
        </div>
        <div className="card p-10 text-center">
          <div
            className="grid place-items-center rounded-full mx-auto mb-4"
            style={{ width: 44, height: 44, background: 'var(--surface-3)' }}
          >
            <InboxIcon className="w-5 h-5" strokeWidth={1.8} style={{ color: 'var(--ink-4)' }} />
          </div>
          <div className="card-title mb-1.5">No mailbox connected</div>
          <p className="text-[13px] mb-5 leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            Connect a mailbox over IMAP/SMTP and this becomes a working inbox — send
            outreach, sync replies, and answer them here.
          </p>
          <button onClick={() => onNavigate('mailboxes')} className="btn btn-primary">
            Connect a mailbox
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-sub">
            {data?.unread ?? 0} unread · {data?.needsResponse ?? 0} awaiting your reply ·{' '}
            {sendable.length} mailbox{sendable.length === 1 ? '' : 'es'} ready
          </p>
        </div>
        <button onClick={onSync} disabled={isSyncing} className="btn btn-primary">
          {isSyncing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Syncing…
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" strokeWidth={2} /> Sync replies
            </>
          )}
        </button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => {
          const count =
            f.id === 'needs_response'
              ? data?.needsResponse
              : f.id === 'positive'
                ? data?.positive
                : f.id === 'unread'
                  ? data?.unread
                  : data?.threads.length;
          return (
            <button
              key={f.id}
              onClick={() => {
                setFilter(f.id);
                setSelectedKey(null);
              }}
              className={filter === f.id ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            >
              {f.label}
              {count !== undefined && count > 0 && (
                <span className="mono text-[11px] opacity-75">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4 items-start">

        {/* Thread list */}
        <div className="card overflow-hidden">
          {isLoading && !data ? (
            <div className="p-10 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
              Loading…
            </div>
          ) : threads.length === 0 ? (
            <div className="p-10 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
              Nothing here. Try Sync replies, or a different filter.
            </div>
          ) : (
            <div style={{ maxHeight: 620, overflowY: 'auto' }}>
              {threads.map((thread) => {
                const active = selected?.threadKey === thread.threadKey;
                return (
                  <button
                    key={thread.threadKey}
                    onClick={() => openThread(thread)}
                    className="w-full text-left px-4 py-3 trow"
                    style={{ background: active ? 'var(--green-soft)' : undefined }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {thread.unread > 0 && (
                        <span
                          className="rounded-full shrink-0"
                          style={{ width: 6, height: 6, background: 'var(--green)' }}
                        />
                      )}
                      <span
                        className="text-[13px] truncate flex-1"
                        style={{ fontWeight: thread.unread > 0 ? 600 : 500 }}
                      >
                        {thread.companyName ?? thread.counterparty}
                      </span>
                      <span className="text-[11px] shrink-0" style={{ color: 'var(--ink-4)' }}>
                        {when(thread.lastAt)}
                      </span>
                    </div>
                    <div className="text-[12.5px] truncate mb-1.5" style={{ color: 'var(--ink-2)' }}>
                      {thread.subject}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {thread.classification && (
                        <span className={CLASS_STYLE[thread.classification].pill}>
                          {CLASS_STYLE[thread.classification].label}
                        </span>
                      )}
                      {thread.awaitingReply && (
                        <span className="pill pill-warn">Awaiting reply</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Conversation */}
        {selected ? (
          <div className="card overflow-hidden">
            <div className="card-head">
              <div className="min-w-0">
                <div className="card-title truncate">{selected.subject}</div>
                <div className="text-[12.5px] mt-0.5 truncate" style={{ color: 'var(--ink-3)' }}>
                  {selected.counterparty}
                  {selected.companyName && ` · ${selected.companyName}`}
                </div>
              </div>
              {selected.classification && (
                <span className={CLASS_STYLE[selected.classification].pill}>
                  {CLASS_STYLE[selected.classification].label}
                </span>
              )}
            </div>

            <div className="p-5 flex flex-col gap-3" style={{ maxHeight: 420, overflowY: 'auto' }}>
              {selected.messages.map((message) => {
                const outbound = message.direction === 'outbound';
                return (
                  <div
                    key={message.id}
                    className="rounded-[12px] px-4 py-3"
                    style={{
                      background: outbound ? 'var(--green-soft)' : 'var(--surface-2)',
                      border: `1px solid ${outbound ? 'var(--green-border)' : 'var(--border)'}`,
                      marginLeft: outbound ? 32 : 0,
                      marginRight: outbound ? 0 : 32,
                    }}
                  >
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <span className="text-[12px] font-medium">
                        {outbound ? 'You' : message.fromAddress}
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
                        {when(message.sentAt)}
                      </span>
                    </div>
                    <p
                      className="text-[13px] leading-relaxed"
                      style={{ color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}
                    >
                      {message.body}
                    </p>

                    {message.classificationReason && (
                      <p
                        className="text-[11.5px] mt-2 pt-2"
                        style={{ borderTop: '1px solid var(--border)', color: 'var(--ink-4)' }}
                      >
                        Triage: {message.classificationReason}
                        {message.classificationConfidence != null &&
                          ` · confidence ${message.classificationConfidence}`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Composer */}
            <div className="p-5" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              {selected.classification === 'unsubscribe' ? (
                <div
                  className="flex items-start gap-2.5 px-3.5 py-3 rounded-[10px] text-[13px]"
                  style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-border)', color: 'var(--bad)' }}
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2} />
                  <span>
                    This contact opted out and was suppressed automatically. Replying is blocked.
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2.5">
                    <CornerUpLeft className="w-3.5 h-3.5" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
                    <span className="text-[12.5px] font-medium">Reply</span>
                    {sendable.length > 1 && (
                      <select
                        value={activeMailbox}
                        onChange={(e) => setMailboxId(e.target.value)}
                        className="field ml-auto"
                        style={{ width: 'auto', height: 30, fontSize: 12.5, padding: '0 8px' }}
                      >
                        {sendable.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.address}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={4}
                    placeholder="Write your reply…"
                    className="field"
                    style={{ resize: 'vertical', lineHeight: 1.6 }}
                    disabled={sending || sendable.length === 0}
                  />

                  {replyError && (
                    <div className="mt-2 text-[12.5px]" style={{ color: 'var(--bad)' }}>
                      {replyError}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
                    <span className="text-[12px]" style={{ color: 'var(--ink-4)' }}>
                      {sendable.length === 0
                        ? 'No verified mailbox — connect one first'
                        : `Sends from ${sendable.find((m) => m.id === activeMailbox)?.address ?? ''}`}
                    </span>
                    <button
                      onClick={submitReply}
                      disabled={sending || !draft.trim() || sendable.length === 0}
                      className="btn btn-primary"
                    >
                      {sending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Sending…
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" strokeWidth={2} /> Send reply
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="card p-12 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
            Select a conversation.
          </div>
        )}
      </div>
    </div>
  );
}
