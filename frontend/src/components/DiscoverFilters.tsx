import React, { useState } from 'react';
import { Check, Globe, Layers, Plus, Search, X } from 'lucide-react';
import { AreaPick, GeoScope } from '../types';
import { ALL_INDUSTRIES, INDUSTRY_GROUPS } from '../lib/industries';

/**
 * The two multi-select filters Discover runs inside: where to look, and which
 * sectors. Shared by the Discover wizard and the Discovery-defaults card in
 * Settings, so a saved default looks and behaves exactly like a live pick.
 *
 * Both are "any of" filters: a company in any picked area, in any picked
 * sector, is in. Nothing picked means no constraint at all.
 */

/** Matches the list caps on SearchArea and IndustryFilter in schemas.py. */
export const MAX_PICKS = 12;

export const SCOPE_TABS: { id: GeoScope; label: string; placeholder: string }[] = [
  { id: 'city', label: 'City', placeholder: 'Pune' },
  { id: 'state', label: 'State', placeholder: 'Maharashtra' },
  { id: 'country', label: 'Country', placeholder: 'India' },
];

/** Quick picks per scope. The field is free text - these just save typing. */
const AREA_SUGGESTIONS: Record<GeoScope, string[]> = {
  city: ['Pune', 'Mumbai', 'Bengaluru', 'Delhi', 'Hyderabad', 'Chennai', 'Dubai', 'London', 'New York'],
  state: ['Maharashtra', 'Karnataka', 'Tamil Nadu', 'Gujarat', 'Telangana', 'California', 'Texas'],
  country: ['India', 'United Arab Emirates', 'United States', 'United Kingdom', 'Canada', 'Germany', 'Australia'],
};

function tidy(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** "Worldwide", "Pune, Mumbai", or "Pune, Mumbai +3". */
export function areaLabel(areas: AreaPick[]): string {
  return summarise(areas.map((a) => a.value), 'Worldwide');
}

/** "All industries", "Manufacturing, Packaging", or "Manufacturing, Packaging +2". */
export function sectorLabel(sectors: string[]): string {
  return summarise(sectors, 'All industries');
}

function summarise(names: string[], empty: string): string {
  if (names.length === 0) return empty;
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

const ON_STYLE: React.CSSProperties = {
  color: 'var(--green)',
  borderColor: 'var(--green-border)',
  background: 'var(--green-soft)',
};

/** One selected value, with its remove button. */
function Chip({
  label,
  tag,
  disabled,
  onRemove,
}: {
  label: string;
  tag?: string;
  disabled?: boolean;
  onRemove: () => void;
}) {
  return (
    <span className="pill" style={{ ...ON_STYLE, paddingRight: 5 }}>
      {label}
      {tag && (
        <span style={{ fontSize: 9.5, opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {tag}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${label}`}
        className="grid place-items-center rounded-full"
        style={{ width: 16, height: 16, marginLeft: 1, color: 'inherit' }}
      >
        <X className="w-3 h-3" strokeWidth={2.6} />
      </button>
    </span>
  );
}

function ClearAll({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'underline', padding: '0 4px' }}
    >
      Clear
    </button>
  );
}

// --- Where to look -----------------------------------------------------------

export function AreaPicker({
  areas,
  onChange,
  disabled,
}: {
  areas: AreaPick[];
  onChange: (next: AreaPick[]) => void;
  disabled?: boolean;
}) {
  const [scope, setScope] = useState<GeoScope>('city');
  const [text, setText] = useState('');
  const full = areas.length >= MAX_PICKS;
  const tab = SCOPE_TABS.find((t) => t.id === scope) ?? SCOPE_TABS[0];

  const has = (s: GeoScope, value: string) =>
    areas.some((a) => a.scope === s && same(a.value, value));

  const toggle = (s: GeoScope, raw: string) => {
    const value = tidy(raw);
    if (!value) return;
    if (has(s, value)) {
      onChange(areas.filter((a) => !(a.scope === s && same(a.value, value))));
    } else if (!full) {
      onChange([...areas, { scope: s, value }]);
    }
  };

  const addTyped = () => {
    const value = tidy(text);
    if (!value) return;
    if (!has(scope, value)) toggle(scope, value);
    setText('');
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {areas.length === 0 ? (
          <span className="pill">
            <Globe className="w-3 h-3" strokeWidth={2.4} /> Worldwide
          </span>
        ) : (
          areas.map((a) => (
            <Chip
              key={`${a.scope}:${a.value.toLowerCase()}`}
              label={a.value}
              tag={a.scope}
              disabled={disabled}
              onRemove={() => toggle(a.scope, a.value)}
            />
          ))
        )}
        {areas.length > 1 && <ClearAll onClick={() => onChange([])} disabled={disabled} />}
      </div>

      <div className="seg self-start" role="tablist">
        {SCOPE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={scope === t.id}
            onClick={() => setScope(t.id)}
            disabled={disabled}
            className="seg-btn"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTyped();
            }
          }}
          disabled={disabled || full}
          placeholder={full ? `Up to ${MAX_PICKS} areas` : `Add a ${tab.label.toLowerCase()}, e.g. ${tab.placeholder}`}
          aria-label={`Add a ${tab.label.toLowerCase()}`}
          className="field"
          style={{ fontSize: 13.5 }}
        />
        <button
          type="button"
          onClick={addTyped}
          disabled={disabled || full || !text.trim()}
          className="btn"
          style={{ whiteSpace: 'nowrap' }}
        >
          <Plus className="w-4 h-4" strokeWidth={2.4} />
          Add
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {AREA_SUGGESTIONS[scope].map((name) => {
          const on = has(scope, name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => toggle(scope, name)}
              disabled={disabled || (!on && full)}
              aria-pressed={on}
              className="pill"
              style={{ cursor: 'pointer', ...(on ? ON_STYLE : {}) }}
            >
              {on && <Check className="w-3 h-3" strokeWidth={3} />}
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Which sectors -----------------------------------------------------------

export function SectorPicker({
  sectors,
  onChange,
  disabled,
  listHeight = 196,
}: {
  sectors: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** The pick-list scrolls past this, so the card beside it keeps its height. */
  listHeight?: number;
}) {
  const [query, setQuery] = useState('');
  const full = sectors.length >= MAX_PICKS;

  const has = (name: string) => sectors.some((s) => same(s, name));

  const toggle = (raw: string) => {
    const name = tidy(raw);
    if (!name) return;
    if (has(name)) onChange(sectors.filter((s) => !same(s, name)));
    else if (!full) onChange([...sectors, name]);
  };

  /** Enter in the search box: the listed sector if it is one, else a custom one. */
  const addTyped = () => {
    const name = tidy(query);
    if (!name) return;
    const known = ALL_INDUSTRIES.find((i) => same(i, name));
    if (!has(known ?? name)) toggle(known ?? name);
    setQuery('');
  };

  const q = query.trim().toLowerCase();
  const matches = q
    ? INDUSTRY_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((name) => name.toLowerCase().includes(q)),
      })).filter((g) => g.items.length > 0)
    : INDUSTRY_GROUPS;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {sectors.length === 0 ? (
          <span className="pill">
            <Layers className="w-3 h-3" strokeWidth={2.4} /> All industries
          </span>
        ) : (
          sectors.map((name) => (
            <Chip key={name.toLowerCase()} label={name} disabled={disabled} onRemove={() => toggle(name)} />
          ))
        )}
        {sectors.length > 1 && <ClearAll onClick={() => onChange([])} disabled={disabled} />}
      </div>

      <div className="relative">
        <Search
          className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          strokeWidth={2.4}
          style={{ color: 'var(--ink-4)' }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTyped();
            }
          }}
          disabled={disabled || full}
          placeholder={full ? `Up to ${MAX_PICKS} sectors` : 'Search sectors, or type your own and press Enter'}
          aria-label="Search or add a sector"
          className="field"
          style={{ paddingLeft: 38, fontSize: 13.5 }}
        />
      </div>

      {matches.length === 0 ? (
        <p className="quiet">
          Nothing in the list matches.{' '}
          <button
            type="button"
            onClick={addTyped}
            disabled={disabled || full}
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
            Add “{query.trim()}” as a custom sector
          </button>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-2.5" style={{ maxHeight: listHeight, overflowY: 'auto' }}>
          {matches.map((g) => (
            <div key={g.head}>
              <div className="eyebrow mb-1.5">{g.head}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((name) => {
                  const on = has(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggle(name)}
                      disabled={disabled || (!on && full)}
                      aria-pressed={on}
                      className="pill"
                      style={{ cursor: 'pointer', ...(on ? ON_STYLE : {}) }}
                    >
                      {on && <Check className="w-3 h-3" strokeWidth={3} />}
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
