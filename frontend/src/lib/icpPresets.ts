/**
 * Ready-to-run ICP briefs, written from the two live service lines.
 *
 * Each one follows the same six-part shape, because the brief is read twice:
 * the discovery agent searches and scores against it, and the outreach agent
 * writes the first email from it.
 *
 *   WHO THEY ARE       - firmographics, sub-sectors, size band, geography,
 *                        how they sell. This is what the searches are built from.
 *   WHY NOW            - observable buying signals. This is what produces
 *                        sharp icpReasons and gives the email something to
 *                        open on.
 *   WHAT WE SELL       - the service in plain words, what the client receives,
 *                        the result they are buying. The email is written from
 *                        this, so vague here means vague there.
 *   WHO DECIDES        - the titles to name as decision makers.
 *   SCORE HIGH WHEN    - and score low when: the disqualifiers. Without these
 *                        the agent scores every plausible company 70.
 *   OPEN THE CONVERSATION ON - the angle for the first message.
 *
 * The briefs are deliberately long. A two-line ICP gets two-line research;
 * every extra specific here is one the agent can search for and one the
 * email can mention.
 *
 * One rule to keep when editing: signatures.py decides which business signs
 * an email by counting research terms against tech terms in the brief, so a
 * Market Research brief must stay heavy on words like market sizing, due
 * diligence and primary research, and a Tech Solutions brief on software,
 * website, automation and the stack. Mixing them flips the signature.
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
    text: `WHO THEY ARE
Mid-size and large B2B manufacturers and technology companies with 200-5,000 employees and roughly $20M-$2B in annual revenue, headquartered in North America, Europe, the Middle East or APAC, that are about to enter a new geography, a new product category or an adjacent customer segment and need defensible market sizing before they commit budget. Priority sectors: industrial manufacturing and machinery, automotive and transport, electronics and semiconductors, chemicals and advanced materials, healthcare and medical devices, packaging, and energy and utilities. They sell through direct sales teams, distributors or channel partners, and the decision to expand is being made by a strategy or corporate development function rather than a single founder.

WHY NOW - the buying signals that matter
- A recently announced expansion: a new plant, a new regional office, a new country entry, or a joint venture
- A new product line or a major launch in the last twelve months that opens a category they have not sold into before
- A recent funding round, an IPO, or a public revenue target that the current markets cannot deliver on their own
- Hiring for Head of Strategy, Corporate Development, Market Intelligence, Product Marketing or Business Analyst roles
- Executives quoted in trade press about entering a new market, sizing the opportunity, or building a business case
- An investor presentation or annual report that names a total addressable market without citing a source for it

WHAT WE SELL
Introspective Market Research provides syndicated and custom market research: market sizing and total addressable market estimates broken down by segment, region and application; five-to-ten-year forecasting with the drivers and the assumptions written down; customer and demand segmentation; competitive intelligence and share analysis; and full global market analysis reports. The deliverable is a defensible number, with the method behind it, that a strategy team can put in front of a board, a bank or an investor and defend line by line.

WHO DECIDES
Head of Strategy, VP or Director of Corporate Development, Chief Strategy Officer, Product Marketing Director, Market Intelligence Manager, or Head of Business Development. In smaller companies, the CEO or the General Manager appointed for the new region.

SCORE HIGH WHEN
They are in a priority sector, inside the size band above, and show at least two of the signals within the last twelve months. Score low when the company is a pure services firm with no product to size, is itself a research or consulting provider, is under 100 employees, or shows no sign of expansion in the last two years.

OPEN THE CONVERSATION ON
The specific market or geography they have announced, and what it costs to commit budget to it on a number nobody has checked.`,
  },
  {
    id: 'mna',
    group: 'Market Research',
    label: 'M&A due diligence',
    hint: 'PE, VC and corporate development teams',
    text: `WHO THEY ARE
Private equity firms, growth and venture funds, family offices, investment banks and the corporate development teams of acquisitive companies, based in North America, the United Kingdom, Western Europe, the Middle East or India, that are actively evaluating acquisitions in industrial, healthcare and life sciences, chemicals, consumer, or business-to-business technology sectors and need commercial due diligence delivered on a deal timeline of two to six weeks. Fund size from $100M to $10B for investors; for corporates, 500-20,000 employees with a stated acquisition strategy. They already use financial and legal advisers and are missing the commercial view: whether the target's market is as big and as durable as the deck says.

WHY NOW - the buying signals that matter
- A fund closed in the last eighteen months, so there is capital that has to be deployed
- A platform acquisition announced, which usually means bolt-on acquisitions follow in the same sector
- A public statement of intent to enter a sector they have not held before, where they have no in-house expertise
- Hiring associates, vice presidents or corporate development managers, or building a first in-house deal team
- A portfolio company preparing for exit, where a vendor due diligence report will be needed
- Press coverage of a bidding process, a strategic review or a carve-out in one of the priority sectors

WHAT WE SELL
Introspective Market Research provides commercial due diligence for buyers and sellers: market assessment and market sizing for the target's segments, customer and competitor interviews, competitive intelligence and share analysis, target screening and long-listing across a sector, demand forecasting, and impact analysis on the investment thesis. Delivered as a red-flag report first and a full report second, so the deal team can decide early whether to keep spending on the process.

WHO DECIDES
Partner, Principal, Investment Director or Vice President at a fund; Head of M&A, VP Corporate Development or Chief Strategy Officer at a corporate; Managing Director or Director in an investment bank's advisory team.

SCORE HIGH WHEN
They are an active acquirer in a priority sector, with a deal or a fund close in the last eighteen months, and no visible in-house research function. Score low when they are a passive investor, a pure real-estate or infrastructure fund, a firm that only does very early-stage deals, or a business that has never acquired and shows no intent to.

OPEN THE CONVERSATION ON
The sector or the deal they have signalled, and the question their financial advisers cannot answer: whether the target's market will still be there in year three.`,
  },
  {
    id: 'npd',
    group: 'Market Research',
    label: 'Product & concept testing',
    hint: 'Teams launching in the next 2-4 quarters',
    text: `WHO THEY ARE
Consumer goods, food and beverage, personal care and beauty, medical device, consumer electronics and consumer health companies with 100-2,000 employees and an in-house brand or product team, based in North America, Europe, the Middle East or India, that are launching a new product, a new variant or a repositioned range in the next two to four quarters and have not yet validated the concept, the price point or the packaging with real buyers. Includes challenger brands scaling from direct-to-consumer into retail distribution, and established manufacturers moving into an adjacent category for the first time.

WHY NOW - the buying signals that matter
- Hiring product managers, brand managers, innovation leads or consumer insights roles
- An announced R&D centre, a new production line, or a plant investment tied to a specific product
- A recent entry into an adjacent category, a new format, or a new price tier
- A relaunch or a rebrand of a product that previously underperformed at retail
- Retail listing wins or a new distribution deal that raises the cost of a launch that misses
- Press or investor commentary about launch timing, shelf performance, or a pipeline of new products

WHAT WE SELL
Introspective Market Research runs primary research for launches: quantitative surveys with representative consumer panels, in-depth interviews, focus groups, in-home and in-store ethnography, concept testing and concept screening, packaging and claims testing, pricing research such as Van Westendorp and conjoint, and product-market fit studies. The output is a clear go, fix or stop recommendation for each concept, with the reasons buyers gave in their own words, delivered in time to change the launch rather than explain it afterwards.

WHO DECIDES
Head of Innovation, VP or Director of Product, Consumer Insights Manager, Brand Director or Marketing Director; in device and health companies, the VP of Marketing or the Product Line General Manager.

SCORE HIGH WHEN
A launch is visibly scheduled within four quarters, the company sells a physical product to consumers or clinicians, and there is no in-house insights team of any size. Score low when the company is a pure services business, a retailer with no own-brand products, a business-to-business component supplier with no end consumer, or a company with a large established insights function.

OPEN THE CONVERSATION ON
The launch they have announced, and the difference between testing the concept now and finding out at the shelf.`,
  },

  // ---- IMR Tech Solutions ----
  {
    id: 'web',
    group: 'Tech Solutions',
    label: 'Website & web app rebuilds',
    hint: 'Businesses losing enquiries to a dated site',
    text: `WHO THEY ARE
Small and mid-sized businesses with 20-300 employees and $2M-$50M in revenue whose website is outdated, slow, not mobile-friendly, or built on a platform nobody in the company can update, and where that site is now costing them enquiries, bookings or online orders. Priority sectors: healthcare clinics and diagnostic centres, private schools, colleges and training providers, food and beverage brands, retail and e-commerce sellers, hotels and hospitality, logistics and courier operators, real estate developers, and professional services firms such as accountants, law firms and consultancies. Based in India, the United Kingdom, the Middle East, North America or Australia, with an owner or a marketing head who is measured on leads.

WHY NOW - the buying signals that matter
- Running paid search or social ads that land on a slow or generic page, so ad spend is being wasted
- A new location, branch, clinic or store opened in the last year that the current site does not reflect
- Hiring sales, business development or digital marketing staff, which means lead volume is the goal
- A new product line, service or menu announced that the site still does not show
- A site that fails basic mobile or speed checks, has no online booking or enquiry flow, or still shows a copyright year two or more years old
- Reviews or social posts from customers complaining they could not find, book or buy something online

WHAT WE SELL
IMR Tech Solutions designs and builds modern websites and web apps: a fast, mobile-first company website with search engine optimisation built in; customer portals, booking and enquiry flows, online catalogues and e-commerce storefronts; and iOS and Android apps where the business needs one. Built with React, Next.js, Node.js and Python, hosted on AWS, and handed over with content the client's own team can update without calling a developer. The point is more enquiries from the same traffic, and a site that matches the business as it is today.

WHO DECIDES
Founder, Owner or Managing Director; Head of Marketing or Digital Marketing Manager; Operations Head in clinics and schools; IT Manager where one exists.

SCORE HIGH WHEN
The site is visibly dated or slow, the business is spending on marketing, and there has been a change in the last year the site does not reflect. Score low when the company is a large enterprise with an in-house web team, a digital agency or a software company, a business with no customer-facing website need, or one that launched a new site in the last twelve months.

OPEN THE CONVERSATION ON
The specific thing their site is losing them today: the enquiry that goes to a competitor, the booking that does not happen on a phone.`,
  },
  {
    id: 'automation',
    group: 'Tech Solutions',
    label: 'AI & workflow automation',
    hint: 'Ops teams still running on spreadsheets',
    text: `WHO THEY ARE
Operations-heavy companies with 50-1,000 employees still running core workflows on spreadsheets, shared inboxes, WhatsApp threads and manual data entry, where a small team re-keys the same information into two or three systems every day. Priority sectors: logistics, freight forwarding and fulfilment; healthcare administration, diagnostics and hospital back-office; financial services operations such as lending, insurance and accounting firms; e-commerce and marketplace operations; recruitment and staffing agencies; and research and survey operations. Based in India, the Middle East, the United Kingdom, North America or Southeast Asia, with a leadership team that has already felt the cost of a manual error or a missed deadline.

WHY NOW - the buying signals that matter
- Hiring data entry operators, back-office executives, operations coordinators or process associates in numbers
- Headcount growing faster than revenue, or a stated goal to grow volume without growing the team
- Public mention of turnaround time, accuracy, reconciliation or compliance problems, or a regulatory deadline
- A new system added recently, such as a CRM, an ERP or an accounting package, that now needs connecting to everything else
- Documents that arrive as PDFs, scans or emails and have to be read and typed in by hand: invoices, claims, applications, shipping documents, lab reports
- A recent funding round, a new large customer, or a second site that multiplies the manual work

WHAT WE SELL
IMR Tech Solutions builds intelligent automation: document processing that reads invoices, forms and reports and puts the data where it belongs; workflow automation that moves work between systems without a person copying it; internal tools and dashboards that replace the spreadsheet everyone depends on; and AI-assisted operations that draft, classify, summarise and route work, using Python, FastAPI and modern LLM tooling. Delivered as a first automated workflow inside weeks, measured on hours saved and errors removed, then extended process by process.

WHO DECIDES
COO or Head of Operations; Finance Controller or CFO in back-office cases; IT Director or Head of Technology; or the Founder in companies under 200 people.

SCORE HIGH WHEN
The company is in a priority sector, is visibly hiring for manual roles or citing turnaround problems, and handles documents or transactions in volume. Score low when the company already has a large engineering team, is itself a software or automation vendor, has under 30 employees, or runs on a single mature platform with nothing to connect.

OPEN THE CONVERSATION ON
The one process they are hiring people to do by hand, and what it would mean to have it done overnight without the re-keying.`,
  },
  {
    id: 'enterprise',
    group: 'Tech Solutions',
    label: 'Custom enterprise software',
    hint: 'Outgrown off-the-shelf tools',
    text: `WHO THEY ARE
Companies with 100-2,000 employees that have outgrown off-the-shelf software and are now running the business on a patchwork of spreadsheets, disconnected SaaS tools and an ageing system nobody wants to touch. Priority sectors: manufacturing and engineering, financial services and non-bank lenders, healthcare groups and hospital chains, education groups with several campuses, e-commerce and distribution businesses, and multi-site service companies. Based in India, the Middle East, the United Kingdom, North America or Australia, with a leadership team that already knows the tools are the bottleneck and is deciding between buying a bigger platform and building the right one.

WHY NOW - the buying signals that matter
- A recent funding round, an acquisition or a merger that puts two sets of systems inside one company
- A second location, a new region or a new business line that the current tools cannot support
- Hiring a first CTO, Head of Engineering, Engineering Manager or Product Owner, or building a first internal tech team
- A public migration off a legacy system, an ERP that is being replaced, or a licence renewal that has become expensive
- Job postings or press mentions describing manual reconciliation between systems, duplicate data, or reporting that takes days
- Compliance, audit or customer requirements that the current software cannot meet

WHAT WE SELL
IMR Tech Solutions builds custom enterprise software and internal platforms: an operations platform designed around how the company actually works, integrations that connect the systems they keep, role-based dashboards and reporting, and the migration off the spreadsheets and the legacy tool. Built with React, Node.js, Python and PostgreSQL, containerised with Docker and deployed on AWS, with the client's own team trained to own it. Delivered in phases, starting with the module that hurts most, so value shows up before the whole platform is finished.

WHO DECIDES
CTO or IT Director, VP Engineering or Head of Technology, Chief Operating Officer, or the Managing Director where there is no technology leader yet.

SCORE HIGH WHEN
The company is inside the size band above, in a priority sector, and shows at least two signals: a growth event, a technology hire, and a visible systems problem. Score low when the company is a software product company or an IT services firm, is under 50 employees, already runs a modern integrated platform, or has a large in-house engineering team with no external partners.

OPEN THE CONVERSATION ON
The moment they realised the tools were the problem, whether the merger, the second site or the report that took a week, and what one platform built around their process would change.`,
  },
];

/**
 * The scaffold for writing your own, in the same six parts as the presets.
 * The bracketed slots are what the agents actually search and score on, so a
 * brief that leaves one blank gets a vaguer list and a vaguer email.
 */
export const CUSTOM_TEMPLATE = `WHO THEY ARE
Companies in [industry] with [20-200] employees in [geography] that [the problem you solve for them, in one sentence]. Include [the sub-sectors or business types that fit best], [the size or revenue band], and how they sell today.

WHY NOW - the buying signals that matter
- [Something observable that says they are ready: a funding round, a hire, a new location, a launch]
- [A visible gap: a dated website, a manual process, a market they have named but not sized]
- [A deadline or an event that raises the cost of waiting]

WHAT WE SELL
[Your service, in two or three plain sentences: what it is, what the client receives, and the result they are buying.]

WHO DECIDES
[The job titles of the people who decide], and [who influences them].

SCORE HIGH WHEN
[The combination of size, sector and signals that makes a perfect fit]. Score low when [the kinds of company to leave out: too small, wrong sector, already served, a competitor].

OPEN THE CONVERSATION ON
[The one thing in their situation the first email should be about.]`;
