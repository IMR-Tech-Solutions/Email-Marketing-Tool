/**
 * Ready-to-run ICP prompts, written from the two live service lines.
 *
 * Each one follows the same four-part shape the discovery agent scores best
 * against: who they are, why now (the buying signals), what we sell, and who
 * decides. The "why now" block is what produces sharp ICP reason codes and
 * gives the outreach agent something concrete to open on.
 */

export interface IcpPreset {
  id: string;
  group: string;
  label: string;
  hint: string;
  text: string;
}

export const ICP_PRESETS: IcpPreset[] = [
  // ---- Introspective Market Research ----
  {
    id: 'syndicated',
    group: 'Market Research',
    label: 'Market sizing & forecasts',
    hint: 'Firms entering a new geography or category',
    text: `Mid-size and large B2B manufacturers and technology companies with 200-5,000 employees across North America, Europe and APAC that are entering a new geography or product category and need defensible market sizing before they commit budget. Focus on manufacturing, automotive and transport, electronics and semiconductors, chemicals and materials, healthcare, and energy.

Strong signals: recently announced an expansion, a new product line or a funding round; publicly hiring strategy, corporate development or product marketing roles; or quoted in trade press about entering a new market.

We sell syndicated and custom market research - market sizing, segmentation, competitive intelligence, global market analysis and forecasting.

Target the Head of Strategy, VP Corporate Development, Product Marketing Director or Market Intelligence Manager.`,
  },
  {
    id: 'mna',
    group: 'Market Research',
    label: 'M&A due diligence',
    hint: 'PE, VC and corporate development teams',
    text: `Private equity firms, venture funds, investment banks and corporate development teams in North America and Europe that are actively evaluating acquisitions in industrial, healthcare, chemicals or technology sectors and need commercial due diligence on a deal timeline.

Strong signals: recently closed a fund, announced a platform acquisition, publicly hiring associates or corp dev staff, or signalled intent to acquire in a sector they have not held before.

We provide commercial due diligence, target screening, market assessment and impact analysis for M&A.

Target the Partner, Principal, VP Corporate Development or Head of M&A.`,
  },
  {
    id: 'npd',
    group: 'Market Research',
    label: 'Product & concept testing',
    hint: 'Teams launching in the next 2-4 quarters',
    text: `Consumer goods, food and beverage, medical device and consumer electronics companies with 100-2,000 employees launching a new product in the next two to four quarters, where the concept has not been validated with real buyers.

Strong signals: hiring product managers or innovation leads, announcing an R&D or plant investment, entering an adjacent category, or relaunching a product that previously underperformed.

We run primary research - surveys, in-depth interviews, focus groups, ethnography, concept testing, pricing research and product-market fit studies.

Target the Head of Innovation, VP Product, Consumer Insights Manager or Brand Director.`,
  },

  // ---- IMR Tech Solutions ----
  {
    id: 'web',
    group: 'Tech Solutions',
    label: 'Website & web app rebuilds',
    hint: 'Businesses losing enquiries to a dated site',
    text: `Small and mid-sized businesses with 20-300 employees whose website is outdated, slow or not mobile-friendly and is now costing them enquiries - healthcare clinics, education providers, food and beverage brands, retail and e-commerce sellers, logistics operators and professional services firms.

Strong signals: running paid ads that land on a weak page, recently opened a new location, hiring sales or marketing staff, or announcing a product line their current site does not reflect.

We build modern web applications and company websites in React, Next.js, Node.js and Python, plus iOS and Android apps.

Target the Founder, Managing Director, Head of Marketing or IT Manager.`,
  },
  {
    id: 'automation',
    group: 'Tech Solutions',
    label: 'AI & workflow automation',
    hint: 'Ops teams still running on spreadsheets',
    text: `Operations-heavy companies with 50-1,000 employees still running core workflows on spreadsheets, email threads and manual data entry - logistics and fulfilment, healthcare administration, financial services back-office, e-commerce operations and research operations.

Strong signals: hiring data entry, back-office or operations coordinators; scaling headcount faster than revenue; publicly citing turnaround time or accuracy problems; or recently adding a system that now needs integrating.

We build intelligent automation - document processing, workflow automation, internal tools and AI-assisted operations using Python, FastAPI and modern LLM tooling.

Target the COO, Head of Operations, IT Director or Founder.`,
  },
  {
    id: 'enterprise',
    group: 'Tech Solutions',
    label: 'Custom enterprise software',
    hint: 'Outgrown off-the-shelf tools',
    text: `Companies with 100-2,000 employees that have outgrown off-the-shelf software and are running the business on spreadsheets or a patchwork of disconnected tools - manufacturing, financial services, healthcare, education and e-commerce.

Strong signals: recently raised funding or were acquired, opening a second location or region, hiring a first CTO or engineering manager, or publicly migrating off a legacy system.

We build custom enterprise software and internal platforms with React, Node.js, Python, PostgreSQL, Docker and AWS.

Target the CTO, IT Director, VP Engineering or Managing Director.`,
  },
];

/**
 * The scaffold for writing your own. The bracketed slots are the four things
 * the agent actually scores on, so an ICP missing one of them scores worse.
 */
export const CUSTOM_TEMPLATE = `Companies in [industry] with [20-200] employees in [geography] that [the problem you solve for them].

Strong signals: [what makes them ready to buy right now - funding, hiring, a new location, a launch, a visible gap].

We provide [your service, in one plain sentence].

Target the [job titles of the people who decide].`;
