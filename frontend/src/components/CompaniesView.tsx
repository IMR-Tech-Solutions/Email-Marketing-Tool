import React, { useEffect, useState } from 'react';
import { BUSINESSES, BUSINESS_LABEL, BusinessFilter } from '../lib/business';
import {
  Company,
  ContactPatch,
  DecisionMaker,
  EmailCandidate,
  FindEmailResponse,
  OutreachCampaign,
  VerifyStatus,
} from '../types';
import { FRESHNESS_COLORS, FRESHNESS_LABELS, STATEMENT_STYLES, icpTone } from '../lib/display';
import {
  Sparkles,
  Loader2,
  Search,
  Send,
  Check,
  Mail,
  Phone,
  Linkedin,
  Globe,
  MapPin,
  CalendarDays,
  Rocket,
  ExternalLink,
  AlertTriangle,
  X,
} from 'lucide-react';

interface CompaniesViewProps {
  companies: Company[];
  selected: string[];
  onSelectionChange: (ids: string[]) => void;
  onEnrichCompany: (companyId: string) => void;
  onUpdateContact: (
    companyId: string,
    contactId: string,
    patch: ContactPatch,
  ) => Promise<void>;
  onFindEmail: (companyId: string, contactId: string) => Promise<FindEmailResponse>;
  onOpenSend: () => void;
  hasCampaign: (companyId: string) => boolean;
  getCampaign: (companyId: string) => OutreachCampaign | null;
}

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  contacted: 'Contacted',
  engaged: 'Engaged',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
};

/** `unverified` reads as a warning on purpose: an unconfirmed address is a bounce risk. */
const VERIFY_STYLES: Record<VerifyStatus, { label: string; pill: string }> = {
  verified: { label: 'Confirmed', pill: 'pill pill-good' },
  rejected: { label: 'Does not exist', pill: 'pill pill-bad' },
  accepts_all: { label: 'Catch-all', pill: 'pill pill-warn' },
  unverified: { label: 'Unconfirmed', pill: 'pill pill-warn' },
  no_mx: { label: 'No mail server', pill: 'pill pill-bad' },
};

const MAX_BATCH = 10;

interface ContactDraft {
  email: string;
  phone: string;
  linkedin: string;
}

const EMPTY_DRAFT: ContactDraft = { email: '', phone: '', linkedin: '' };

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

/** Which channels this contact can be reached on, at a glance. */
function ChannelDots({ contact }: { contact?: DecisionMaker }) {
  const channels: Array<[string, boolean, typeof Mail]> = [
    ['Email', Boolean(contact?.email), Mail],
    ['Phone', Boolean(contact?.phone), Phone],
    ['LinkedIn', Boolean(contact?.linkedin), Linkedin],
  ];
  return (
    <div className="flex items-center gap-1.5">
      {channels.map(([label, on, Icon]) => (
        <Icon
          key={label}
          className="w-3 h-3"
          strokeWidth={2.6}
          aria-label={on ? label : `No ${label.toLowerCase()}`}
          style={{ color: on ? 'var(--green)' : 'var(--border-strong)' }}
        />
      ))}
    </div>
  );
}

function Chips({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span key={i} className="pill">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One channel line: the value when there is one, a prompt to add it when not. */
function ChannelRow({
  icon: Icon,
  href,
  value,
  empty,
  onAdd,
  mono = true,
  trailing,
  dim,
}: {
  icon: typeof Mail;
  href?: string;
  value?: string;
  empty: string;
  onAdd: () => void;
  mono?: boolean;
  trailing?: React.ReactNode;
  dim?: boolean;
}) {
  if (!value) {
    return (
      <button
        onClick={onAdd}
        className="flex items-center gap-2.5 text-left w-full"
        style={{ fontSize: 12.5, color: 'var(--ink-4)' }}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2.4} />
        {empty}
      </button>
    );
  }
  return (
    <a
      href={href}
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel="noreferrer noopener"
      className="flex items-center gap-2.5"
      style={{ fontSize: 12.5, color: 'var(--ink-2)' }}
    >
      <Icon
        className="w-3.5 h-3.5 shrink-0"
        strokeWidth={2.4}
        style={{ color: dim ? 'var(--ink-4)' : 'var(--green)' }}
      />
      <span className={`truncate${mono ? ' mono' : ''}`}>{value}</span>
      {trailing}
    </a>
  );
}

interface ContactCardProps {
  companyId: string;
  contact: DecisionMaker;
  campaign: OutreachCampaign | null;
  onUpdateContact: (companyId: string, contactId: string, patch: ContactPatch) => Promise<void>;
  onFindEmail: (companyId: string, contactId: string) => Promise<FindEmailResponse>;
}

function ContactCard({
  companyId,
  contact: dm,
  campaign,
  onUpdateContact,
  onFindEmail,
}: ContactCardProps) {
  // One panel at a time, so the card never grows into a wall.
  const [panel, setPanel] = useState<'none' | 'edit' | 'find' | 'script'>('none');
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<FindEmailResponse | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const openEditor = () => {
    setDraft({ email: dm.email, phone: dm.phone, linkedin: dm.linkedin });
    setError(null);
    setPanel('edit');
  };

  const save = async () => {
    const patch: ContactPatch = {};
    if (draft.email.trim() !== dm.email) patch.email = draft.email.trim();
    if (draft.phone.trim() !== dm.phone) patch.phone = draft.phone.trim();
    if (draft.linkedin.trim() !== dm.linkedin) patch.linkedin = draft.linkedin.trim();
    if (Object.keys(patch).length === 0) {
      setPanel('none');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onUpdateContact(companyId, dm.id, patch);
      setPanel('none');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const runFinder = async () => {
    setPanel('find');
    setFinding(true);
    setError(null);
    setFound(null);
    try {
      setFound(await onFindEmail(companyId, dm.id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFinding(false);
    }
  };

  const useCandidate = async (candidate: EmailCandidate) => {
    setApplying(candidate.email);
    setError(null);
    try {
      await onUpdateContact(companyId, dm.id, { email: candidate.email });
      setFound(null);
      setPanel('none');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setApplying(null);
    }
  };

  /** LinkedIn has no send API, and automating the site gets accounts restricted. */
  const openLinkedIn = async () => {
    if (campaign?.linkedinMessage) {
      try {
        await navigator.clipboard.writeText(campaign.linkedinMessage);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2200);
      } catch {
        /* clipboard refused — still open the profile */
      }
    }
    window.open(dm.linkedin, '_blank', 'noopener,noreferrer');
  };

  const initials = dm.name.split(' ').map((n) => n[0]).join('').slice(0, 2);
  const tel = dm.phone.replace(/[^\d+]/g, '');

  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 16 }} className="overflow-hidden">
      <div className="flex items-center gap-3 px-4 pt-3.5">
        <div
          className="grid place-items-center rounded-full text-white display shrink-0"
          style={{ width: 34, height: 34, fontSize: 13, background: 'var(--green-mid)' }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate" style={{ fontSize: 13.5, fontWeight: 550 }}>
            {dm.name}
          </div>
          <div className="truncate" style={{ fontSize: 12, color: 'var(--ink-4)' }}>
            {dm.title}
          </div>
        </div>
        <ChannelDots contact={dm} />
      </div>

      {panel === 'none' && (
        <>
          <div className="flex flex-col gap-2 px-4 py-3">
            <ChannelRow
              icon={Mail}
              href={`mailto:${dm.email}`}
              value={dm.email}
              empty="Add an email address"
              onAdd={openEditor}
            />
            <ChannelRow
              icon={Phone}
              href={`tel:${tel}`}
              value={dm.phone}
              empty="Add a phone number"
              onAdd={openEditor}
            />
            <ChannelRow
              icon={Linkedin}
              href={dm.linkedin}
              value={dm.linkedin ? shortUrl(dm.linkedin) : ''}
              empty="Add a LinkedIn profile"
              onAdd={openEditor}
              mono={false}
              dim={!dm.linkedinVerified}
              trailing={
                !dm.linkedinVerified ? (
                  <span
                    className="pill pill-warn shrink-0 ml-auto"
                    title="The agent guessed this URL. Open it, then save the real one to confirm."
                  >
                    Unchecked
                  </span>
                ) : undefined
              }
            />
          </div>

          <div
            className="flex items-center gap-0.5 px-2.5 py-1.5 flex-wrap"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <button onClick={openEditor} className="btn btn-ghost btn-sm" style={{ padding: '0 9px', gap: 6 }}>
              Edit
            </button>
            {!dm.email && (
              <button
                onClick={runFinder}
                className="btn btn-ghost btn-sm"
                style={{ padding: '0 9px', gap: 6 }}
                title="Look this person up and check the result against their mail server"
              >
                Find email
              </button>
            )}
            {dm.linkedin && (
              <button onClick={openLinkedIn} className="btn btn-ghost btn-sm" style={{ padding: '0 9px', gap: 6 }}>
                {copied ? 'Copied' : campaign?.linkedinMessage ? 'Message' : 'Profile'}
              </button>
            )}
            {campaign?.callScriptHead && (
              <button
                onClick={() => setPanel('script')}
                className="btn btn-ghost btn-sm"
                style={{ padding: '0 9px', gap: 6 }}
              >
                Script
              </button>
            )}
          </div>
        </>
      )}

      {panel === 'edit' && (
        <div className="px-4 py-3 flex flex-col gap-2.5" style={{ borderTop: '1px solid var(--border)' }}>
          {(
            [
              ['Email', 'email', 'name@company.com'],
              ['Phone', 'phone', '+44 161 555 0134'],
              ['LinkedIn', 'linkedin', 'in/their-handle'],
            ] as const
          ).map(([label, key, placeholder]) => (
            <label key={key} className="block">
              <span className="eyebrow">{label}</span>
              <input
                autoFocus={key === 'email'}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save();
                  if (e.key === 'Escape') setPanel('none');
                }}
                placeholder={placeholder}
                className="field mt-1"
                style={{ fontSize: 13 }}
              />
            </label>
          ))}
          {error && <div style={{ fontSize: 12, color: 'var(--bad)' }}>{error}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn btn-primary btn-sm">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
            </button>
            <button onClick={() => setPanel('none')} className="btn btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {panel === 'find' && (
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="eyebrow">
              {finding ? 'Searching…' : `Candidates${found ? ` · ${found.domain}` : ''}`}
            </div>
            <button onClick={() => setPanel('none')} className="btn btn-ghost btn-sm" style={{ padding: '0 8px' }}>
              <X className="w-3.5 h-3.5" strokeWidth={2.4} />
            </button>
          </div>

          {finding && (
            <div className="py-6 grid place-items-center">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--ink-4)' }} />
            </div>
          )}

          {error && <div style={{ fontSize: 12, color: 'var(--bad)' }}>{error}</div>}

          {found && found.candidates.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Nothing found for this person.</div>
          )}

          <div className="flex flex-col gap-1.5">
            {found?.candidates.map((c) => (
              <div
                key={c.email}
                className="flex items-center gap-2 px-2.5 py-2"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  opacity: c.status === 'rejected' || c.status === 'no_mx' ? 0.5 : 1,
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="mono truncate" style={{ fontSize: 11.5 }} title={c.detail}>
                    {c.email}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={c.source === 'hunter' ? 'pill pill-good' : 'pill'}>
                      {c.source === 'hunter' ? 'Hunter' : 'Guess'}
                    </span>
                    <span className={VERIFY_STYLES[c.status].pill}>{VERIFY_STYLES[c.status].label}</span>
                  </div>
                </div>
                <button
                  onClick={() => useCandidate(c)}
                  disabled={applying !== null || c.status === 'no_mx'}
                  className="btn btn-sm shrink-0"
                  style={{ padding: '0 11px' }}
                >
                  {applying === c.email ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Use'}
                </button>
              </div>
            ))}
          </div>

          {found?.note && (
            <p className="quiet mt-2.5 flex items-start gap-2">
              <AlertTriangle
                className="w-3.5 h-3.5 mt-px shrink-0"
                strokeWidth={2.2}
                style={{ color: 'var(--warn)' }}
              />
              {found.note}
            </p>
          )}
        </div>
      )}

      {panel === 'script' && campaign && (
        <div className="px-4 py-3 flex flex-col gap-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <div className="eyebrow">Call script</div>
            <button onClick={() => setPanel('none')} className="btn btn-ghost btn-sm" style={{ padding: '0 8px' }}>
              <X className="w-3.5 h-3.5" strokeWidth={2.4} />
            </button>
          </div>
          <div>
            <div className="eyebrow mb-1">Opening line</div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
              {campaign.callScriptHead}
            </p>
          </div>
          {campaign.objectionHandling && (
            <div>
              <div className="eyebrow mb-1">If they push back</div>
              <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                {campaign.objectionHandling}
              </p>
            </div>
          )}
          {dm.phone ? (
            <a href={`tel:${tel}`} className="btn btn-primary btn-sm self-start">
              <Phone className="w-3.5 h-3.5" strokeWidth={2.4} />
              Call {dm.phone}
            </a>
          ) : (
            <button onClick={openEditor} className="btn btn-sm self-start">
              <Phone className="w-3.5 h-3.5" strokeWidth={2.4} />
              Add a number to dial
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function CompaniesView({
  companies,
  selected,
  onSelectionChange,
  onEnrichCompany,
  onUpdateContact,
  onFindEmail,
  onOpenSend,
  hasCampaign,
  getCampaign,
}: CompaniesViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'reach' | 'research'>('reach');
  const [business, setBusiness] = useState<BusinessFilter>('all');

  const q = query.trim().toLowerCase();
  const visible = companies.filter(
    (c) =>
      (business === 'all' || c.business === business) &&
      (!q || c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q)),
  );
  const countFor = (key: BusinessFilter) =>
    key === 'all' ? companies.length : companies.filter((c) => c.business === key).length;
  const detail = visible.find((c) => c.id === openId) ?? visible[0] ?? null;

  useEffect(() => {
    if (detail && detail.id !== openId) setOpenId(detail.id);
  }, [detail, openId]);

  if (companies.length === 0) {
    return (
      <div className="card p-16 text-center">
        <h2 className="card-title mb-2">No clients yet</h2>
        <p style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
          Run Discover and the agents will find clients matching your ICP.
        </p>
      </div>
    );
  }

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onSelectionChange(selected.filter((x) => x !== id));
    } else if (selected.length < MAX_BATCH) {
      onSelectionChange([...selected, id]);
    }
  };

  const readyIds = visible
    .filter((c) => hasCampaign(c.id) && c.decisionMakers.some((d) => d.email))
    .map((c) => c.id);
  const allReadySelected = readyIds.length > 0 && readyIds.every((id) => selected.includes(id));
  const withEmail = companies.filter((c) => c.decisionMakers.some((d) => d.email)).length;
  const detailCampaign = detail ? getCampaign(detail.id) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-sub">
            {companies.length} found · {withEmail} reachable by email
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Two businesses share this list; this is how you look at one. */}
          <div className="seg" role="tablist" aria-label="Business">
            {(['all', ...BUSINESSES.map((b) => b.key)] as BusinessFilter[]).map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={business === key}
                onClick={() => setBusiness(key)}
                className="seg-btn flex items-center gap-1.5"
              >
                {key === 'all' ? 'All' : BUSINESS_LABEL[key]}
                <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>
                  {countFor(key)}
                </span>
              </button>
            ))}
          </div>

          <div className="relative">
            <Search
              className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
              strokeWidth={2.4}
              style={{ color: 'var(--ink-4)' }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clients…"
              className="field"
              style={{ paddingLeft: 40, width: 220, borderRadius: 999 }}
            />
          </div>

          {readyIds.length > 0 && (
            <button
              onClick={() => onSelectionChange(allReadySelected ? [] : readyIds.slice(0, MAX_BATCH))}
              className="btn btn-sm"
            >
              {allReadySelected ? 'Clear' : `Select ${Math.min(readyIds.length, MAX_BATCH)}`}
            </button>
          )}

          {/* Enabled with nothing selected on purpose: the modal then offers
              everything that is sendable, which is the faster path. */}
          <button onClick={onOpenSend} className="btn btn-primary">
            <Send className="w-4 h-4" strokeWidth={2.4} />
            Send{selected.length > 0 ? ` ${selected.length}` : ''}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-5 items-start">

        {/* Client list */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 520 }}>
              <thead className="thead">
                <tr>
                  <th className="px-5 py-3" style={{ width: 44 }} />
                  <th className="text-left font-bold px-2 py-3">Client</th>
                  <th className="text-left font-bold px-3 py-3">Reach</th>
                  <th className="text-right font-bold px-5 py-3">ICP</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((company) => {
                  const active = detail?.id === company.id;
                  const contact = company.decisionMakers[0];
                  const ready = hasCampaign(company.id) && Boolean(contact?.email);
                  const on = selected.includes(company.id);
                  return (
                    <tr
                      key={company.id}
                      onClick={() => setOpenId(company.id)}
                      className="trow cursor-pointer"
                      style={{ background: active ? 'var(--surface-2)' : undefined }}
                    >
                      <td className="px-5 py-3.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (ready) toggle(company.id);
                          }}
                          disabled={!ready}
                          title={
                            ready
                              ? 'Include in the next send'
                              : contact?.email
                                ? 'No drafted campaign yet'
                                : 'Add an email address first'
                          }
                          className="grid place-items-center"
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 7,
                            border: `1.5px solid ${on ? 'var(--green)' : 'var(--border-strong)'}`,
                            background: on ? 'var(--green)' : 'transparent',
                            opacity: ready ? 1 : 0.35,
                            cursor: ready ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {on && <Check className="w-3 h-3 text-white" strokeWidth={3.4} />}
                        </button>
                      </td>
                      <td className="px-2 py-3.5">
                        <div className="truncate" style={{ fontSize: 14, fontWeight: 550 }}>
                          {company.name}
                        </div>
                        <div className="truncate" style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                          {company.industry}
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        {contact?.email ? (
                          <span className="mono truncate block" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                            {contact.email}
                          </span>
                        ) : (
                          <span className="pill pill-warn">Needs email</span>
                        )}
                        <div className="mt-1.5">
                          <ChannelDots contact={contact} />
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="figure" style={{ fontSize: 15, color: icpTone(company.icpScore) }}>
                          {company.icpScore}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {visible.length === 0 && (
            <div className="p-10 text-center" style={{ fontSize: 13.5, color: 'var(--ink-4)' }}>
              Nothing matches that search.
            </div>
          )}
        </div>

        {/* Detail */}
        {detail && (
          <div className="card xl:sticky xl:top-4 overflow-hidden">
            <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="card-title truncate">{detail.name}</div>
                  <div className="truncate" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                    {detail.industry} · {detail.revenue} · {detail.employees} staff
                  </div>
                </div>
                <span className="pill shrink-0" style={{ color: icpTone(detail.icpScore) }}>
                  ICP {detail.icpScore}
                </span>
              </div>

              <div className="meta mt-3">
                <span className="pill">{STAGE_LABELS[detail.stage ?? 'lead']}</span>
              </div>
              {(detail.website || detail.headquarters || detail.founded) && (
                <div className="meta mt-2">
                  {detail.website && (
                    <a
                      href={`https://${shortUrl(detail.website)}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-1.5"
                    >
                      <Globe className="w-3.5 h-3.5 shrink-0" strokeWidth={2.4} />
                      {shortUrl(detail.website)}
                      <ExternalLink className="w-3 h-3 shrink-0" strokeWidth={2.4} />
                    </a>
                  )}
                  {detail.headquarters && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 shrink-0" strokeWidth={2.4} />
                      {detail.headquarters}
                    </span>
                  )}
                  {detail.founded && (
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5 shrink-0" strokeWidth={2.4} />
                      {detail.founded}
                    </span>
                  )}
                </div>
              )}

              <div className="seg mt-4" role="tablist">
                {(['reach', 'research'] as const).map((key) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className="seg-btn"
                  >
                    {key === 'reach' ? 'Reach' : 'Research'}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6 flex flex-col gap-5">
              {tab === 'reach' && (
                <>
                  {detail.decisionMakers.map((dm) => (
                    <ContactCard
                      key={dm.id}
                      companyId={detail.id}
                      contact={dm}
                      campaign={detailCampaign?.decisionMakerId === dm.id ? detailCampaign : null}
                      onUpdateContact={onUpdateContact}
                      onFindEmail={onFindEmail}
                    />
                  ))}
                  <p className="quiet">
                    Addresses and numbers are found or typed, never generated.{' '}
                    <span style={{ fontWeight: 550 }}>Find email</span> looks the person up and
                    checks the result against their own mail server.
                  </p>
                </>
              )}

              {tab === 'research' && (
                <>
                  {detail.latestLaunch && (
                    <div
                      className="px-4 py-3.5 flex items-start gap-3"
                      style={{
                        background: 'var(--green-soft)',
                        border: '1px solid var(--green-border)',
                        borderRadius: 16,
                      }}
                    >
                      <Rocket
                        className="w-4 h-4 mt-0.5 shrink-0"
                        strokeWidth={2.2}
                        style={{ color: 'var(--green)' }}
                      />
                      <div className="min-w-0">
                        <div className="eyebrow mb-1">Latest launch</div>
                        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                          {detail.latestLaunch}
                        </p>
                      </div>
                    </div>
                  )}

                  <Chips label="Why this score" items={detail.icpReasons} />

                  <div>
                    <div className="eyebrow mb-2">Overview</div>
                    <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.65 }}>
                      {detail.description}
                    </p>
                  </div>

                  <Chips label="What they sell" items={detail.products} />
                  <Chips label="Why now" items={detail.buyingSignals} />
                  <Chips label="Likely pain points" items={detail.painPoints} />

                  {detail.recentNews && (
                    <div>
                      <div className="eyebrow mb-2">Recent signal</div>
                      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.65 }}>
                        {detail.recentNews}
                      </p>
                    </div>
                  )}

                  <div className="pt-5" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="eyebrow">Enrichment</div>
                      <span
                        className={
                          STATEMENT_STYLES[detail.enrichmentType ?? 'generation'].pill
                        }
                        title={STATEMENT_STYLES[detail.enrichmentType ?? 'generation'].note}
                      >
                        {STATEMENT_STYLES[detail.enrichmentType ?? 'generation'].label}
                      </span>
                    </div>
                    {detail.linkedinData ? (
                      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.65 }}>
                        {detail.linkedinData}
                      </p>
                    ) : (
                      <button
                        onClick={() => onEnrichCompany(detail.id)}
                        disabled={detail.isEnriching}
                        className="btn w-full btn-sm"
                      >
                        {detail.isEnriching ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Enriching…
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" strokeWidth={2.4} /> Run enrichment
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </>
              )}

              <div
                className="flex items-center justify-between pt-4"
                style={{ borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--ink-3)' }}
              >
                <span className="flex items-center gap-2">
                  <span
                    className="rounded-full"
                    style={{ width: 8, height: 8, background: FRESHNESS_COLORS[detail.freshness] }}
                  />
                  {FRESHNESS_LABELS[detail.freshness]}
                </span>
                <span className="mono">Verified {detail.freshnessDays}d ago</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
