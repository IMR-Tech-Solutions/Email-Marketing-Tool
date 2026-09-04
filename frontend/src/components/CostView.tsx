import React from 'react';
import { CostResponse } from '../types';
import { Cpu, Clock, Coins } from 'lucide-react';

interface CostViewProps {
  data: CostResponse | null;
  isLoading: boolean;
}

const AGENT_LABELS: Record<string, string> = {
  discovery: 'Discovery & research',
  personalization: 'Outreach & personalization',
  enrichment: 'Enrichment',
};

function usd(value: number): string {
  if (!value) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(2)}`;
}

export function CostView({ data, isLoading }: CostViewProps) {
  if (!data) {
    return (
      <div className="py-24 text-center text-[13.5px]" style={{ color: 'var(--ink-4)' }}>
        {isLoading ? 'Loading spend…' : 'No data'}
      </div>
    );
  }

  const maxSpend = Math.max(...data.byAgent.map((a) => a.costUsd), 0.000001);

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 1100 }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Cost</h1>
          <p className="page-sub">
            Measured from the token usage of every Claude call, not estimated
          </p>
        </div>
        <span className="pill">
          <Coins className="w-3.5 h-3.5" strokeWidth={2} />
          {data.totalCalls} calls
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {[
          ['Total spend', usd(data.totalCostUsd), `${data.totalCalls} model calls`],
          ['Per account', usd(data.costPerCompany), 'Every account discovered'],
          ['Per qualified account', usd(data.costPerQualified), 'The number that matters'],
        ].map(([label, value, note], i) => (
          <div key={label} className="card p-4 rise" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="text-[12.5px] font-medium mb-3" style={{ color: 'var(--ink-3)' }}>
              {label}
            </div>
            <div className="mono text-[26px] font-semibold tracking-[-0.03em] leading-none">{value}</div>
            <div className="mt-2 text-[12px]" style={{ color: 'var(--ink-3)' }}>{note}</div>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="card-head">
          <div className="card-title">Where the money goes</div>
          <span className="mono text-[12px]" style={{ color: 'var(--ink-3)' }}>
            {data.inputTokens.toLocaleString()} in / {data.outputTokens.toLocaleString()} out
          </span>
        </div>

        {data.byAgent.length === 0 ? (
          <div className="p-12 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
            Nothing spent yet. Run the agents and this fills in.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 620 }}>
              <thead className="thead">
                <tr>
                  <th className="text-left font-medium px-5 py-2.5">Agent</th>
                  <th className="text-left font-medium px-3 py-2.5">Model</th>
                  <th className="text-right font-medium px-3 py-2.5">Calls</th>
                  <th className="text-right font-medium px-3 py-2.5">Tokens</th>
                  <th className="text-right font-medium px-5 py-2.5">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.byAgent.map((agent) => (
                  <tr key={`${agent.agent}-${agent.model}`} className="trow">
                    <td className="px-5 py-3.5">
                      <div className="text-[13.5px] font-medium mb-1.5">
                        {AGENT_LABELS[agent.agent] ?? agent.agent}
                      </div>
                      <div
                        className="rounded-full overflow-hidden"
                        style={{ width: 132, height: 4, background: 'var(--surface-3)' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(3, (agent.costUsd / maxSpend) * 100)}%`,
                            background: 'var(--green)',
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="pill mono">{agent.model}</span>
                    </td>
                    <td className="px-3 py-3.5 text-right mono text-[13px]">{agent.calls}</td>
                    <td className="px-3 py-3.5 text-right mono text-[12px]" style={{ color: 'var(--ink-3)' }}>
                      {agent.inputTokens.toLocaleString()} / {agent.outputTokens.toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-right mono text-[13px] font-medium">
                      {usd(agent.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <div className="card">
          <div className="card-head">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
              <div className="card-title">Model routing</div>
            </div>
          </div>
          <div className="p-5">
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              Route models by task, not by habit. Research and personalization decide reply
              rates, so they get the large model. Enrichment is short and structured, so it goes
              to the small one.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
                  Large — discovery, outreach
                </span>
                <span className="pill pill-brand mono">{data.modelLarge}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
                  Small — enrichment
                </span>
                <span className="pill mono">{data.modelSmall}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
              <div className="card-title">Refresh policy</div>
            </div>
          </div>
          <div className="p-5">
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              A record is re-verified when its freshness has decayed <em>and</em> something
              depends on it. Refreshing everything on a calendar is the expensive way to be wrong.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {data.refreshPolicy.map((rule) => (
                <div key={rule.band} className="flex items-center justify-between gap-4 text-[13px]">
                  <span style={{ color: 'var(--ink-3)' }}>{rule.band}</span>
                  <span className="font-medium">{rule.interval}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
