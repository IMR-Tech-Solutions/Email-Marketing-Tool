import React from 'react';
import { Search, Bell, Mail } from 'lucide-react';

interface TopBarProps {
  title: string;
  username: string;
  claudeReady: boolean;
  isBusy: boolean;
  alerts: number;
  unread: number;
  onOpenCommand: () => void;
  onNavigate: (view: string) => void;
}

export function TopBar({
  title,
  username,
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
      style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--shell)' }}
    >
      {/* Search / command */}
      <button
        onClick={onOpenCommand}
        className="flex items-center gap-2.5"
        style={{
          height: 40,
          padding: '0 16px',
          borderRadius: 999,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--ink-4)',
          width: 300,
          maxWidth: '38vw',
        }}
      >
        <Search className="w-4 h-4 shrink-0" strokeWidth={2.2} />
        <span style={{ fontSize: 13.5 }} className="truncate">
          Search…
        </span>
        <span
          className="mono ml-auto shrink-0"
          style={{
            fontSize: 10.5,
            padding: '2px 6px',
            borderRadius: 6,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          ⌘K
        </span>
      </button>

      <span className="sr-only">{title}</span>

      <div className="ml-auto flex items-center gap-2.5">
        <span
          className="hidden lg:inline-flex items-center gap-2"
          style={{
            height: 32,
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

        <button
          onClick={() => onNavigate('inbox')}
          className="relative grid place-items-center"
          title="Inbox"
          aria-label="Inbox"
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
        >
          <Mail className="w-4 h-4" strokeWidth={2.1} style={{ color: 'var(--ink-2)' }} />
          {unread > 0 && (
            <span
              className="absolute rounded-full"
              style={{ top: 9, right: 9, width: 8, height: 8, background: 'var(--green)', border: '1.5px solid #fff' }}
            />
          )}
        </button>

        <button
          onClick={() => onNavigate('queue')}
          className="relative grid place-items-center"
          title="What needs you"
          aria-label="What needs you"
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
        >
          <Bell className="w-4 h-4" strokeWidth={2.1} style={{ color: 'var(--ink-2)' }} />
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
                background: 'var(--green)',
                border: '1.5px solid #fff',
              }}
            >
              {alerts}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2.5 pl-1.5">
          <div
            className="grid place-items-center rounded-full text-white shrink-0"
            style={{ width: 36, height: 36, background: 'var(--green)', fontSize: 13, fontWeight: 550 }}
          >
            {username.slice(0, 2).toUpperCase()}
          </div>
          <div className="hidden sm:block leading-tight">
            <div style={{ fontSize: 13, fontWeight: 550 }}>{username}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>Revenue workspace</div>
          </div>
        </div>
      </div>
    </header>
  );
}
