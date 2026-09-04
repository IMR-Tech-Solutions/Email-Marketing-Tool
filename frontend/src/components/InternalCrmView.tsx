import React, { useState } from 'react';
import { Company, CrmStage } from '../types';
import { FRESHNESS_COLORS, STATEMENT_STYLES, icpTone } from '../lib/display';
import { Sparkles, Loader2 } from 'lucide-react';

interface InternalCrmViewProps {
  companies: Company[];
  onStageChange: (companyId: string, stage: CrmStage) => void;
  onEnrichCompany: (companyId: string) => void;
  isLoading?: boolean;
}

const STAGES: { id: CrmStage; label: string; color: string }[] = [
  { id: 'lead', label: 'Lead', color: 'var(--ink-4)' },
  { id: 'contacted', label: 'Contacted', color: 'var(--fresh-1)' },
  { id: 'engaged', label: 'Engaged', color: 'var(--fresh-2)' },
  { id: 'proposal', label: 'Proposal', color: 'var(--fresh-3)' },
  { id: 'won', label: 'Won', color: 'var(--good)' },
  { id: 'lost', label: 'Lost', color: 'var(--bad)' },
];

export function InternalCrmView({
  companies,
  onStageChange,
  onEnrichCompany,
  isLoading = false,
}: InternalCrmViewProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<CrmStage | null>(null);

  const handleDrop = (e: React.DragEvent, stage: CrmStage) => {
    e.preventDefault();
    setOverStage(null);
    if (draggedId) {
      onStageChange(draggedId, stage);
      setDraggedId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 h-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Deal Board</h1>
          <p className="page-sub">Drag to change stage. Every move is saved.</p>
        </div>
        {isLoading && (
          <span className="pill">
            <Loader2 className="w-3 h-3 animate-spin" /> Syncing
          </span>
        )}
      </div>

      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex gap-3.5 min-w-max items-start h-full">
          {STAGES.map((stage) => {
            const cards = companies.filter((c) => (c.stage || 'lead') === stage.id);
            const isOver = overStage === stage.id;
            return (
              <div
                key={stage.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStage(stage.id);
                }}
                onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
                onDrop={(e) => handleDrop(e, stage.id)}
                className="rounded-[14px] flex flex-col transition-colors"
                style={{
                  width: 268,
                  background: isOver ? 'var(--green-soft)' : 'var(--surface-2)',
                  border: `1px solid ${isOver ? 'var(--green-border)' : 'var(--border)'}`,
                }}
              >
                <div className="flex items-center justify-between px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full" style={{ width: 7, height: 7, background: stage.color }} />
                    <span className="text-[13px] font-semibold">{stage.label}</span>
                  </div>
                  <span className="mono text-[12px]" style={{ color: 'var(--ink-4)' }}>
                    {cards.length}
                  </span>
                </div>

                <div className="px-2.5 pb-2.5 flex flex-col gap-2 flex-1" style={{ minHeight: 140 }}>
                  {cards.map((company) => (
                    <div
                      key={company.id}
                      draggable
                      onDragStart={(e) => {
                        setDraggedId(company.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', company.id);
                      }}
                      onDragEnd={() => setDraggedId(null)}
                      className="card p-3 cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md"
                      style={{ opacity: draggedId === company.id ? 0.4 : 1 }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <span className="text-[13px] font-medium truncate" title={company.name}>
                          {company.name}
                        </span>
                        <span
                          className="mono text-[12px] font-medium shrink-0"
                          style={{ color: icpTone(company.icpScore) }}
                        >
                          {company.icpScore}
                        </span>
                      </div>

                      <div className="text-[12px] truncate mb-2.5" style={{ color: 'var(--ink-3)' }}>
                        {company.industry}
                      </div>

                      {company.linkedinData && company.enrichmentType && (
                        <div
                          className="rounded-[9px] px-2.5 py-2 mb-2.5"
                          style={{ background: 'var(--surface-2)' }}
                        >
                          <span
                            className={STATEMENT_STYLES[company.enrichmentType].pill}
                            style={{ fontSize: 10, padding: '1px 6px' }}
                            title={STATEMENT_STYLES[company.enrichmentType].note}
                          >
                            {STATEMENT_STYLES[company.enrichmentType].label}
                          </span>
                          <p
                            className="text-[11.5px] mt-1.5 leading-snug"
                            style={{
                              color: 'var(--ink-3)',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {company.linkedinData}
                          </p>
                        </div>
                      )}

                      <div
                        className="flex items-center justify-between pt-2.5"
                        style={{ borderTop: '1px solid var(--border)' }}
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className="rounded-full"
                            title={`Verified ${company.freshnessDays} day(s) ago`}
                            style={{ width: 7, height: 7, background: FRESHNESS_COLORS[company.freshness] }}
                          />
                          {company.needsRetouch && (
                            <span className="text-[10.5px] font-medium" style={{ color: 'var(--warn)' }}>
                              Retouch
                            </span>
                          )}
                        </span>

                        {!company.linkedinData && (
                          <button
                            onClick={() => onEnrichCompany(company.id)}
                            disabled={company.isEnriching}
                            className="flex items-center gap-1 text-[11.5px] font-medium"
                            style={{ color: company.isEnriching ? 'var(--ink-4)' : 'var(--green)' }}
                          >
                            {company.isEnriching ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Sparkles className="w-3 h-3" strokeWidth={2} />
                            )}
                            {company.isEnriching ? 'Enriching' : 'Enrich'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {cards.length === 0 && (
                    <div
                      className="flex-1 grid place-items-center rounded-[10px] text-[12px]"
                      style={{
                        border: '1px dashed var(--border-strong)',
                        color: 'var(--ink-4)',
                        minHeight: 80,
                      }}
                    >
                      Drop here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
