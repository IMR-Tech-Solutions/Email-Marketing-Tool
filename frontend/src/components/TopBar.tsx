import React from 'react';
import { Search, Bell, Mail } from 'lucide-react';

interface TopBarProps {
  title: string;
  username: string;
  /** From Settings. Falls back to the original label until it loads. */
  workspaceName?: string;
  claudeReady: boolean;
  isBusy: boolean;
  alerts: number;
  unread: number;
  onOpenCommand: () => void;
  onNavigate: (view: string) => void;
}

/** Round, borderless icon button - the notification affordance. */
function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="relative grid place-items-center transition-colors"
      title={label}
      aria-label={label}
      style={{ width: 40, height: 40, borderRadius: 999, color: 'var(--ink-3)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  );
}

export function TopBar({
  title,
  username,
  workspaceName,
  claudeReady,
  isBusy,
  alerts,
  unread,
  onOpenCommand,
  onNavigate,
}: TopBarProps) {
  const status = isBusy
    ? { text: 'Agents running', color: 'var(--warn)', bg: 'var(--warn-soft)', border: 'var(--warn-border)' }
    : claudeReady
      ? { text: 'Agents ready', color: 'var(--good)', bg: 'var(--good-soft)', border: 'var(--good-border)' }
      : { text: 'No API key', color: 'var(--ink-3)', bg: 'var(--surface-2)', border: 'var(--border-strong)' };

  return (
    <header
      className="flex items-center gap-3 shrink-0"
      style={{ padding: '13px 24px', borderBottom: '1px solid var(--border)', background: 'var(--shell)' }}
    >
      {/* Search / command - open field, no chrome until you touch it */}
      <button
        onClick={onOpenCommand}
        className="flex items-center gap-3 transition-colors"
        style={{
          height: 42,
          padding: '0 14px',
          borderRadius: 12,
          background: 'transparent',
          border: '1px solid transparent',
          color: 'var(--ink-4)',
          width: 340,
          maxWidth: '38vw',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--surface-2)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.borderColor = 'transparent';
        }}
      >
        <Search className="w-[18px] h-[18px] shrink-0" strokeWidth={2.2} />
        <span style={{ fontSize: 14 }} className="truncate">
          Search…
        </span>
        <span
          className="mono ml-auto shrink-0"
          style={{
            fontSize: 10.5,
            padding: '2px 6px',
            borderRadius: 6,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
        >
          ⌘K
        </span>
      </button>

      <span className="sr-only">{title}</span>

      <div className="ml-auto flex items-center gap-1.5">
        <span
          className="hidden lg:inline-flex items-center gap-2 mr-1.5"
          style={{
            height: 30,
            padding: '0 12px',
            borderRadius: 999,
            background: status.bg,
            color: status.color,
            border: `1px solid ${status.border}`,
            fontSize: 12,
            fontWeight: 550,
          }}
        >
          <span
            className="rounded-full"
            style={{
              width: 6,
              height: 6,
              background: 'currentColor',
              animation: isBusy ? 'pulse 1.4s ease-in-out infinite' : undefined,
            }}
          />
          {status.text}
        </span>

        <IconButton label="Inbox" onClick={() => onNavigate('inbox')}>
          <Mail className="w-[19px] h-[19px]" strokeWidth={2} />
          {unread > 0 && (
            <span
              className="absolute rounded-full"
              style={{ top: 8, right: 8, width: 8, height: 8, background: 'var(--brand)', border: '2px solid #fff' }}
            />
          )}
        </IconButton>

        <IconButton label="What needs you" onClick={() => onNavigate('queue')}>
          <Bell className="w-[19px] h-[19px]" strokeWidth={2} />
          {alerts > 0 && (
            <span
              className="absolute grid place-items-center rounded-full text-white"
              style={{
                top: 2,
                right: 2,
                minWidth: 17,
                height: 17,
                padding: '0 4px',
                fontSize: 10,
                fontWeight: 650,
                background: 'var(--brand)',
                border: '2px solid #fff',
              }}
            >
              {alerts}
            </span>
          )}
        </IconButton>

        <div className="flex items-center gap-2.5 pl-2.5 ml-1" style={{ borderLeft: '1px solid var(--border)' }}>
          <div
            className="grid place-items-center rounded-full text-white shrink-0"
            style={{
              width: 38,
              height: 38,
              background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
              fontSize: 13,
              fontWeight: 650,
            }}
          >
            {username.slice(0, 2).toUpperCase()}
          </div>
          <div className="hidden sm:block leading-tight">
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{username}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{workspaceName || 'Revenue workspace'}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
