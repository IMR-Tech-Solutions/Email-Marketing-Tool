import { Business } from '../types';

/** The two businesses that send from this workspace, in display order. */
export const BUSINESSES: { key: Business; label: string }[] = [
  { key: 'tech', label: 'Tech Solutions' },
  { key: 'market_research', label: 'Market Research' },
];

export const BUSINESS_LABEL: Record<Business, string> = {
  tech: 'Tech Solutions',
  market_research: 'Market Research',
};

export type BusinessFilter = 'all' | Business;
