import React, { useState } from 'react';
import { CrmConfig } from '../types';
import { AlertTriangle, Loader2, Link2, CheckCircle2 } from 'lucide-react';

interface CrmSettingsViewProps {
  crmConfig: CrmConfig;
  onUpdateConfig: (config: CrmConfig) => void;
}

export function CrmSettingsView({ crmConfig, onUpdateConfig }: CrmSettingsViewProps) {
  const [apiKey, setApiKey] = useState(crmConfig.apiKey);
  const [provider, setProvider] = useState<'salesforce' | 'hubspot'>(
    crmConfig.provider || 'salesforce',
  );
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const connected = crmConfig.status === 'connected';

  const handleConnect = () => {
    if (!apiKey) return;
    setIsAuthenticating(true);
    setTimeout(() => {
      onUpdateConfig({ ...crmConfig, provider, apiKey, status: 'connected', enabled: true });
      setIsAuthenticating(false);
    }, 900);
  };

  const WATERFALL: [string, string, string][] = [
    ['1', 'Internal database', 'Free, always first'],
    ['2', 'Claude research', 'The only live source in this build'],
    ['3', 'Paid data provider', 'Not wired up'],
    ['4', 'Email verification', 'Not wired up'],
  ];

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 820 }}>
      <div>
        <h1 className="page-title">Integrations</h1>
        <p className="page-sub">Every external system sits behind an adapter</p>
      </div>

      <div
        className="card p-4 flex items-start gap-3"
        style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn-border)' }}
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2} style={{ color: 'var(--warn)' }} />
        <div>
          <div className="text-[13.5px] font-semibold mb-1">This connection is simulated</div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            Connecting stores the settings and logs a push during a run. No record leaves the
            server and no credential is sent anywhere. The adapter seam exists so a real
            Salesforce or HubSpot client can be dropped in without touching product code.
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-head">
          <div className="card-title">CRM connection</div>
          {connected && (
            <span className="pill pill-good">
              <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />
              Connected
            </span>
          )}
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12.5px] font-medium mb-1.5">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'salesforce' | 'hubspot')}
              disabled={connected}
              className="field"
            >
              <option value="salesforce">Salesforce</option>
              <option value="hubspot">HubSpot</option>
            </select>
          </div>

          <div>
            <label className="block text-[12.5px] font-medium mb-1.5">API key</label>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={connected}
                placeholder="Enter API key"
                className="field"
              />
              {connected ? (
                <button
                  onClick={() => {
                    onUpdateConfig({ ...crmConfig, status: 'disconnected', enabled: false, apiKey: '' });
                    setApiKey('');
                  }}
                  className="btn"
                  style={{ color: 'var(--bad)', whiteSpace: 'nowrap' }}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={!apiKey || isAuthenticating}
                  className="btn btn-primary"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {isAuthenticating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Link2 className="w-4 h-4" strokeWidth={2} />
                  )}
                  Connect
                </button>
              )}
            </div>
          </div>
        </div>

        <div
          className="px-5 py-4 flex items-center justify-between gap-4"
          style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}
        >
          <div>
            <div className="text-[13.5px] font-medium">Automatic sync</div>
            <div className="text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
              Push new accounts at the end of every run
            </div>
          </div>
          <button
            onClick={() => connected && onUpdateConfig({ ...crmConfig, enabled: !crmConfig.enabled })}
            disabled={!connected}
            className="rounded-full transition-colors shrink-0"
            style={{
              width: 42,
              height: 24,
              padding: 3,
              background: crmConfig.enabled ? 'var(--green)' : 'var(--border-strong)',
              opacity: connected ? 1 : 0.45,
              cursor: connected ? 'pointer' : 'not-allowed',
            }}
            aria-label="Toggle automatic sync"
          >
            <span
              className="block rounded-full bg-white transition-transform"
              style={{
                width: 18,
                height: 18,
                transform: crmConfig.enabled ? 'translateX(18px)' : 'none',
              }}
            />
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Provider waterfall</div>
        </div>
        <div className="p-5 flex flex-col gap-3">
          {WATERFALL.map(([n, name, note]) => (
            <div key={n} className="flex items-center gap-3 text-[13px]">
              <span
                className="grid place-items-center rounded-full mono text-[11px] shrink-0"
                style={{ width: 22, height: 22, background: 'var(--surface-3)', color: 'var(--ink-3)' }}
              >
                {n}
              </span>
              <span className="flex-1 font-medium">{name}</span>
              <span style={{ color: 'var(--ink-3)' }}>{note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
