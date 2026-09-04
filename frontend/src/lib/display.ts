/** Shared display helpers for record freshness and agent statement types. */

import { FreshnessBand, StatementType } from '../types';

/** Ordinal indigo ramp, light to dark as records decay. Validated on white. */
export const FRESHNESS_COLORS: Record<FreshnessBand, string> = {
  fresh: 'var(--fresh-1)',
  good: 'var(--fresh-2)',
  aging: 'var(--fresh-3)',
  stale: 'var(--fresh-4)',
  critical: 'var(--fresh-5)',
};

export const FRESHNESS_LABELS: Record<FreshnessBand, string> = {
  fresh: 'Fresh',
  good: 'Good',
  aging: 'Aging',
  stale: 'Stale',
  critical: 'Critical',
};

/**
 * Data / inference / generation are never mixed, and only DATA may be quoted
 * back to a prospect. The visible label is what makes that real.
 */
export const STATEMENT_STYLES: Record<
  StatementType,
  { label: string; pill: string; note: string }
> = {
  data: {
    label: 'Data',
    pill: 'pill pill-good',
    note: 'Observed and sourced. Safe to quote to a prospect.',
  },
  inference: {
    label: 'Inference',
    pill: 'pill pill-warn',
    note: 'Derived, not observed. Use it to pick an angle, never as a claim.',
  },
  generation: {
    label: 'Generated',
    pill: 'pill',
    note: 'Written by the model. Never quote this to a prospect.',
  },
};

export function icpTone(score: number): string {
  if (score >= 75) return 'var(--good)';
  if (score >= 50) return 'var(--warn)';
  return 'var(--bad)';
}
