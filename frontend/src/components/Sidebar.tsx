import React from 'react';
import {
  LayoutGrid,
  ListOrdered,
  Sparkles,
  Building2,
  RefreshCw,
  KanbanSquare,
  Send,
  Inbox,
  SendHorizontal,
  Megaphone,
  FileText,
  BarChart3,
  Mail,
  Bot,
  Wallet,
  ShieldOff,
  Plug,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

interface SidebarProps {
  currentView: string;
  onViewChange: (view: string) => void;
  badges: Record<string, string | number | undefined>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSignOut: () => void;
}

const NAV: {
  head: string;
  items: { id: string; label: string; icon: React.ElementType; badgeKey?: string }[];
}[] = [
  {
    head: 'Menu',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
      { id: 'queue', label: 'Priority Queue', icon: ListOrdered, badgeKey: 'queue' },
      { id: 'run', label: 'Discover', icon: Sparkles },
      { id: 'companies', label: 'Clients', icon: Building2, badgeKey: 'accounts' },
      { id: 'retouch', label: 'Retouch', icon: RefreshCw, badgeKey: 'retouch' },
      { id: 'crm_board', label: 'Deal Board', icon: KanbanSquare },
    ],
  },
  {
    head: 'Outreach',
    items: [
      { id: 'outreach', label: 'Campaigns', icon: Send, badgeKey: 'campaigns' },
      { id: 'broadcast', label: 'Bulk Outreach', icon: Megaphone, badgeKey: 'broadcast' },
      { id: 'inbox', label: 'Inbox', icon: Inbox, badgeKey: 'unread' },
      { id: 'outbox', label: 'Outbox', icon: SendHorizontal, badgeKey: 'sent' },
      { id: 'templates', label: 'Templates', icon: FileText, badgeKey: 'templates' },
      { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    head: 'General',
    items: [
      { id: 'mailboxes', label: 'Mailboxes', icon: Mail, badgeKey: 'mailboxes' },
      { id: 'agents', label: 'AI Agents', icon: Bot },
      { id: 'cost', label: 'Cost', icon: Wallet },
      { id: 'compliance', label: 'Compliance', icon: ShieldOff, badgeKey: 'suppressed' },
      { id: 'crm', label: 'Integrations', icon: Plug },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Sidebar({
  currentView,
  onViewChange,
  badges,
  collapsed,
  onToggleCollapse,
  onSignOut,
}: SidebarProps) {
  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden"
      style={{
        width: collapsed ? 'var(--rail-w-collapsed)' : 'var(--rail-w)',
        background: 'var(--rail)',
        borderRight: '1px solid var(--border)',
        transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* Brand + collapse toggle */}
      <div
        className="flex items-center gap-2.5 shrink-0"
        style={{
          padding: collapsed ? '20px 0 10px' : '20px 18px 10px',
          justifyContent: collapsed ? 'center' : undefined,
        }}
      >
        <div
          className="grid place-items-center rounded-full shrink-0"
          style={{ width: 32, height: 32, background: 'var(--green-soft)' }}
        >
          <span
            className="rounded-full"
            style={{ width: 14, height: 14, border: '3.5px solid var(--green)' }}
          />
        </div>
        {!collapsed && (
          <>
            <span style={{ fontSize: 17, fontWeight: 650, letterSpacing: '-0.02em' }}>Sales OS</span>
            <button
              onClick={onToggleCollapse}
              className="btn btn-ghost ml-auto"
              style={{ width: 30, height: 30, padding: 0, borderRadius: 9 }}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" strokeWidth={2} />
            </button>
          </>
        )}
      </div>

      {collapsed && (
        <button
          onClick={onToggleCollapse}
          className="btn btn-ghost mx-auto mb-1"
          style={{ width: 34, height: 34, padding: 0, borderRadius: 10 }}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="w-4 h-4" strokeWidth={2} />
        </button>
      )}

      <nav className="flex-1 overflow-y-auto overflow-x-hidden" style={{ padding: '8px 12px' }}>
        {NAV.map((group) => (
          <div key={group.head} className="mb-4">
            {collapsed ? (
              <div style={{ height: 1, background: 'var(--border)', margin: '10px 6px' }} />
            ) : (
              <div className="eyebrow px-3 mb-1.5">{group.head}</div>
            )}

            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = currentView === item.id;
                const badge = item.badgeKey ? badges[item.badgeKey] : undefined;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => onViewChange(item.id)}
                    title={collapsed ? item.label : undefined}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    className="relative flex items-center transition-colors"
                    style={{
                      gap: 11,
                      height: 40,
                      padding: collapsed ? 0 : '0 12px',
                      justifyContent: collapsed ? 'center' : undefined,
                      borderRadius: 11,
                      fontSize: 13.5,
                      fontWeight: active ? 700 : 500,
                      background: active ? 'var(--green-soft)' : 'transparent',
                      color: active ? 'var(--ink)' : 'var(--ink-3)',
                    }}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = 'var(--surface-2)';
                    }}
                    onMouseLeave={(e) => {
                      if (!active) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {/* The green marker from the reference. */}
                    {active && (
                      <span
                        className="absolute rounded-full"
                        style={{
                          left: collapsed ? 3 : -4,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: 3,
                          height: 20,
                          background: 'var(--green)',
                        }}
                      />
                    )}

                    <Icon
                      className="w-[17px] h-[17px] shrink-0"
                      strokeWidth={2}
                      style={{ color: active ? 'var(--green)' : 'var(--ink-4)' }}
                    />

                    {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}

                    {badge !== undefined &&
                      badge !== '' &&
                      (collapsed ? (
                        <span
                          className="absolute rounded-full"
                          style={{ top: 8, right: 14, width: 7, height: 7, background: 'var(--green)' }}
                        />
                      ) : (
                        <span
                          className="grid place-items-center shrink-0"
                          style={{
                            minWidth: 22,
                            height: 20,
                            padding: '0 6px',
                            borderRadius: 7,
                            fontSize: 11,
                            fontWeight: 650,
                            background: active ? 'var(--green)' : 'var(--surface-3)',
                            color: active ? '#fff' : 'var(--ink-3)',
                          }}
                        >
                          {badge}
                        </span>
                      ))}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0" style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        <button
          onClick={onSignOut}
          title={collapsed ? 'Log out' : undefined}
          aria-label="Log out"
          className="flex items-center transition-colors w-full"
          style={{
            gap: 11,
            height: 40,
            padding: collapsed ? 0 : '0 12px',
            justifyContent: collapsed ? 'center' : undefined,
            borderRadius: 11,
            fontSize: 13.5,
            fontWeight: 550,
            color: 'var(--ink-3)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <LogOut
            className="w-[17px] h-[17px] shrink-0"
            strokeWidth={2}
            style={{ color: 'var(--ink-4)' }}
          />
          {!collapsed && <span>Log out</span>}
        </button>
      </div>
    </aside>
  );
}
