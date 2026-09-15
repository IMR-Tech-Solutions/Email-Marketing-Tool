import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
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
import { GeoScope, SearchArea, IndustryMode, IndustryFilter, DiscoveryDefaults } from '../types';

interface RunAgentsViewProps {
  /** What the wizard opens with - from Settings. Every run can still change them. */
  defaults?: DiscoveryDefaults;
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

/** The four screens, in order. */
const WIZARD = [
  { label: 'Profile', blurb: 'Start from a ready-made profile, or write your own.' },
  { label: 'Filters', blurb: 'Narrow the search before it costs anything.' },
  { label: 'Brief', blurb: 'The description the agents actually read.' },
  { label: 'Deploy', blurb: 'Check the run, then send the agents out.' },
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
  country: ['India', 'United States', 'United Kingdom', 'Canada', 'Germany', 'Australia'],
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

/* ------------------------------------------------------------------ */

/** The numbered rail across the top. Completed steps are clickable. */
function StepBar({
  step,
  reachable,
  onGo,
}: {
  step: number;
  reachable: number;
  onGo: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {WIZARD.map((w, i) => {
        const done = i < step;
        const here = i === step;
        const open = i <= reachable;
        return (
          <React.Fragment key={w.label}>
            <button
              type="button"
              onClick={() => open && onGo(i)}
              disabled={!open}
              aria-current={here ? 'step' : undefined}
              className="flex items-center gap-2 transition-colors"
              style={{
                padding: '7px 13px 7px 8px',
                borderRadius: 999,
                border: `1px solid ${here ? 'var(--green)' : 'var(--border)'}`,
                background: here ? 'var(--green-soft)' : 'var(--surface)',
                cursor: open ? 'pointer' : 'default',
                opacity: open ? 1 : 0.55,
              }}
            >
              <span
                className="grid place-items-center rounded-full shrink-0"
                style={{
                  width: 20,
                  height: 20,
                  fontSize: 11,
                  fontWeight: 650,
                  color: done || here ? '#fff' : 'var(--ink-3)',
                  background: done || here ? 'var(--green)' : 'var(--border)',
                }}
              >
                {done ? <Check className="w-3 h-3" strokeWidth={3.2} /> : i + 1}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 550,
                  color: here ? 'var(--green)' : 'var(--ink-2)',
                }}
              >
                {w.label}
              </span>
            </button>
            {i < WIZARD.length - 1 && (
              <span
                className="shrink-0"
                style={{
                  height: 1,
                  flex: 1,
                  minWidth: 12,
                  background: i < step ? 'var(--green-border)' : 'var(--border)',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function RunAgentsView({
  defaults,
  onRunPipeline,
  isGenerating,
  modelLarge,
  claudeReady,
}: RunAgentsViewProps) {
  const [step, setStep] = useState(0);
  const [icp, setIcp] = useState('');
  const [count, setCount] = useState(defaults?.companyCount ?? 1);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [scope, setScope] = useState<GeoScope>(defaults?.scope ?? 'global');
  const [area, setArea] = useState(defaults?.value ?? '');
  const [industryMode, setIndustryMode] = useState<IndustryMode>(defaults?.industryMode ?? 'all');
  const [industry, setIndustry] = useState(defaults?.industryValue ?? '');
  const [industryQuery, setIndustryQuery] = useState('');

  // Settings can arrive after this mounts, or change while it is open. Take
  // them only while the wizard is untouched - never over a brief in progress.
  const defaultsKey = defaults ? JSON.stringify(defaults) : '';
  useEffect(() => {
    if (!defaults || step !== 0 || icp.trim()) return;
    setCount(defaults.companyCount);
    setScope(defaults.scope);
    setArea(defaults.value);
    setIndustryMode(defaults.industryMode);
    setIndustry(defaults.industryValue);
  }, [defaultsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A run started from the last step, but the agents keep going if you walk
  // back through the wizard. Pin the view to Deploy so the progress is where
  // you left it rather than behind two Back clicks.
  useEffect(() => {
    if (isGenerating) setStep(3);
  }, [isGenerating]);

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

  // The template still has its slots in it - running that wastes money.
  const unfilled = /\[[^\]]+\]/.test(icp);

  /** Why you cannot leave the step you are on, if you cannot. */
  const blockedWhy = [
    undefined,
    needsArea
      ? `Type a ${scope}, or switch to Worldwide`
      : needsIndustry
        ? industryMode === 'preset'
          ? 'Pick a sector, or switch to All industries'
          : 'Type a sector, or switch to All industries'
        : undefined,
    !icp.trim() ? 'Describe the audience before continuing' : undefined,
    !icp.trim() ? 'Describe the audience first' : undefined,
  ][step];

  /** How far the wizard has been unlocked, so the bar knows what to enable. */
  const reachable = needsArea || needsIndustry ? 1 : !icp.trim() ? 2 : 3;

  const deploy = () => {
    if (!icp.trim() || isGenerating || needsArea || needsIndustry) return;
    onRunPipeline(
      icp,
      count,
      { scope, value: scope === 'global' ? '' : area.trim() },
      { mode: industryMode, value: industryMode === 'all' ? '' : industry.trim() },
    );
  };

  const geoPill =
    scope === 'global' ? (
      <>
        <Globe className="w-3 h-3" strokeWidth={2.4} /> Worldwide
      </>
    ) : (
      <>
        <MapPin className="w-3 h-3" strokeWidth={2.4} />
        {area.trim() || `Pick a ${scope}`}
      </>
    );

  const sectorPill =
    industryMode === 'all' ? (
      <>
        <Layers className="w-3 h-3" strokeWidth={2.4} /> All industries
      </>
    ) : (
      <>
        <Factory className="w-3 h-3" strokeWidth={2.4} />
        {industry.trim() || 'No sector yet'}
      </>
    );

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 980 }}>
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

      <StepBar step={step} reachable={reachable} onGo={setStep} />

      {/* Deliberately not a <form>. Continue and Deploy occupy the same slot,
          and as a form React patched the one button element's type from
          "button" to "submit" mid-click — the browser then ran the submit
          default action, so a single Continue on step 3 deployed for real.
          Nothing here submits; both buttons are explicit onClick. */}
      <div className="card overflow-hidden">
        <div className="card-head">
          <div className="card-title">
            {step + 1}. {WIZARD[step].label}
          </div>
          {step === 2 && modelLarge && <span className="pill mono">{modelLarge}</span>}
          {step === 1 && (
            <div className="flex items-center gap-1.5">
              <span className="pill">{geoPill}</span>
              <span className="pill">{sectorPill}</span>
            </div>
          )}
        </div>

        <div className="p-5">
          <p className="quiet mb-4">{WIZARD[step].blurb}</p>

          {/* ---------------------------- 1. Profile ---------------------------- */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
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
          )}

          {/* ---------------------------- 2. Filters ---------------------------- */}
          {step === 1 && (
            /* Two columns, with the sector list capped to roughly the height
               of the geography column beside it. Stacking them instead cured
               the dead half-column but pushed the card from 653px to 866px,
               which is worse — this way nothing is empty and nothing scrolls
               that did not before. */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
              {/* Geography */}
              <div className="flex flex-col gap-3">
                <div className="eyebrow">Where to look</div>
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
                      style={{ fontSize: 13.5 }}
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
                    : 'A hard filter, not a preference. Asked for somewhere with few matches, the agent returns fewer accounts rather than padding the list with neighbouring areas.'}
                </p>
              </div>

              {/* Industry */}
              <div className="flex flex-col gap-3">
                <div className="eyebrow">Industry</div>
                <div className="seg self-start" role="tablist">
                  {INDUSTRY_MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="tab"
                      aria-selected={industryMode === m.id}
                      onClick={() => {
                        setIndustryMode(m.id);
                        // Switching modes clears the pick — a sector chosen
                        // from the list and one typed by hand are not the same
                        // answer, and carrying one over mislabels the run.
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
                    <div className="relative">
                      <Search
                        className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                        strokeWidth={2.4}
                        style={{ color: 'var(--ink-4)' }}
                      />
                      <input
                        value={industryQuery}
                        onChange={(e) => setIndustryQuery(e.target.value)}
                        disabled={isGenerating}
                        placeholder="Search industries…"
                        className="field"
                        style={{ paddingLeft: 38, fontSize: 13.5 }}
                      />
                    </div>

                    {industryMatches.length === 0 ? (
                      <p className="quiet">
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
                        className="flex flex-col gap-2.5"
                        style={{ maxHeight: 196, overflowY: 'auto' }}
                      >
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
                                    borderColor:
                                      industry === name ? 'var(--green-border)' : undefined,
                                    background:
                                      industry === name ? 'var(--green-soft)' : undefined,
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
                    style={{ fontSize: 13.5 }}
                  />
                )}

                <p className="quiet">
                  {industryMode === 'all'
                    ? 'No sector constraint — the agent picks whichever industries the profile fits best.'
                    : 'A hard filter, like geography. The agent returns fewer accounts rather than drifting into adjacent sectors to fill the count.'}
                </p>
              </div>
            </div>
          )}

          {/* ----------------------------- 3. Brief ----------------------------- */}
          {step === 2 && (
            <div className="flex flex-col gap-3">
              <textarea
                value={icp}
                onChange={(e) => {
                  setIcp(e.target.value);
                  setActivePreset(null);
                }}
                disabled={isGenerating}
                rows={24}
                placeholder="Describe the companies and the buying role you want to reach — industry, size, geography, and what makes them a fit right now."
                className="field"
                style={{ resize: 'vertical', lineHeight: 1.65 }}
              />

              {unfilled && (
                <div
                  className="px-3.5 py-2.5 flex items-start gap-2.5"
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
                    Replace the <span className="mono">[bracketed]</span> parts before deploying —
                    the agent takes them literally, and you pay for the poor match.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ---------------------------- 4. Deploy ----------------------------- */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {[
                  { k: 'Where', v: geoPill },
                  { k: 'Industry', v: sectorPill },
                  {
                    k: 'Profile',
                    v: (
                      <>
                        {ICP_PRESETS.find((p) => p.id === activePreset)?.label ??
                          (activePreset === 'custom' ? 'Written by hand' : 'Edited')}
                      </>
                    ),
                  },
                ].map((row) => (
                  <div
                    key={row.k}
                    style={{
                      padding: '11px 13px',
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                    }}
                  >
                    <div className="eyebrow mb-1.5">{row.k}</div>
                    <span className="pill">{row.v}</span>
                  </div>
                ))}
              </div>

              <div>
                <div className="eyebrow mb-1.5">The brief</div>
                <div
                  className="px-3.5 py-3"
                  style={{
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    background: 'var(--work)',
                    fontSize: 12.5,
                    color: 'var(--ink-2)',
                    lineHeight: 1.6,
                    maxHeight: 200,
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {icp.trim() || 'Nothing written yet.'}
                </div>
              </div>

              {unfilled && (
                <div
                  className="px-3.5 py-2.5 flex items-start gap-2.5"
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
                    The brief still has <span className="mono">[bracketed]</span> slots in it. Go
                    back and fill them — the agent takes them literally.
                  </span>
                </div>
              )}

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

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div className="eyebrow mb-3">Orchestration sequence</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {STEPS.map((s, i) => (
                    <React.Fragment key={s.label}>
                      <div
                        className="flex items-center gap-2 px-2.5 py-1.5"
                        style={{
                          borderRadius: 10,
                          border: `1px solid ${
                            isGenerating ? 'var(--green-border)' : 'var(--border)'
                          }`,
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
                          {s.label}
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
                  Suppressed contacts are removed before personalization runs, so you never pay to
                  write a message that must not be sent. The exact cost is reported when the run
                  finishes.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ---------------------------- Navigation ---------------------------- */}
        <div
          className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap"
          style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}
        >
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || isGenerating}
            className="btn"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2} /> Back
          </button>

          <div className="flex items-center gap-3">
            {blockedWhy && (
              <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{blockedWhy}</span>
            )}
            {step < 3 ? (
              <button
                key="nav-continue"
                type="button"
                onClick={() => setStep((s) => Math.min(3, s + 1))}
                disabled={!!blockedWhy || isGenerating}
                title={blockedWhy}
                className="btn btn-primary"
              >
                Continue <ArrowRight className="w-4 h-4" strokeWidth={2} />
              </button>
            ) : (
              <button
                key="nav-deploy"
                type="button"
                onClick={deploy}
                disabled={isGenerating || !!blockedWhy}
                title={blockedWhy}
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
