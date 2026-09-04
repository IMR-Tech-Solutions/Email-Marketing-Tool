import React from 'react';
import { PriorityQueueResponse } from '../types';
import { ArrowRight, ListOrdered } from 'lucide-react';

interface PriorityQueueViewProps {
  data: PriorityQueueResponse | null;
  isLoading: boolean;
  onNavigate: (view: string) => void;
}

function scoreTone(score: number): string {
  if (score >= 70) return 'var(--good)';
  if (score >= 40) return 'var(--warn)';
  return 'var(--ink-3)';
}

export function PriorityQueueView({ data, isLoading, onNavigate }: PriorityQueueViewProps) {
  if (!data) {
    return (
      <div className="py-24 text-center text-[13.5px]" style={{ color: 'var(--ink-4)' }}>
        {isLoading ? 'Building the queue…' : 'No data'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 1000 }}>
      <div>
        <h1 className="page-title">Priority Queue</h1>
        <p className="page-sub">
          Who deserves attention now, ranked. The reasoning is on every row.
        </p>
      </div>

      {data.items.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="card-title mb-1.5">Nothing is waiting</div>
          <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
            No replies to answer, no qualified accounts left unworked.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {data.items.map((item, i) => (
            <div key={item.companyId} className="flex items-start gap-4 px-5 py-4 trow">
              <div
                className="grid place-items-center rounded-[10px] shrink-0 mono text-[13px] font-semibold"
                style={{ width: 34, height: 34, background: 'var(--surface-3)', color: 'var(--ink-3)' }}
              >
                {i + 1}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-medium">{item.company}</span>
                  <span className="text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                    {item.contact !== '-' && `${item.contact} · ${item.contactTitle}`}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-2">
                  {item.reasons.map((reason, r) => (
                    <span key={r} className="pill">{reason}</span>
                  ))}
                </div>
              </div>

              <div className="text-right shrink-0 flex flex-col items-end gap-2">
                <div>
                  <div className="eyebrow">Priority</div>
                  <div
                    className="mono text-[19px] font-semibold leading-none mt-1"
                    style={{ color: scoreTone(item.score) }}
                  >
                    {item.score}
                  </div>
                </div>
                <button
                  onClick={() => onNavigate(item.view)}
                  className="text-[12.5px] font-medium flex items-center gap-1"
                  style={{ color: 'var(--green)' }}
                >
                  {item.action}
                  <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="flex items-center gap-2">
            <ListOrdered className="w-4 h-4" strokeWidth={2} style={{ color: 'var(--ink-4)' }} />
            <div className="card-title">How this is ranked</div>
          </div>
        </div>
        <div className="p-5">
          <ol className="flex flex-col gap-2">
            {data.weighting.map((w, i) => (
              <li key={i} className="flex items-start gap-3 text-[13px]">
                <span className="mono text-[11px] mt-0.5" style={{ color: 'var(--ink-4)' }}>
                  {i + 1}
                </span>
                <span style={{ color: 'var(--ink-2)' }}>{w}</span>
              </li>
            ))}
          </ol>
          <p className="text-[12.5px] mt-4 leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            The reasoning is shown on every row because a queue you cannot argue with is a
            queue nobody uses.
          </p>
        </div>
      </div>
    </div>
  );
}
