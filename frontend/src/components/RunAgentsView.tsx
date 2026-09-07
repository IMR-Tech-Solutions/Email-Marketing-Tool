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
import { INDUSTRY_GROUPS, ALL_INDUSTRIES } from '../lib/industries';
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
  city: ['Pune', 'Mumbai', 'Bengaluru', 'Delhi', 'Hyderabad', 'Chennai', 'London', 'New York'],
  state: ['Maharashtra', 'Karnataka', 'Tamil Nadu', 'Gujarat', 'Telangana', 'California', 'Texas'],
  country: ['India', 'United States', 'United Kingdom', 'Canada', 'Germany', 'Australia', 'Singapore'],
  global: [],
};

const PLACEHOLDER: Record<GeoScope, string> = {
  city: 'Pune',
  state: 'Maharashtra',
  country: 'India',
  global: '',
};

const INDUSTRY_MODES: { id: IndustryMode; label: string }[] = [
  { id: 'all', label: 'All industries' },
  { id: 'preset', label: 'Pick a sector' },
  { id: 'custom', label: 'Custom' },
];

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

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 880 }}>
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

      {/* Preset picker */}
      <div className="card overflow-hidden">
        <div className="card-head">
          <div className="card-title">Start from a profile</div>
          <span className="pill">{ICP_PRESETS.length} ready</span>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {GROUPS.map((group) => (
            <div key={group}>
              <div className="eyebrow mb-2">{group}</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {ICP_PRESETS.filter((p) => p.group === group).map((preset) => {
                  const on = activePreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => apply(preset)}
                      disabled={isGenerating}
                      className="text-left transition-colors"
                      style={{
                        padding: '11px 13px',
                        borderRadius: 12,
                        border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`,
                        background: on ? 'var(--green-soft)' : 'var(--surface)',
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span style={{ fontSize: 13, fontWeight: 550 }}>{preset.label}</span>
                        {on && (
                          <Check
                            className="w-3.5 h-3.5 ml-auto shrink-0"
                            strokeWidth={3}
                            style={{ color: 'var(--green)' }}
                          />
                        )}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>
                        {preset.hint}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={writeOwn}
            disabled={isGenerating}
            className="flex items-center gap-2 self-start"
            style={{ fontSize: 13, fontWeight: 550, color: 'var(--green)' }}
          >
            <PenLine className="w-4 h-4" strokeWidth={2.2} />
            Write your own
          </button>
        </div>
      </div>

      {/* Where to look */}
      <div className="card overflow-hidden">
        <div className="card-head">
          <div className="card-title">Where to look</div>
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
        </div>

        <div className="p-5 flex flex-col gap-3.5">
          <div className="seg self-start" role="tablist">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={scope === s.id}
                onClick={() => {
                  setScope(s.id);
                  if (s.id === 'global') setArea('');
                }}
                disabled={isGenerating}
                className="seg-btn"
              >
                {s.label}
              </button>
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
                style={{ fontSize: 13.5, maxWidth: 320 }}
              />
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS[scope].map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setArea(name)}
                    disabled={isGenerating}
                    className="pill"
                    style={{
                      cursor: 'pointer',
                      color: area === name ? 'var(--green)' : undefined,
                      borderColor: area === name ? 'var(--green-border)' : undefined,
                      background: area === name ? 'var(--green-soft)' : undefined,
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="quiet">
            {scope === 'global'
              ? 'No geographic constraint — the agent picks wherever the profile fits best.'
              : 'A hard filter, not a preference. Asked for somewhere with few matches, the agent returns fewer accounts rather than padding the list with neighbouring areas — and anything that slips through is flagged after the run.'}
          </p>
        </div>
      </div>

      {/* Industry */}
      <div className="card overflow-hidden">
        <div className="card-head">
          <div className="card-title">Industry</div>
          <span className="pill">
            {industryMode === 'all' ? (
              <>
                <Layers className="w-3 h-3" strokeWidth={2.4} /> All industries
              </>
            ) : (
              <>
                <Factory className="w-3 h-3" strokeWidth={2.4} />
                {industry.trim() || 'Pick a sector'}
              </>
            )}
          </span>
        </div>

        <div className="p-5 flex flex-col gap-3.5">
          <div className="seg self-start" role="tablist">
            {INDUSTRY_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={industryMode === m.id}
                onClick={() => {
                  setIndustryMode(m.id);
                  // Switching modes clears the pick — a sector chosen from the
                  // list and one typed by hand are not the same answer, and
                  // carrying one into the other silently mislabels the run.
                  setIndustry('');
                  setIndustryQuery('');
                }}
                disabled={isGenerating}
                className="seg-btn"
              >
                {m.label}
              </button>
            ))}
          </div>

          {industryMode === 'preset' && (
            <>
              <div className="relative self-start">
                <Search
                  className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                  strokeWidth={2.4}
                  style={{ color: 'var(--ink-4)' }}
                />
                <input
                  value={industryQuery}
                  onChange={(e) => setIndustryQuery(e.target.value)}
                  disabled={isGenerating}
                  placeholder="Search industries…"
                  className="field"
                  style={{ paddingLeft: 40, width: 260, borderRadius: 999, fontSize: 13.5 }}
                />
              </div>

              {industryMatches.length === 0 ? (
                <p className="quiet">
                  Nothing matches “{industryQuery.trim()}”. Switch to{' '}
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
                    Custom
                  </button>{' '}
                  to use it anyway.
                </p>
              ) : (
                <div className="flex flex-col gap-3" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {industryMatches.map((g) => (
                    <div key={g.head}>
                      <div className="eyebrow mb-1.5">{g.head}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {g.items.map((name) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => setIndustry(name)}
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
              placeholder="e.g. CNC machining, cold-chain logistics, marine insurance"
              className="field"
              style={{ fontSize: 13.5, maxWidth: 420 }}
            />
          )}

          <p className="quiet">
            {industryMode === 'all'
              ? 'No sector constraint — the agent picks whichever industries the profile fits best.'
              : 'A hard filter, like geography. The agent returns fewer accounts rather than drifting into adjacent sectors to fill the count. Leave the ICP text describing who they are and why now — this narrows what counts as a match.'}
          </p>
        </div>
      </div>

      {/* The prompt itself */}
      <form onSubmit={handleSubmit} className="card overflow-hidden">
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
            rows={10}
            placeholder="Pick a profile above, or describe the companies and the buying role you want to reach — industry, size, geography, and what makes them a fit right now."
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

          <div className="flex items-end justify-between gap-4 flex-wrap mt-5">
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

            <button
              type="submit"
              disabled={isGenerating || !icp.trim() || needsArea || needsIndustry}
              title={
                needsArea
                  ? `Type a ${scope}, or switch to Worldwide`
                  : needsIndustry
                    ? 'Pick an industry, or switch to All industries'
                    : undefined
              }
              className="btn btn-primary"
            >
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
          </div>
        </div>

        <div
          className="px-5 py-4"
          style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}
        >
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
      </form>
    </div>
  );
}
