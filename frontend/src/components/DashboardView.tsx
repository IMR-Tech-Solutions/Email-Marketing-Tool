import React from 'react';
import { DashboardResponse } from '../types';
import {
  MoreHorizontal,
  Building2,
  Target,
  Send,
  RefreshCw,
  Users,
  Database,
  Plus,
  Upload,
  ArrowUpRight,
} from 'lucide-react';

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

/** Round an axis step up to 1 / 2 / 2.5 / 5 x a power of ten. */
function niceStep(v: number): number {
  if (v <= 1) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/**
 * Stat card: pastel icon tile, big figure, quiet label, and a "..." that
 * opens the screen behind the number.
 */
function Stat({
  label,
  value,
  note,
  icon: Icon,
  tile,
  onOpen,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ElementType;
  tile: string;
  onOpen: () => void;
}) {
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div className="flex items-start gap-3.5">
        <span className={`icon-tile ${tile}`}>
          <Icon className="w-[22px] h-[22px]" strokeWidth={2} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="figure" style={{ fontSize: 26, lineHeight: 1.15 }}>
            {value}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 1 }}>{label}</div>
        </div>

        <button onClick={onOpen} className="corner-btn -mr-1.5 -mt-1" aria-label={`Open ${label}`}>
          <MoreHorizontal className="w-4 h-4" strokeWidth={2.2} />
        </button>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 12 }}>{note}</div>
    </div>
  );
}

/**
 * Donut ring. Segments run clockwise from twelve, an icon sits in the well,
 * and anything left over shows as a pale track.
 */
function Ring({
  segments,
  size = 156,
  thickness = 17,
  icon: Icon,
  hatched,
}: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  icon: React.ElementType;
  hatched?: boolean;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0);

  let offset = 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <pattern id="ring-hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--border-strong)" strokeWidth="2.6" />
          </pattern>
        </defs>

        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={hatched || total === 0 ? 'url(#ring-hatch)' : 'var(--surface-3)'}
          strokeWidth={thickness}
        />

        {total > 0 &&
          segments.map((seg, i) => {
            if (seg.value <= 0) return null;
            const len = (seg.value / total) * c;
            const dash = <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
            />;
            offset += len;
            return dash;
          })}
      </svg>

      {/* The well: a soft disc with the section icon. */}
      <span
        className="absolute grid place-items-center rounded-full"
        style={{
          inset: thickness + 10,
          background: 'var(--surface-2)',
          color: 'var(--ink-4)',
          boxShadow: 'inset 0 0 0 1px var(--border)',
        }}
      >
        <Icon className="w-5 h-5" strokeWidth={2} />
      </span>
    </div>
  );
}

/** Legend entry: colour dot, label, and the count in ink. */
function Key({ color, label, value }: { color: string; label: string; value?: number | string }) {
  return (
    <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
      <span className="rounded-full shrink-0" style={{ width: 8, height: 8, background: color }} />
      {label}
      {value !== undefined && (
        <span className="figure" style={{ fontSize: 12.5, color: 'var(--ink)' }}>
          {value}
        </span>
      )}
    </span>
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
  const peak = Math.max(1, ...data.growth.map((g) => Math.max(g.added, g.retouched)));
  const step = niceStep(peak / 3);
  const axisMax = step * 3;
  const stages = Object.entries(data.stages).sort(
    (a, b) => Object.keys(STAGE_LABELS).indexOf(a[0]) - Object.keys(STAGE_LABELS).indexOf(b[0]),
  );
  const topClients = data.campaignRows.slice(0, 5);

  // Share of clients that have been worked at all - the ring.
  const worked = stages.filter(([s]) => s !== 'lead').reduce((sum, [, n]) => sum + n, 0);
  const workedPct = data.totalCompanies ? Math.round((worked / data.totalCompanies) * 100) : 0;

  const PLOT = 168; // px of plot area the bars scale into

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
          icon={Building2}
          tile="tile-violet"
          onOpen={() => onNavigate('companies')}
        />
        <Stat
          label="Qualified"
          value={data.qualifiedCompanies.toLocaleString()}
          note={`ICP score at or above ${data.qualifiedThreshold}`}
          icon={Target}
          tile="tile-sky"
          onOpen={() => onNavigate('companies')}
        />
        <Stat
          label="Campaigns Drafted"
          value={data.campaigns.toLocaleString()}
          note="Ready to send"
          icon={Send}
          tile="tile-orange"
          onOpen={() => onNavigate('outreach')}
        />
        <Stat
          label="Needs Retouch"
          value={data.needsRetouch.toLocaleString()}
          note="Decayed and depended on"
          icon={RefreshCw}
          tile="tile-pink"
          onOpen={() => onNavigate('retouch')}
        />
      </div>

      {/* Activity chart + pipeline ring */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.85fr_1fr] gap-4 items-start">

        <div className="card">
          <div className="card-head">
            <span className="card-title">Client Activity</span>
            <div className="flex items-center gap-2">
              {modelLarge && <span className="pill mono">{modelLarge}</span>}
              <span className="pill">Last 12 months</span>
            </div>
          </div>

          <div className="p-5 flex flex-col xl:flex-row gap-6">

            {/* Grouped bars on a dashed grid */}
            <div className="flex-1 min-w-0">
              <div className="relative" style={{ height: PLOT, paddingLeft: 42 }}>
                {/* y axis - each label centred on its gridline */}
                {[3, 2, 1, 0].map((i) => (
                  <span
                    key={i}
                    className="absolute text-right"
                    style={{
                      left: 0,
                      width: 32,
                      top: (PLOT / 3) * (3 - i),
                      transform: 'translateY(-50%)',
                      fontSize: 11,
                      lineHeight: 1,
                      color: 'var(--ink-4)',
                    }}
                  >
                    {(step * i).toLocaleString()}
                  </span>
                ))}

                {/* plot */}
                <div className="relative h-full min-w-0">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className="absolute left-0 right-0"
                      style={{
                        top: (PLOT / 3) * i,
                        borderTop: '1px dashed var(--border-strong)',
                        opacity: i === 3 ? 0 : 1,
                      }}
                    />
                  ))}
                  <span
                    className="absolute left-0 right-0"
                    style={{ top: PLOT, borderTop: '1px solid var(--border-strong)' }}
                  />

                  <div className="absolute inset-x-0 flex items-end justify-between" style={{ top: 0, height: PLOT }}>
                    {data.growth.map((point, i) => {
                      const total = point.added + point.retouched;
                      const addedH = Math.round((point.added / axisMax) * PLOT);
                      const retouchH = Math.round((point.retouched / axisMax) * PLOT);
                      return (
                        <div
                          key={`${point.month}-${i}`}
                          className="flex-1 flex items-end justify-center gap-[3px] h-full"
                          title={`${point.month} · ${point.added} added · ${point.retouched} retouched`}
                        >
                          {total === 0 ? (
                            <div
                              className="hatch"
                              style={{
                                width: 8,
                                height: EMPTY_HEIGHTS[i % EMPTY_HEIGHTS.length],
                                borderRadius: 999,
                              }}
                            />
                          ) : (
                            <>
                              <div
                                style={{
                                  width: 8,
                                  height: Math.max(point.added > 0 ? 8 : 0, addedH),
                                  background: 'var(--mint)',
                                  borderRadius: 999,
                                }}
                              />
                              <div
                                style={{
                                  width: 8,
                                  height: Math.max(point.retouched > 0 ? 8 : 0, retouchH),
                                  background: 'var(--brand)',
                                  borderRadius: 999,
                                }}
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* x axis */}
              <div className="flex" style={{ paddingLeft: 42 }}>
                <div className="flex-1 flex justify-between">
                  {data.growth.map((p, i) => (
                    <div
                      key={`${p.month}-label-${i}`}
                      className="flex-1 text-center"
                      style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 550 }}
                    >
                      {p.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-4 mt-4">
                <Key color="var(--mint)" label="Added" />
                <Key color="var(--brand)" label="Retouched" />
                <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  <span className="hatch rounded-full shrink-0" style={{ width: 8, height: 8 }} />
                  No activity
                </span>
              </div>
            </div>

            {/* Pipeline ring, tucked beside the bars like the reference */}
            <div className="shrink-0 flex flex-col items-center justify-center xl:w-[212px] gap-3">
              <div className="relative">
                <span className="tip absolute -top-1 -left-2 z-10">{workedPct}%</span>
                <Ring
                  icon={Users}
                  segments={[
                    { value: worked, color: 'var(--brand)' },
                    { value: Math.max(0, data.totalCompanies - worked), color: 'var(--mint)' },
                  ]}
                />
              </div>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                <Key color="var(--brand)" label="Worked" value={worked} />
                <Key color="var(--mint)" label="Untouched" value={Math.max(0, data.totalCompanies - worked)} />
              </div>
              <button
                onClick={() => onNavigate('crm_board')}
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand)' }}
              >
                Open deal board
              </button>
            </div>
          </div>
        </div>

        {/* Database health ring */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">Database Health</span>
            <button
              onClick={() => onNavigate(data.needsRetouch > 0 ? 'retouch' : 'companies')}
              className="corner-btn"
              aria-label="Open database health"
            >
              <MoreHorizontal className="w-4 h-4" strokeWidth={2.2} />
            </button>
          </div>

          <div className="p-5 flex flex-col items-center">
            <Ring
              icon={Database}
              segments={data.freshness.map((b, i) => ({ value: b.count, color: BAND_COLORS[i] }))}
              hatched={totalRecords === 0}
            />

            <div className="figure mt-4" style={{ fontSize: 22 }}>
              {totalRecords.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>records tracked</div>

            <div className="grid grid-cols-2 gap-x-5 gap-y-2 mt-4 w-full">
              {data.freshness.map((b, i) => (
                <Key key={b.band} color={BAND_COLORS[i]} label={BAND_LABELS[b.band]} value={b.count.toLocaleString()} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Next action + clients + spend */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr_1fr] gap-4 items-stretch">

        {/* Next action */}
        <div className="card flex flex-col" style={{ padding: '18px 20px' }}>
          <div className="flex items-center justify-between gap-3">
            <span className="card-title">Next action</span>
            {data.actions.length > 1 && (
              <span className="pill pill-brand">{data.actions.length} queued</span>
            )}
          </div>

          {data.actions.length > 0 ? (
            <>
              <p style={{ fontSize: 18, fontWeight: 650, lineHeight: 1.35, marginTop: 14, textWrap: 'pretty' }}>
                {data.actions[0].title}
              </p>
              <p
                style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.6, textWrap: 'pretty' }}
              >
                {data.actions[0].why}
              </p>
              <button
                onClick={() => onNavigate(data.actions[0].view)}
                className="btn btn-primary w-full mt-auto"
                style={{ marginTop: 18 }}
              >
                {data.actions[0].action}
                <ArrowUpRight className="w-4 h-4" strokeWidth={2.4} />
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
              style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--brand)' }}
            >
              +{data.actions.length - 1} more in the queue
            </button>
          )}
        </div>

        {/* Top clients */}
        <div className="card flex flex-col">
          <div className="card-head">
            <span className="card-title">Top Clients</span>
            <button onClick={() => onNavigate('companies')} className="btn btn-sm btn-ghost">
              View all
            </button>
          </div>

          <div className="px-5 py-3 flex-1">
            <div className="flex items-center justify-between eyebrow pb-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
              <span>Client</span>
              <span>ICP</span>
            </div>

            {topClients.length === 0 ? (
              <div className="flex flex-col gap-2.5 mt-3.5">
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
              <div className="flex flex-col">
                {topClients.map((row) => (
                  <div
                    key={row.companyId}
                    className="flex items-center gap-2.5 py-2.5"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <div
                      className="grid place-items-center rounded-full shrink-0"
                      style={{
                        width: 30,
                        height: 30,
                        background: 'var(--brand-soft)',
                        color: 'var(--brand)',
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
                    <span className="figure shrink-0" style={{ fontSize: 14 }}>
                      {row.icpScore}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Spend - the violet accent card */}
        <div className="card-brand flex flex-col" style={{ padding: '20px 22px' }}>
          {/* the lighter band from the reference */}
          <span
            className="absolute inset-y-0 right-0 pointer-events-none"
            style={{ width: '38%', background: 'rgba(255,255,255,0.07)' }}
          />

          <div className="relative flex items-start justify-between gap-3">
            <span className="card-title" style={{ color: '#fff' }}>Spend</span>
            <button
              onClick={() => onNavigate('cost')}
              className="corner-btn corner-btn-on-dark -mr-1.5"
              aria-label="Open cost"
            >
              <MoreHorizontal className="w-4 h-4" strokeWidth={2.2} />
            </button>
          </div>

          <div className="relative figure" style={{ fontSize: 32, color: '#fff', marginTop: 14 }}>
            {usd(data.totalCostUsd)}
          </div>
          <p className="relative" style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>
            Measured from real token usage
          </p>

          <div className="relative mt-5 flex flex-col gap-2.5" style={{ fontSize: 12.5 }}>
            <div className="flex justify-between">
              <span style={{ color: 'rgba(255,255,255,0.72)' }}>Per client</span>
              <span className="mono" style={{ color: '#fff' }}>{usd(data.costPerCompany)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'rgba(255,255,255,0.72)' }}>Per qualified</span>
              <span className="mono" style={{ color: '#fff' }}>{usd(data.costPerQualified)}</span>
            </div>
          </div>

          <button
            onClick={() => onNavigate('cost')}
            className="btn w-full mt-auto relative"
            style={{
              marginTop: 20,
              background: 'rgba(255,255,255,0.16)',
              borderColor: 'transparent',
              color: '#fff',
              boxShadow: 'none',
            }}
          >
            Full breakdown
          </button>
        </div>
      </div>
    </div>
  );
}
