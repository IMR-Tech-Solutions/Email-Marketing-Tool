import React, { useState } from 'react';
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  ArrowRight,
  PenLine,
  Check,
  MapPin,
  Globe,
  Search,
  Factory,
  Layers,
} from 'lucide-react';
import { ICP_PRESETS, CUSTOM_TEMPLATE, IcpPreset } from '../lib/icpPresets';
import { INDUSTRY_GROUPS } from '../lib/industries';
import { GeoScope, SearchArea, IndustryMode, IndustryFilter } from '../types';

interface RunAgentsViewProps {
  onRunPipeline: (
    icp: string,
    count: number,
    location?: SearchArea,
    industry?: IndustryFilter,
  ) => Promise<void>;
  isGenerating: boolean;
  modelLarge?: string;
  modelSmall?: string;
  claudeReady: boolean;
}

const STEPS = [
  { label: 'Discovery', tier: 'Large' },
  { label: 'Research', tier: 'Large' },
  { label: 'ICP scoring', tier: 'Large' },
  { label: 'Personalization', tier: 'Large' },
];

/** What one client actually cost on a measured run - beats guessing. */
const COST_PER_CLIENT = 0.06;

const GROUPS = Array.from(new Set(ICP_PRESETS.map((p) => p.group)));

const SCOPES: { id: GeoScope; label: string }[] = [
  { id: 'city', label: 'City' },
  { id: 'state', label: 'State' },
  { id: 'country', label: 'Country' },
  { id: 'global', label: 'Worldwide' },
];

/** Quick picks per scope. The field is free text — these just save typing. */
const SUGGESTIONS: Record<GeoScope, string[]> = {
  city: ['Pune', 'Mumbai', 'Bengaluru', 'Delhi', 'Hyderabad', 'Chennai'],
  state: ['Maharashtra', 'Karnataka', 'Tamil Nadu', 'Gujarat', 'California'],
  country: ['India', 'United States', 'United Kingdom', 'Germany', 'Singapore'],
  global: [],
};

const PLACEHOLDER: Record<GeoScope, string> = {
  city: 'Pune',
  state: 'Maharashtra',
  country: 'India',
  global: '',
};

const INDUSTRY_MODES: { id: IndustryMode; label: string; hint: string }[] = [
  { id: 'all', label: 'All industries', hint: 'No sector constraint' },
  { id: 'preset', label: 'Pick a sector', hint: 'Choose from the list' },
  { id: 'custom', label: 'Custom', hint: 'Type your own' },
];

/* ------------------------------------------------------------------ */
/* Rail primitives                                                     */
/* ------------------------------------------------------------------ */

/** A titled card in the right rail. Same shell as the main cards, tighter. */
function RailCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="card-head" style={{ padding: '12px 14px' }}>
        <div className="card-title" style={{ fontSize: 13 }}>
          {title}
        </div>
        {badge}
      </div>
      <div className="p-3.5 flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

/**
 * One selectable row. The rail is 300px wide, so the horizontal segmented
 * control used elsewhere does not fit — these stack instead and stay legible.
 */
function ChoiceRow({
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  label: string;
  /** The longer description. A tooltip, not a second line — six presets each
   *  carrying a subtitle made the rail twice the height of the brief. */
  title?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className="text-left transition-colors w-full flex items-center gap-1.5"
      style={{
        padding: '7px 11px',
        borderRadius: 10,
        border: `1px solid ${active ? 'var(--green)' : 'var(--border)'}`,
        background: active ? 'var(--green-soft)' : 'var(--surface)',
      }}
    >
      <span className="truncate" style={{ fontSize: 12.5, fontWeight: 550 }}>
        {label}
      </span>
      {active && (
        <Check
          className="w-3.5 h-3.5 ml-auto shrink-0"
          strokeWidth={3}
          style={{ color: 'var(--green)' }}
        />
      )}
    </button>
  );
}

export function RunAgentsView({
  onRunPipeline,
  isGenerating,
  modelLarge,
  claudeReady,
}: RunAgentsViewProps) {
  const [icp, setIcp] = useState('');
  const [count, setCount] = useState(1);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [scope, setScope] = useState<GeoScope>('global');
  const [area, setArea] = useState('');
  const [industryMode, setIndustryMode] = useState<IndustryMode>('all');
  const [industry, setIndustry] = useState('');
  const [industryQuery, setIndustryQuery] = useState('');
  /** Whether the 51-row pick-list is open. It collapses to the chosen sector
   *  once you pick one — left open it makes the rail twice the height of the
   *  brief it sits next to, for a list nobody is reading any more. */
  const [browsing, setBrowsing] = useState(true);

  const apply = (preset: IcpPreset) => {
    setIcp(preset.text);
    setActivePreset(preset.id);
  };

  const writeOwn = () => {
    setIcp(CUSTOM_TEMPLATE);
    setActivePreset('custom');
  };

  const needsArea = scope !== 'global' && !area.trim();
  const needsIndustry = industryMode !== 'all' && !industry.trim();

  /** The pick-list, narrowed by the search box. Empty query shows everything. */
  const q = industryQuery.trim().toLowerCase();
  const industryMatches = q
    ? INDUSTRY_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((name) => name.toLowerCase().includes(q)),
      })).filter((g) => g.items.length > 0)
    : INDUSTRY_GROUPS;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!icp.trim() || isGenerating || needsArea || needsIndustry) return;
    onRunPipeline(
      icp,
      count,
      { scope, value: scope === 'global' ? '' : area.trim() },
      { mode: industryMode, value: industryMode === 'all' ? '' : industry.trim() },
    );
  };

  // The template still has its slots in it - running that wastes money.
  const unfilled = /\[[^\]]+\]/.test(icp);

  const blocked = isGenerating || !icp.trim() || needsArea || needsIndustry;

  /** Why Deploy is off. Shown next to the button, not only as a tooltip —
   *  the blocking control now lives in the rail, away from the button. */
  const blockedWhy = !icp.trim()
    ? 'Describe the audience first'
    : needsArea
      ? `Type a ${scope} on the right`
      : needsIndustry
        ? industryMode === 'preset'
          ? 'Pick a sector on the right'
          : 'Type a sector on the right'
        : undefined;

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 1140 }}>
      <div>
        <h1 className="page-title">Discover</h1>
        <p className="page-sub">
          Describe the audience in plain language. Nothing is charged until you deploy.
        </p>
      </div>

      {!claudeReady && (
        <div
          className="card p-4 flex items-start gap-3"
          style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn-border)' }}
        >
          <AlertTriangle
            className="w-4 h-4 mt-0.5 shrink-0"
            strokeWidth={2}
            style={{ color: 'var(--warn)' }}
          />
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            <span style={{ fontWeight: 550 }}>No Claude API key loaded.</span> If you just added it
            to <span className="mono" style={{ fontSize: 12 }}>Backend/.env</span>, restart the
            backend — the key is read once at startup.
          </div>
        </div>
      )}

      {/* Splits at xl, not lg: the 236px sidebar sits outside this
          breakpoint's reckoning, and splitting at 1024 left the brief a
          456px column to live in. */}
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start"
      >
        {/* ------------- Main column: the brief, and the deploy ------------- */}
        <div className="card overflow-hidden min-w-0">
          <div className="card-head">
            <div className="card-title">Ideal Customer Profile</div>
            {modelLarge && <span className="pill mono">{modelLarge}</span>}
          </div>

          <div className="p-5">
            <textarea
              value={icp}
              onChange={(e) => {
                setIcp(e.target.value);
                setActivePreset(null);
              }}
              disabled={isGenerating}
              rows={16}
              placeholder="Pick a profile on the right, or describe the companies and the buying role you want to reach — industry, size, geography, and what makes them a fit right now."
              className="field"
              style={{ resize: 'vertical', lineHeight: 1.65 }}
            />

            {unfilled && (
              <div
                className="mt-3 px-3.5 py-2.5 flex items-start gap-2.5"
                style={{
                  background: 'var(--warn-soft)',
                  border: '1px solid var(--warn-border)',
                  borderRadius: 12,
                  fontSize: 12.5,
                  color: 'var(--ink-2)',
                }}
              >
                <AlertTriangle
                  className="w-4 h-4 mt-0.5 shrink-0"
                  strokeWidth={2}
                  style={{ color: 'var(--warn)' }}
                />
                <span>
                  Replace the <span className="mono">[bracketed]</span> parts before deploying — the
                  agent takes them literally, and you pay for the poor match.
                </span>
              </div>
            )}

            {/* The filters restated beside the button. They live in the rail
                now, and nobody should have to look away from Deploy to check
                what the run is actually constrained to. */}
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <span className="pill">
                {scope === 'global' ? (
                  <>
                    <Globe className="w-3 h-3" strokeWidth={2.4} /> Worldwide
                  </>
                ) : (
                  <>
                    <MapPin className="w-3 h-3" strokeWidth={2.4} />
                    {area.trim() || `Pick a ${scope}`}
                  </>
                )}
              </span>
              <span className="pill">
                {industryMode === 'all' ? (
                  <>
                    <Layers className="w-3 h-3" strokeWidth={2.4} /> All industries
                  </>
                ) : (
                  <>
                    <Factory className="w-3 h-3" strokeWidth={2.4} />
                    {industry.trim() || 'No sector yet'}
                  </>
                )}
              </span>
            </div>

            <div
              className="flex items-end justify-between gap-4 flex-wrap mt-4 pt-4"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <div>
                <label className="block mb-2" style={{ fontSize: 12.5, fontWeight: 550 }}>
                  Clients to find
                </label>
                <div className="flex gap-1.5">
                  {[1, 3, 5, 10].map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={isGenerating}
                      onClick={() => setCount(n)}
                      className={count === n ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                      style={{ minWidth: 44 }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 8 }}>
                  Roughly ${(count * COST_PER_CLIENT).toFixed(2)} — billed to your Claude key
                </div>
              </div>

              <div className="flex flex-col items-end gap-1.5">
                <button type="submit" disabled={blocked} title={blockedWhy} className="btn btn-primary">
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Agents running…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" strokeWidth={2} /> Deploy agents
                    </>
                  )}
                </button>
                {!isGenerating && blockedWhy && (
                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{blockedWhy}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ------------- Right rail: everything that narrows the search ------------- */}
        <aside className="flex flex-col gap-4 min-w-0">
          <RailCard
            title="Start from a profile"
            badge={<span className="pill">{ICP_PRESETS.length}</span>}
          >
            {GROUPS.map((group) => (
              <div key={group}>
                <div className="eyebrow mb-1.5">{group}</div>
                <div className="flex flex-col gap-1.5">
                  {ICP_PRESETS.filter((p) => p.group === group).map((preset) => (
                    <ChoiceRow
                      key={preset.id}
                      label={preset.label}
                      title={preset.hint}
                      active={activePreset === preset.id}
                      disabled={isGenerating}
                      onClick={() => apply(preset)}
                    />
                  ))}
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={writeOwn}
              disabled={isGenerating}
              className="flex items-center gap-2 self-start mt-0.5"
              style={{ fontSize: 12.5, fontWeight: 550, color: 'var(--green)' }}
            >
              <PenLine className="w-3.5 h-3.5" strokeWidth={2.2} />
              Write your own
            </button>
          </RailCard>

          <RailCard
            title="Where to look"
            badge={
              <span className="pill">
                {scope === 'global' ? (
                  <>
                    <Globe className="w-3 h-3" strokeWidth={2.4} /> Worldwide
                  </>
                ) : (
                  <>
                    <MapPin className="w-3 h-3" strokeWidth={2.4} />
                    {area.trim() || scope}
                  </>
                )}
              </span>
            }
          >
            <div className="grid grid-cols-2 gap-1.5">
              {SCOPES.map((s) => (
                <ChoiceRow
                  key={s.id}
                  label={s.label}
                  active={scope === s.id}
                  disabled={isGenerating}
                  onClick={() => {
                    setScope(s.id);
                    if (s.id === 'global') setArea('');
                  }}
                />
              ))}
            </div>

            {scope !== 'global' && (
              <>
                <input
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  disabled={isGenerating}
                  placeholder={PLACEHOLDER[scope]}
                  className="field"
                  style={{ fontSize: 13 }}
                />
                {/* Typing shortcuts, so they go once there is something to
                    shorten. Same reason the sector list collapses: the rail
                    sits beside the brief and should not dwarf it. */}
                {!area.trim() && (
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS[scope].map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setArea(name)}
                        disabled={isGenerating}
                        className="pill"
                        style={{ cursor: 'pointer' }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <p className="quiet" style={{ fontSize: 11.5 }}>
              {scope === 'global'
                ? 'No geographic constraint — the agent picks wherever the profile fits best.'
                : 'A hard filter. Asked for somewhere with few matches, the agent returns fewer accounts rather than padding the list with neighbouring areas.'}
            </p>
          </RailCard>

          <RailCard
            title="Industry"
            badge={
              <span className="pill">
                {industryMode === 'all' ? (
                  <>
                    <Layers className="w-3 h-3" strokeWidth={2.4} /> All
                  </>
                ) : (
                  <>
                    <Factory className="w-3 h-3" strokeWidth={2.4} />
                    {industry.trim() || 'None'}
                  </>
                )}
              </span>
            }
          >
            <div className="flex flex-col gap-1.5">
              {INDUSTRY_MODES.map((m) => (
                <ChoiceRow
                  key={m.id}
                  label={m.label}
                  title={m.hint}
                  active={industryMode === m.id}
                  disabled={isGenerating}
                  onClick={() => {
                    setIndustryMode(m.id);
                    // Switching modes clears the pick — a sector chosen from
                    // the list and one typed by hand are not the same answer,
                    // and carrying one into the other mislabels the run.
                    setIndustry('');
                    setIndustryQuery('');
                    setBrowsing(true);
                  }}
                />
              ))}
            </div>

            {industryMode === 'preset' && industry && !browsing && (
              <div
                className="flex items-center gap-2"
                style={{
                  padding: '8px 11px',
                  borderRadius: 10,
                  border: '1px solid var(--green)',
                  background: 'var(--green-soft)',
                }}
              >
                <Factory
                  className="w-3.5 h-3.5 shrink-0"
                  strokeWidth={2.2}
                  style={{ color: 'var(--green)' }}
                />
                <span className="truncate" style={{ fontSize: 12.5, fontWeight: 550 }}>
                  {industry}
                </span>
                <button
                  type="button"
                  onClick={() => setBrowsing(true)}
                  disabled={isGenerating}
                  className="ml-auto shrink-0"
                  style={{ fontSize: 11.5, fontWeight: 550, color: 'var(--green)' }}
                >
                  Change
                </button>
              </div>
            )}

            {industryMode === 'preset' && (!industry || browsing) && (
              <>
                <div className="relative">
                  <Search
                    className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    strokeWidth={2.4}
                    style={{ color: 'var(--ink-4)' }}
                  />
                  <input
                    value={industryQuery}
                    onChange={(e) => setIndustryQuery(e.target.value)}
                    disabled={isGenerating}
                    placeholder="Search industries…"
                    className="field"
                    style={{ paddingLeft: 32, fontSize: 12.5 }}
                  />
                </div>

                {industryMatches.length === 0 ? (
                  <p className="quiet" style={{ fontSize: 11.5 }}>
                    Nothing matches that.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setIndustryMode('custom');
                        setIndustry(industryQuery.trim());
                        setIndustryQuery('');
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        font: 'inherit',
                        color: 'var(--green)',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Use it as a custom sector
                    </button>
                    .
                  </p>
                ) : (
                  <div
                    className="flex flex-col gap-2"
                    style={{ maxHeight: 200, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}
                  >
                    {industryMatches.map((g) => (
                      <div key={g.head}>
                        <div className="eyebrow mb-1">{g.head}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {g.items.map((name) => (
                            <button
                              key={name}
                              type="button"
                              onClick={() => {
                                setIndustry(name);
                                setIndustryQuery('');
                                setBrowsing(false);
                              }}
                              disabled={isGenerating}
                              className="pill"
                              style={{
                                cursor: 'pointer',
                                color: industry === name ? 'var(--green)' : undefined,
                                borderColor: industry === name ? 'var(--green-border)' : undefined,
                                background: industry === name ? 'var(--green-soft)' : undefined,
                              }}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {industryMode === 'custom' && (
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                disabled={isGenerating}
                placeholder="e.g. CNC machining, cold-chain logistics"
                className="field"
                style={{ fontSize: 13 }}
              />
            )}

            <p className="quiet" style={{ fontSize: 11.5 }}>
              {industryMode === 'all'
                ? 'No sector constraint — the agent picks whichever industries the profile fits best.'
                : 'A hard filter, like geography. The agent returns fewer accounts rather than drifting into adjacent sectors to fill the count.'}
            </p>
          </RailCard>
        </aside>
      </form>

      {/* ------------- What actually runs, once you deploy ------------- */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4">
          <div className="eyebrow mb-3">Orchestration sequence</div>
          <div className="flex items-center gap-2 flex-wrap">
            {STEPS.map((step, i) => (
              <React.Fragment key={step.label}>
                <div
                  className="flex items-center gap-2 px-2.5 py-1.5"
                  style={{
                    borderRadius: 10,
                    border: `1px solid ${isGenerating ? 'var(--green-border)' : 'var(--border)'}`,
                    background: isGenerating ? 'var(--green-soft)' : 'var(--surface)',
                  }}
                >
                  <span
                    className="rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      background: isGenerating ? 'var(--green)' : 'var(--border-strong)',
                      animation: isGenerating ? 'pulse 1.4s ease-in-out infinite' : undefined,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 12.5,
                      color: isGenerating ? 'var(--green)' : 'var(--ink-2)',
                    }}
                  >
                    {step.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <ArrowRight
                    className="w-3.5 h-3.5"
                    strokeWidth={2}
                    style={{ color: 'var(--ink-4)' }}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
          <p className="mt-3" style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            Suppressed contacts are removed before personalization runs, so you never pay to write a
            message that must not be sent. The exact cost is reported when the run finishes.
          </p>
        </div>
      </div>
    </div>
  );
}
