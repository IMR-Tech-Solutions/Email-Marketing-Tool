import React from 'react';
import { AgentsResponse } from '../types';
import { Shield } from 'lucide-react';

interface AgentsViewProps {
  data: AgentsResponse | null;
  isLoading: boolean;
}

function usd(v: number): string {
  if (!v) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(2)}`;
}

export function AgentsView({ data, isLoading }: AgentsViewProps) {
  if (!data) {
    return (
      <div className="py-24 text-center text-[13.5px]" style={{ color: 'var(--ink-4)' }}>
        {isLoading ? 'Loading…' : 'No data'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 1100 }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">AI Agents</h1>
          <p className="page-sub">
            {data.agents.length} agents · {usd(data.totalCostUsd)} spent to date
          </p>
        </div>
        <div className="flex gap-2">
          <span className="pill pill-brand mono">{data.modelLarge}</span>
          <span className="pill mono">{data.modelSmall}</span>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 780 }}>
            <thead className="thead">
              <tr>
                <th className="text-left font-medium px-5 py-2.5">Agent</th>
                <th className="text-left font-medium px-3 py-2.5">Trigger</th>
                <th className="text-left font-medium px-3 py-2.5">Tier</th>
                <th className="text-right font-medium px-3 py-2.5">Runs</th>
                <th className="text-right font-medium px-3 py-2.5">Avg cost</th>
                <th className="text-right font-medium px-5 py-2.5">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map((agent) => (
                <tr key={agent.name} className="trow">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-full shrink-0"
                        style={{
                          width: 7,
                          height: 7,
                          background: agent.calls > 0 ? 'var(--good)' : 'var(--border-strong)',
                        }}
                        title={agent.calls > 0 ? 'Has run' : 'Not run yet'}
                      />
                      <span className="text-[13.5px] font-medium">{agent.name}</span>
                    </div>
                    <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                      {agent.role}
                    </p>
                    <p className="text-[12px] mt-1.5" style={{ color: 'var(--ink-4)' }}>
                      Approval: {agent.approval}
                    </p>
                  </td>
                  <td className="px-3 py-4 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                    {agent.trigger}
                  </td>
                  <td className="px-3 py-4">
                    <span className={agent.tier === 'large' ? 'pill pill-brand' : 'pill'}>
                      {agent.tier}
                    </span>
                    <div className="mono text-[11px] mt-1.5" style={{ color: 'var(--ink-4)' }}>
                      {agent.model}
                    </div>
                  </td>
                  <td className="px-3 py-4 text-right mono text-[13px]">{agent.calls}</td>
                  <td className="px-3 py-4 text-right mono text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                    {agent.calls ? usd(agent.avgCostUsd) : '—'}
                  </td>
                  <td className="px-5 py-4 text-right mono text-[13px] font-medium">
                    {usd(agent.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
            <div className="card-title">Orchestrator policy</div>
          </div>
        </div>
        <div className="p-5 flex flex-col gap-3">
          {data.orchestratorPolicy.map((rule, i) => (
            <div key={i} className="flex items-start gap-3 text-[13px]">
              <span
                className="rounded-full shrink-0 mt-1.5"
                style={{ width: 5, height: 5, background: 'var(--green)' }}
              />
              <span style={{ color: 'var(--ink-2)' }}>{rule}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
