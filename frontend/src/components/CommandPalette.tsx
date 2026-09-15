import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import { Role } from '../types';
import { canView } from '../lib/roles';

interface CommandPaletteProps {
  open: boolean;
  role: Role;
  onClose: () => void;
  onNavigate: (view: string) => void;
}

const DESTINATIONS = [
  { id: 'dashboard', label: 'Dashboard', group: 'Intelligence', hint: 'Headline numbers and database health' },
  { id: 'run', label: 'Discover', group: 'Intelligence', hint: 'Define an ICP and run the agents' },
  { id: 'companies', label: 'Accounts', group: 'Intelligence', hint: 'Every saved account' },
  { id: 'crm_board', label: 'Deal Board', group: 'Intelligence', hint: 'Drag accounts across stages' },
  { id: 'queue', label: 'Priority Queue', group: 'Intelligence', hint: 'Who deserves attention now, ranked' },
  { id: 'retouch', label: 'Database Retouch', group: 'Intelligence', hint: 'Decayed records, priced before you approve' },
  { id: 'inbox', label: 'Inbox', group: 'Outreach', hint: 'Send outreach and answer replies' },
  { id: 'outreach', label: 'Campaigns', group: 'Outreach', hint: 'Generated copy' },
  { id: 'templates', label: 'Templates', group: 'Outreach', hint: 'Reusable starting points' },
  { id: 'analytics', label: 'Analytics', group: 'Outreach', hint: 'Pipeline shape' },
  { id: 'mailboxes', label: 'Mailboxes', group: 'System', hint: 'Connect an email account over IMAP/SMTP' },
  { id: 'agents', label: 'AI Agents', group: 'System', hint: 'Agent roster, triggers and spend' },
  { id: 'cost', label: 'Cost', group: 'System', hint: 'Spend per agent and model routing' },
  { id: 'compliance', label: 'Compliance', group: 'System', hint: 'Do-not-contact list' },
  { id: 'crm', label: 'Integrations', group: 'System', hint: 'CRM connection' },
  { id: 'settings', label: 'Settings', group: 'System', hint: 'Workspace defaults, sending, spend and your account' },
  { id: 'team', label: 'Team', group: 'System', hint: 'Logins and roles' },
];

export function CommandPalette({ open, role, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const reachable = DESTINATIONS.filter((d) => canView(role, d.id));
    const q = query.trim().toLowerCase();
    if (!q) return reachable;
    return reachable.filter(
      (d) => d.label.toLowerCase().includes(q) || d.hint.toLowerCase().includes(q),
    );
  }, [query, role]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setCursor(0), [query]);

  if (!open) return null;

  const choose = (id: string) => {
    onNavigate(id);
    onClose();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && matches[cursor]) {
      e.preventDefault();
      choose(matches[cursor].id);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4"
      style={{ background: 'rgba(15,17,21,0.32)', backdropFilter: 'blur(3px)', paddingTop: '13vh' }}
      onClick={onClose}
    >
      <div
        className="w-full rise"
        style={{
          maxWidth: 540,
          background: 'var(--surface)',
          borderRadius: 16,
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-3 px-4"
          style={{ height: 52, borderBottom: '1px solid var(--border)' }}
        >
          <Search className="w-4 h-4 shrink-0" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Jump to a screen…"
            className="flex-1 outline-none text-[14px] bg-transparent"
            style={{ border: 'none', color: 'var(--ink)' }}
          />
          <kbd
            className="mono text-[10.5px] px-1.5 py-0.5 rounded-md"
            style={{ background: 'var(--surface-3)', color: 'var(--ink-4)' }}
          >
            ESC
          </kbd>
        </div>

        <div style={{ maxHeight: 340, overflowY: 'auto', padding: 6 }}>
          {matches.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
              Nothing matches “{query}”
            </div>
          ) : (
            matches.map((dest, i) => (
              <button
                key={dest.id}
                onClick={() => choose(dest.id)}
                onMouseEnter={() => setCursor(i)}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-[10px]"
                style={{ background: i === cursor ? 'var(--green-soft)' : 'transparent' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-medium">{dest.label}</div>
                  <div className="text-[12px] truncate" style={{ color: 'var(--ink-3)' }}>
                    {dest.hint}
                  </div>
                </div>
                <span className="pill">{dest.group}</span>
                {i === cursor && (
                  <CornerDownLeft className="w-3.5 h-3.5" strokeWidth={2} style={{ color: 'var(--green)' }} />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
