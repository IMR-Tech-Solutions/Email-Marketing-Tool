import React from 'react';
import { DashboardResponse } from '../types';
import { ArrowUpRight, TrendingUp, Plus, Upload } from 'lucide-react';

interface DashboardViewProps {
  data: DashboardResponse | null;
  isLoading: boolean;
  onNavigate: (view: string) => void;
  modelLarge?: string;
}

const BAND_COLORS = [
  'var(--fresh-1)',
  'var(--fresh-2)',
  'var(--fresh-3)',
  'var(--fresh-4)',
  'var(--fresh-5)',
];

const BAND_LABELS: Record<string, string> = {
  fresh: 'Fresh',
  good: 'Good',
  aging: 'Aging',
  stale: 'Stale',
  critical: 'Critical',
};

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  contacted: 'Contacted',
  engaged: 'Engaged',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
};

/** Fixed silhouette for the empty activity chart - deliberate, not random. */
const EMPTY_HEIGHTS = [54, 72, 46, 88, 63, 100, 58, 78, 50, 92, 68, 84];

function usd(v: number): string {
  if (!v) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

/** Stat card: label + circular action, big figure, delta line. Dark = primary. */
function Stat({
  label,
  value,
  note,
  dark,
  onOpen,
}: {
  label: string;
  value: string;
  note: string;
  dark?: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      className={dark ? 'card-dark' : 'card'}
      style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 650,
            color: dark ? 'rgba(255,255,255,0.92)' : 'var(--ink-2)',
          }}
        >
          {label}
        </span>
        <button
          onClick={onOpen}
          className={dark ? 'corner-btn corner-btn-on-dark' : 'corner-btn'}
          aria-label={`Open ${label}`}
        >
          <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2.4} />
        </button>
      </div>

      <div className="figure" style={{ fontSize: 38, color: dark ? '#fff' : 'var(--ink)' }}>
        {value}
      </div>

      <div
        className="flex items-center gap-1.5"
        style={{ fontSize: 11.5, color: dark ? 'rgba(255,255,255,0.7)' : 'var(--ink-4)' }}
      >
        <span
          className="grid place-items-center rounded shrink-0"
          style={{
            width: 15,
            height: 15,
            background: dark ? 'rgba(255,255,255,0.18)' : 'var(--green-soft)',
            color: dark ? '#fff' : 'var(--green)',
          }}
        >
          <TrendingUp className="w-2.5 h-2.5" strokeWidth={3} />
        </span>
        {note}
      </div>
    </div>
  );
}

export function DashboardView({ data, isLoading, onNavigate, modelLarge }: DashboardViewProps) {
  if (!data) {
    return (
      <div className="py-24 text-center" style={{ color: 'var(--ink-4)' }}>
        {isLoading ? 'Loading workspace…' : 'No data'}
      </div>
    );
  }

  const totalRecords = data.freshness.reduce((s, b) => s + b.count, 0);
  const peak = Math.max(1, ...data.growth.map((g) => g.added + g.retouched));
  const stages = Object.entries(data.stages).sort(
    (a, b) => Object.keys(STAGE_LABELS).indexOf(a[0]) - Object.keys(STAGE_LABELS).indexOf(b[0]),
  );
  const topClients = data.campaignRows.slice(0, 5);

  // Share of clients that have been worked at all — the arc gauge.
  const worked = stages
    .filter(([s]) => s !== 'lead')
    .reduce((sum, [, n]) => sum + n, 0);
  const workedPct = data.totalCompanies ? Math.round((worked / data.totalCompanies) * 100) : 0;

  // Semicircle gauge geometry.
  const R = 74;
  const CIRC = Math.PI * R;

  return (
    <div className="flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Find clients, send outreach, and handle the replies.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => onNavigate('run')} className="btn btn-primary">
            <Plus className="w-4 h-4" strokeWidth={2.6} />
            Find clients
          </button>
          <button onClick={() => onNavigate('companies')} className="btn">
            <Upload className="w-4 h-4" strokeWidth={2.2} />
            Send outreach
          </button>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Total Clients"
          value={data.totalCompanies.toLocaleString()}
          note={
            data.addedThisMonth > 0
              ? `${data.addedThisMonth} added this month`
              : 'None added this month'
          }
          dark
          onOpen={() => onNavigate('companies')}
        />
        <Stat
          label="Qualified"
          value={data.qualifiedCompanies.toLocaleString()}
          note={`ICP ≥ ${data.qualifiedThreshold}`}
          onOpen={() => onNavigate('companies')}
        />
        <Stat
          label="Campaigns Drafted"
          value={data.campaigns.toLocaleString()}
          note="Ready to send"
          onOpen={() => onNavigate('outreach')}
        />
        <Stat
          label="Needs Retouch"
          value={data.needsRetouch.toLocaleString()}
          note="Decayed and depended on"
          onOpen={() => onNavigate('retouch')}
        />
      </div>

      {/* Activity + action + clients */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr_1fr] gap-4 items-start">

        {/* Activity chart */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="card-title">Client Activity</span>
            {modelLarge && <span className="pill mono">{modelLarge}</span>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-4)' }}>Added and re-verified, last 12 months</p>

          <div className="grid grid-cols-12 gap-2 items-end mt-5" style={{ height: 150 }}>
            {data.growth.map((point, i) => {
              const total = point.added + point.retouched;
              const h = Math.round((total / peak) * 130);
              const addedH = total ? Math.round((point.added / total) * h) : 0;
              return (
                <div
                  key={point.month}
                  className="h-full flex flex-col justify-end"
                  title={`${point.month} · ${point.added} added · ${point.retouched} retouched`}
                >
                  {total === 0 ? (
                    /* Hatching marks a month with nothing in it. Heights are
                       varied so an empty chart still reads as a chart. */
                    <div
                      className="hatch"
                      style={{ height: EMPTY_HEIGHTS[i % EMPTY_HEIGHTS.length], borderRadius: 999 }}
                    />
                  ) : (
                    <div
                      className="flex flex-col overflow-hidden"
                      style={{ height: Math.max(18, h), borderRadius: 999 }}
                    >
                      {point.added > 0 && (
                        <div style={{ height: Math.max(6, addedH), background: 'var(--green-light)' }} />
                      )}
                      <div style={{ flex: 1, background: 'var(--green)' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div
            className="grid grid-cols-12 gap-2 mt-2.5 text-center"
            style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 550 }}
          >
            {data.growth.map((p, i) => (
              <div key={`${p.month}-${i}`}>{p.label}</div>
            ))}
          </div>

          <div className="flex gap-4 mt-4" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            <span className="flex items-center gap-1.5">
              <span className="rounded-full" style={{ width: 9, height: 9, background: 'var(--green-light)' }} />
              Added
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded-full" style={{ width: 9, height: 9, background: 'var(--green)' }} />
              Retouched
            </span>
            <span className="flex items-center gap-1.5">
              <span className="hatch rounded-full" style={{ width: 9, height: 9 }} />
              No activity
            </span>
          </div>
        </div>

        {/* Next action */}
        <div className="card flex flex-col" style={{ padding: '18px 20px' }}>
          <span className="card-title">Next action</span>

          {data.actions.length > 0 ? (
            <>
              <p
                style={{ fontSize: 17, fontWeight: 650, lineHeight: 1.35, marginTop: 12, textWrap: 'pretty' }}
              >
                {data.actions[0].title}
              </p>
              <p
                style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.55, textWrap: 'pretty' }}
              >
                {data.actions[0].why}
              </p>
              <button
                onClick={() => onNavigate(data.actions[0].view)}
                className="btn btn-primary w-full mt-auto"
                style={{ marginTop: 18 }}
              >
                {data.actions[0].action}
              </button>
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 12 }}>
              Nothing needs you right now.
            </p>
          )}

          {data.actions.length > 1 && (
            <button
              onClick={() => onNavigate('queue')}
              className="mt-3"
              style={{ fontSize: 12.5, fontWeight: 550, color: 'var(--green)' }}
            >
              +{data.actions.length - 1} more in the queue
            </button>
          )}
        </div>

        {/* Top clients */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className="card-title">Top Clients</span>
            <button onClick={() => onNavigate('companies')} className="btn btn-sm">
              View all
            </button>
          </div>

          {topClients.length === 0 ? (
            <div className="flex flex-col gap-2.5 mt-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="hatch rounded-full shrink-0" style={{ width: 30, height: 30 }} />
                  <span className="hatch" style={{ height: 9, borderRadius: 999, flex: 1 }} />
                </div>
              ))}
              <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4 }}>
                Your best-fit clients appear here after discovery.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {topClients.map((row) => (
                <div key={row.companyId} className="flex items-center gap-2.5">
                  <div
                    className="grid place-items-center rounded-full shrink-0"
                    style={{
                      width: 30,
                      height: 30,
                      background: 'var(--green-soft)',
                      color: 'var(--green)',
                      fontSize: 11.5,
                      fontWeight: 650,
                    }}
                  >
                    {row.company.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ fontSize: 13, fontWeight: 550 }}>
                      {row.company}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {STAGE_LABELS[row.stage] ?? row.stage}
                    </div>
                  </div>
                  <span className="mono shrink-0" style={{ fontSize: 12.5, fontWeight: 550 }}>
                    {row.icpScore}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Health + gauge + spend */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr_1fr] gap-4 items-start">

        {/* Database health */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <span className="card-title">Database Health</span>
            <button
              onClick={() => onNavigate(data.needsRetouch > 0 ? 'retouch' : 'companies')}
              className="btn btn-sm"
            >
              {data.needsRetouch > 0 ? `Review ${data.needsRetouch}` : 'Open clients'}
            </button>
          </div>

          {totalRecords === 0 ? (
            <div className="flex gap-1 mb-4" style={{ height: 10 }}>
              <div className="hatch flex-1" style={{ borderRadius: 999 }} />
            </div>
          ) : (
            <div className="flex gap-1 mb-4" style={{ height: 10 }}>
              {data.freshness.map((b, i) =>
                b.count > 0 ? (
                  <div
                    key={b.band}
                    title={`${BAND_LABELS[b.band]}: ${b.count}`}
                    style={{
                      width: `${(b.count / totalRecords) * 100}%`,
                      background: BAND_COLORS[i],
                      borderRadius: 999,
                    }}
                  />
                ) : null,
              )}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {data.freshness.map((b, i) => (
              <div key={b.band}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="rounded-full" style={{ width: 8, height: 8, background: BAND_COLORS[i] }} />
                  <span style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 550 }}>
                    {BAND_LABELS[b.band]}
                  </span>
                </div>
                <div className="figure" style={{ fontSize: 18 }}>{b.count.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline gauge */}
        <div className="card flex flex-col items-center" style={{ padding: '18px 20px' }}>
          <span className="card-title self-start">Pipeline Progress</span>

          <svg width="176" height="108" viewBox="0 0 176 108" className="mt-3" role="img" aria-label={`${workedPct}% of clients worked`}>
            <defs>
              <pattern id="dash-hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="7" stroke="var(--border-strong)" strokeWidth="2.4" />
              </pattern>
            </defs>
            <path
              d={`M 14 96 A ${R} ${R} 0 0 1 162 96`}
              fill="none"
              stroke="url(#dash-hatch)"
              strokeWidth="21"
              strokeLinecap="round"
            />
            {workedPct > 0 && (
              <path
                d={`M 14 96 A ${R} ${R} 0 0 1 162 96`}
                fill="none"
                stroke="var(--green)"
                strokeWidth="21"
                strokeLinecap="round"
                strokeDasharray={`${(workedPct / 100) * CIRC} ${CIRC}`}
              />
            )}
            <text
              x="88"
              y="82"
              textAnchor="middle"
              style={{ fontSize: 28, fontWeight: 650, fill: 'var(--ink)', letterSpacing: '-0.03em' }}
            >
              {workedPct}%
            </text>
          </svg>

          <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>
            {worked} of {data.totalCompanies} clients worked
          </p>

          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-3" style={{ fontSize: 11.5 }}>
            {stages.length === 0 ? (
              <span style={{ color: 'var(--ink-4)' }}>Nothing on the board yet</span>
            ) : (
              stages.map(([stage, count], i) => (
                <span key={stage} className="flex items-center gap-1.5" style={{ color: 'var(--ink-3)' }}>
                  <span
                    className="rounded-full"
                    style={{ width: 7, height: 7, background: BAND_COLORS[i % BAND_COLORS.length] }}
                  />
                  {STAGE_LABELS[stage] ?? stage}
                  <span style={{ fontWeight: 650, color: 'var(--ink)' }}>{count}</span>
                </span>
              ))
            )}
          </div>
        </div>

        {/* Spend */}
        <div className="card-dark flex flex-col" style={{ padding: '18px 20px' }}>
          <span className="card-title" style={{ color: '#fff' }}>Spend</span>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
            Measured from real token usage
          </p>

          <div className="figure" style={{ fontSize: 34, color: '#fff', marginTop: 16 }}>
            {usd(data.totalCostUsd)}
          </div>

          <div className="mt-4 flex flex-col gap-2" style={{ fontSize: 12.5 }}>
            <div className="flex justify-between">
              <span style={{ color: 'rgba(255,255,255,0.65)' }}>Per client</span>
              <span className="mono" style={{ color: '#fff' }}>{usd(data.costPerCompany)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'rgba(255,255,255,0.65)' }}>Per qualified</span>
              <span className="mono" style={{ color: '#fff' }}>{usd(data.costPerQualified)}</span>
            </div>
          </div>

          <button
            onClick={() => onNavigate('cost')}
            className="btn w-full mt-auto"
            style={{ marginTop: 18, background: 'rgba(255,255,255,0.12)', borderColor: 'transparent', color: '#fff' }}
          >
            Full breakdown
          </button>
        </div>
      </div>
    </div>
  );
}
