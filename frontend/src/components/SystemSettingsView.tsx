import React, { useState } from 'react';
import { Database, Shield, Trash2, Loader2 } from 'lucide-react';

interface SystemSettingsViewProps {
  companyCount: number;
  onClearData: () => Promise<void>;
}

export function SystemSettingsView({ companyCount, onClearData }: SystemSettingsViewProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleClear = async () => {
    setIsClearing(true);
    try {
      await onClearData();
      setIsConfirming(false);
    } catch {
      // Surfaced by App; keep the confirmation open.
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 820 }}>
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Stored data and account security</p>
      </div>

      <div className="card overflow-hidden">
        <div className="card-head">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
            <div className="card-title">Stored data</div>
          </div>
          <span className="pill mono">{companyCount} accounts</span>
        </div>
        <div className="p-5">
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            Accounts, contacts and campaigns live in PostgreSQL and survive restarts. Clearing
            removes every saved account and everything attached to it. Your login, the cost
            ledger and the suppression list are not touched — a do-not-contact entry that a
            button could clear is not a do-not-contact list.
          </p>

          <div className="mt-4">
            {isConfirming ? (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setIsConfirming(false)} disabled={isClearing} className="btn">
                  Cancel
                </button>
                <button onClick={handleClear} disabled={isClearing} className="btn btn-danger">
                  {isClearing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" strokeWidth={2} />
                  )}
                  Yes, delete every account
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsConfirming(true)}
                disabled={companyCount === 0}
                className="btn"
                style={{ color: companyCount === 0 ? undefined : 'var(--bad)' }}
              >
                <Trash2 className="w-4 h-4" strokeWidth={2} />
                Clear generated data
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
            <div className="card-title">Accounts &amp; security</div>
          </div>
        </div>
        <div className="p-5">
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            Passwords are stored bcrypt-hashed. Sessions are signed JWTs, re-checked against the
            database on every request, so disabling an account takes effect immediately rather
            than when its token expires.
          </p>
          <div
            className="mt-4 rounded-[10px] px-3.5 py-2.5 mono text-[12px]"
            style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}
          >
            python scripts/manage_user.py set &lt;username&gt; &lt;password&gt;
          </div>
        </div>
      </div>
    </div>
  );
}
