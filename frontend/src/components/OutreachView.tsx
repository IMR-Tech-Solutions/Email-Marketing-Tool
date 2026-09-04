import React, { useEffect, useState } from 'react';
import { Company, OutreachCampaign } from '../types';
import { Mail, Linkedin, Phone, ShieldAlert, Copy, Check, Search } from 'lucide-react';

interface OutreachViewProps {
  companies: Company[];
  outreachCampaigns: OutreachCampaign[];
}

type Channel = 'email' | 'linkedin' | 'call';

const CHANNELS: { key: Channel; label: string; icon: typeof Mail }[] = [
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'linkedin', label: 'LinkedIn', icon: Linkedin },
  { key: 'call', label: 'Call', icon: Phone },
];

export function OutreachView({ companies, outreachCampaigns }: OutreachViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>('email');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const q = query.trim().toLowerCase();
  const nameFor = (id: string) => companies.find((c) => c.id === id)?.name ?? 'Unknown account';

  const visible = outreachCampaigns.filter(
    (c) => !q || nameFor(c.companyId).toLowerCase().includes(q) || c.emailSubject.toLowerCase().includes(q),
  );

  const selected = visible.find((c) => c.companyId === selectedId) ?? visible[0] ?? null;

  useEffect(() => {
    if (selected && selected.companyId !== selectedId) setSelectedId(selected.companyId);
  }, [selected, selectedId]);

  if (outreachCampaigns.length === 0) {
    return (
      <div className="card p-16 text-center">
        <div className="card-title mb-1.5">No campaigns yet</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          Run Discover and the personalization agent will draft copy for each account.
        </p>
      </div>
    );
  }

  const company = selected ? companies.find((c) => c.id === selected.companyId) : undefined;
  const dm = company?.decisionMakers.find((d) => d.id === selected?.decisionMakerId);
  const score = selected?.personalizationScore ?? 0;
  const scoreColor = score >= 75 ? 'var(--good)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';

  const copyText =
    channel === 'email'
      ? `${selected?.emailSubject ?? ''}\n\n${selected?.emailBody ?? ''}`
      : channel === 'linkedin'
        ? selected?.linkedinMessage ?? ''
        : `${selected?.callScriptHead ?? ''}\n\nIf they push back:\n${selected?.objectionHandling ?? ''}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — nothing useful to say about it */
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-sub">
            {outreachCampaigns.length} drafted · send them from Clients, or in bulk from
            Bulk Outreach
          </p>
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
            placeholder="Search drafts…"
            className="field"
            style={{ paddingLeft: 40, width: 240, borderRadius: 999 }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-5 items-start">

        {/* Drafts */}
        <div className="card overflow-hidden">
          <div style={{ maxHeight: 620, overflowY: 'auto' }}>
            {visible.map((campaign) => {
              const active = selected?.companyId === campaign.companyId;
              return (
                <button
                  key={`${campaign.companyId}-${campaign.decisionMakerId}`}
                  onClick={() => setSelectedId(campaign.companyId)}
                  className="w-full text-left flex items-center gap-3 px-4 py-3.5 trow"
                  style={{ background: active ? 'var(--green-soft)' : undefined }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate" style={{ fontSize: 13.5, fontWeight: 550 }}>
                      {nameFor(campaign.companyId)}
                    </div>
                    <div className="truncate" style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                      {campaign.emailSubject}
                    </div>
                  </div>
                  <span
                    className="figure shrink-0"
                    style={{
                      fontSize: 13,
                      color:
                        campaign.personalizationScore >= 75 ? 'var(--good)' : 'var(--ink-4)',
                    }}
                  >
                    {campaign.personalizationScore}
                  </span>
                </button>
              );
            })}
            {visible.length === 0 && (
              <div className="p-8 text-center" style={{ fontSize: 13, color: 'var(--ink-4)' }}>
                Nothing matches that search.
              </div>
            )}
          </div>
        </div>

        {/* The draft */}
        {selected && (
          <div className="card overflow-hidden">
            <div className="card-head">
              <div className="min-w-0">
                <div className="card-title truncate">{company?.name ?? 'Account'}</div>
                <div className="truncate" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                  {dm ? `${dm.name} · ${dm.title}` : 'Contact'}
                </div>
              </div>
              <span
                className="pill shrink-0"
                style={{ color: scoreColor }}
                title="The model's own assessment of how specific this copy is. A template with the name swapped in scores low."
              >
                Personalization {score}
              </span>
            </div>

            <div className="px-6 pt-5 flex items-center justify-between gap-3 flex-wrap">
              <div className="seg" role="tablist">
                {CHANNELS.map((c) => (
                  <button
                    key={c.key}
                    role="tab"
                    aria-selected={channel === c.key}
                    onClick={() => setChannel(c.key)}
                    className="seg-btn flex items-center gap-1.5"
                  >
                    <c.icon className="w-3.5 h-3.5" strokeWidth={2.4} />
                    {c.label}
                  </button>
                ))}
              </div>

              <button onClick={copy} className="btn btn-sm">
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" strokeWidth={3} /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" strokeWidth={2.4} /> Copy
                  </>
                )}
              </button>
            </div>

            <div className="p-6">
              {channel === 'email' && (
                <div className="letter">
                  <div className="letter-head">{selected.emailSubject}</div>
                  <div className="letter-body">{selected.emailBody}</div>
                </div>
              )}

              {channel === 'linkedin' && (
                <div className="letter">
                  <div className="letter-head flex items-center gap-2">
                    <Linkedin className="w-3.5 h-3.5" strokeWidth={2.4} style={{ color: 'var(--ink-4)' }} />
                    Connection message
                  </div>
                  <div className="letter-body">{selected.linkedinMessage}</div>
                </div>
              )}

              {channel === 'call' && (
                <div className="flex flex-col gap-4">
                  <div className="letter">
                    <div className="letter-head flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5" strokeWidth={2.4} style={{ color: 'var(--green)' }} />
                      Opening line
                    </div>
                    <div className="letter-body">{selected.callScriptHead}</div>
                  </div>
                  <div className="letter">
                    <div className="letter-head flex items-center gap-2">
                      <ShieldAlert className="w-3.5 h-3.5" strokeWidth={2.4} style={{ color: 'var(--warn)' }} />
                      If they push back
                    </div>
                    <div className="letter-body">{selected.objectionHandling}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
