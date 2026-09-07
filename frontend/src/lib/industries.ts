/**
 * The industry filter's pick-list.
 *
 * These are only a typing shortcut. The filter itself is free text — anything
 * the user types in "Custom" is passed to the discovery agent verbatim — so
 * this list does not have to be exhaustive, and nothing breaks when a sector
 * is missing from it. Grouped the way a rep thinks about verticals rather
 * than by any standard code, because the picker is scanned by eye.
 */

export interface IndustryGroup {
  head: string;
  items: string[];
}

export const INDUSTRY_GROUPS: IndustryGroup[] = [
  {
    head: 'Industrial',
    items: [
      'Manufacturing',
      'Automotive & Transport',
      'Aerospace & Defence',
      'Electronics & Semiconductors',
      'Chemicals & Materials',
      'Construction & Building Materials',
      'Mining & Metals',
      'Packaging',
      'Industrial Automation',
    ],
  },
  {
    head: 'Technology',
    items: [
      'Software & SaaS',
      'IT Services & Consulting',
      'Cybersecurity',
      'Cloud & Infrastructure',
      'Artificial Intelligence & Data',
      'Telecommunications',
      'Consumer Electronics',
      'Gaming & Interactive Media',
    ],
  },
  {
    head: 'Life Sciences',
    items: [
      'Healthcare Providers',
      'Pharmaceuticals',
      'Biotechnology',
      'Medical Devices',
      'Diagnostics & Lab Services',
      'Digital Health',
    ],
  },
  {
    head: 'Financial',
    items: [
      'Banking',
      'Insurance',
      'Financial Services',
      'Fintech & Payments',
      'Private Equity & Venture Capital',
      'Real Estate & PropTech',
    ],
  },
  {
    head: 'Consumer',
    items: [
      'Retail & E-commerce',
      'Consumer Goods & FMCG',
      'Food & Beverage',
      'Apparel & Fashion',
      'Travel & Hospitality',
      'Media & Entertainment',
      'Sports & Fitness',
    ],
  },
  {
    head: 'Energy & Infrastructure',
    items: [
      'Energy & Utilities',
      'Oil & Gas',
      'Renewable Energy',
      'Agriculture & AgriTech',
      'Logistics & Supply Chain',
      'Environmental Services',
    ],
  },
  {
    head: 'Services & Public',
    items: [
      'Professional Services',
      'Marketing & Advertising',
      'Education & EdTech',
      'Government & Public Sector',
      'Non-profit & NGO',
      'Legal Services',
      'Human Resources & Staffing',
    ],
  },
];

/** Flat list, for searching and for the "is this a known sector" check. */
export const ALL_INDUSTRIES: string[] = INDUSTRY_GROUPS.flatMap((g) => g.items);
