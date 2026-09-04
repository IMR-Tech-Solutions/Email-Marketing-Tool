import React from 'react';
import { RetouchResponse } from '../types';
import { RefreshCw, ArrowRight } from 'lucide-react';

interface RetouchViewProps {
  data: RetouchResponse | null;
  isLoading: boolean;
  onNavigate: (view: string) => void;
}

const SEVERITY: Record<string, string> = {
  high: 'pill pill-bad',
  medium: 'pill pill-warn',
  low: 'pill',
};

function usd(v: number): string {
  if (!v) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(2)}`;
}

export function RetouchView({ data, isLoading, onNavigate }: RetouchViewProps) {
  if (!data) {
    return (
      <div className="py-24 text-center text-[13.5px]" style={{ color: 'var(--ink-4)' }}>
        {isLoading ? 'Loading…' : 'No data'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 1000 }}>
      <div>
        <h1 className="page-title">Database Retouch</h1>
        <p className="page-sub">
          {data.totalRecords} records · {data.flagged} flagged · priority-ordered, not calendar-driven
        </p>
      </div>

      <div className="card p-5">
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          <span className="font-medium">
            Re-enriching every record on a schedule is the expensive way to be wrong.
          </span>{' '}
          A record is only touched when its freshness has decayed <em>and</em> something
          depends on it — an active deal, or a high ICP score. Everything else waits.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {[
          ['Flagged for retouch', String(data.flagged), `of ${data.totalRecords} records`],
          ['Estimated cost', usd(data.estimatedCostUsd), `${usd(data.costPerRecordUsd)} per record`],
          ['Saved vs full refresh', usd(data.savedVersusFullRefreshUsd), 'By not touching everything'],
        ].map(([label, value, note], i) => (
          <div key={label} className="card p-4 rise" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="text-[12.5px] font-medium mb-3" style={{ color: 'var(--ink-3)' }}>
              {label}
            </div>
            <div className="mono text-[24px] font-semibold tracking-[-0.03em] leading-none">{value}</div>
            <div className="mt-2 text-[12px]" style={{ color: 'var(--ink-3)' }}>{note}</div>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="card-head">
          <div className="card-title">What needs attention</div>
          <span className="pill mono">{data.smallModel}</span>
        </div>

        {data.issues.length === 0 ? (
          <div className="p-12 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
            Nothing is decayed enough to be worth money right now.
          </div>
        ) : (
          <table className="w-full">
            <thead className="thead">
              <tr>
                <th className="text-left font-medium px-5 py-2.5">Issue</th>
                <th className="text-right font-medium px-3 py-2.5">Records</th>
                <th className="text-left font-medium px-3 py-2.5">Severity</th>
                <th className="text-left font-medium px-5 py-2.5">Resolution</th>
              </tr>
            </thead>
            <tbody>
              {data.issues.map((issue) => (
                <tr key={issue.issue} className="trow">
                  <td className="px-5 py-3.5 text-[13px]">{issue.issue}</td>
                  <td className="px-3 py-3.5 text-right mono text-[13px] font-medium">{issue.count}</td>
                  <td className="px-3 py-3.5">
                    <span className={SEVERITY[issue.severity]}>{issue.severity}</span>
                  </td>
                  <td className="px-5 py-3.5 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                    {issue.resolution}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {data.flagged > 0 && (
          <div className="px-5 py-4" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span className="text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                Enrichment runs per account from the Accounts screen, so you approve each one.
              </span>
              <button onClick={() => onNavigate('companies')} className="btn btn-primary">
                <RefreshCw className="w-4 h-4" strokeWidth={2} />
                Open the retouch queue
                <ArrowRight className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Refresh policy</div>
        </div>
        <div className="p-5 flex flex-col gap-2.5">
          {data.refreshPolicy.map((rule) => (
            <div key={rule.band} className="flex items-center justify-between gap-4 text-[13px]">
              <span style={{ color: 'var(--ink-3)' }}>{rule.band}</span>
              <span className="font-medium">{rule.interval}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
