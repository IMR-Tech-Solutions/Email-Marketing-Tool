import React from 'react';
import { Company, OutreachCampaign } from '../types';

interface AnalyticsViewProps {
  companies: Company[];
  outreachCampaigns: OutreachCampaign[];
}

const STAGES = ['lead', 'contacted', 'engaged', 'proposal', 'won', 'lost'];
const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  contacted: 'Contacted',
  engaged: 'Engaged',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
};

export function AnalyticsView({ companies, outreachCampaigns }: AnalyticsViewProps) {
  const avgIcp = companies.length
    ? Math.round(companies.reduce((a, c) => a + c.icpScore, 0) / companies.length)
    : 0;
  const avgPers = outreachCampaigns.length
    ? Math.round(
        outreachCampaigns.reduce((a, c) => a + c.personalizationScore, 0) / outreachCampaigns.length,
      )
    : 0;
  const contacts = companies.reduce((a, c) => a + c.decisionMakers.length, 0);
  const enriched = companies.filter((c) => c.linkedinData).length;

  const counts = STAGES.map((s) => ({
    stage: s,
    count: companies.filter((c) => (c.stage || 'lead') === s).length,
  }));
  const peak = Math.max(1, ...counts.map((c) => c.count));

  const tiles: [string, string, string][] = [
    ['Accounts', String(companies.length), `${contacts} contacts identified`],
    ['Average ICP', String(avgIcp), 'Across all accounts'],
    ['Campaigns', String(outreachCampaigns.length), `Avg personalization ${avgPers}`],
    ['Enriched', String(enriched), `${companies.length - enriched} not yet enriched`],
  ];

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 1000 }}>
      <div>
        <h1 className="page-title">Analytics</h1>
        <p className="page-sub">
          Pipeline shape. Open rates are deliberately absent — this app does not send mail.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {tiles.map(([label, value, note], i) => (
          <div key={label} className="card p-4 rise" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="text-[12.5px] font-medium mb-3" style={{ color: 'var(--ink-3)' }}>
              {label}
            </div>
            <div className="mono text-[26px] font-semibold tracking-[-0.03em] leading-none">{value}</div>
            <div className="mt-2 text-[12px]" style={{ color: 'var(--ink-3)' }}>{note}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Stage distribution</div>
        </div>
        <div className="p-5 flex flex-col gap-3">
          {counts.map(({ stage, count }) => (
            <div key={stage} className="flex items-center gap-3.5 text-[13px]">
              <span style={{ width: 84, color: 'var(--ink-3)' }}>{STAGE_LABELS[stage]}</span>
              <span
                className="flex-1 rounded-full overflow-hidden"
                style={{ height: 8, background: 'var(--surface-3)' }}
              >
                <span
                  className="block h-full rounded-full transition-all"
                  style={{
                    width: `${(count / peak) * 100}%`,
                    background:
                      stage === 'won'
                        ? 'var(--good)'
                        : stage === 'lost'
                          ? 'var(--bad)'
                          : 'var(--green)',
                  }}
                />
              </span>
              <span className="mono font-medium" style={{ width: 30, textAlign: 'right' }}>
                {count}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
