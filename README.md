# AI Sales OS

A multi-agent B2B sales prospecting app. You describe an Ideal Customer Profile,
and a chain of Claude agents discovers matching companies, researches them, finds
decision makers, and drafts personalized outreach — then you work those accounts
on a kanban pipeline board.

```
SalesOs/
├── Backend/     FastAPI + Claude + PostgreSQL   -> http://127.0.0.1:8000
└── frontend/    React + Vite                    -> http://localhost:5173
                                                    PostgreSQL on :5432
```

The frontend never talks to Claude or Postgres directly. It calls the FastAPI
backend, and the Vite dev server proxies `/api/*` there so the browser only sees
one origin.

## Run it

Two terminals.

### 1. Backend

```bash
cd Backend
python -m venv venv
source venv/Scripts/activate    # Windows (Git Bash)
# venv\Scripts\activate         # Windows (CMD / PowerShell)
# source venv/bin/activate      # macOS / Linux
pip install -r requirements.txt

cp .env.example .env            # then fill in DATABASE_URL and ANTHROPIC_API_KEY
uvicorn app.main:app --reload --port 8000
```

Database setup and account management: `Backend/README.md`.
Get a Claude API key at https://console.anthropic.com/settings/keys

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and sign in.

## The three ideas this is built around

**1. Cost is measured, not estimated.** Every Claude call records its real token
usage and is priced from the published rates. The Cost screen shows spend per
agent, per account, and per qualified account — the last being the only one worth
optimising.

**2. Route models by task, not by habit.** Discovery, research and personalization
decide reply rates, so they run on the large model. Enrichment is short and
structured, so it runs on the small one. In practice that is a ~30x price
difference per call, and it is one line of config.

**3. Refresh on dependency, not on schedule.** A record is only worth
re-verifying when its freshness has decayed *and* something depends on it — an
active campaign or a high ICP score. Refreshing everything on a calendar is the
expensive way to be wrong.

## What's real and what isn't

| Feature | Status |
|---|---|
| Login | **Real** — bcrypt-hashed passwords in Postgres, JWT sessions |
| Sending email | **Real** — SMTP, with a hard daily ceiling per mailbox |
| Receiving replies | **Real** — IMAP sync, threaded onto what you sent. Manual: nothing polls on its own |
| Sent history | **Real** — the Outbox lists every send with its reply status and where it came from |
| Reply triage | **Real** Claude call on the small model; opt-outs are suppressed automatically |
| Saved pipeline | **Real** — accounts, contacts, campaigns, stages persist |
| Cost tracking | **Real** — measured from actual token usage on every call |
| Discovery, research, outreach drafting | **Real** Claude calls |
| ICP scoring with reason codes | **Real** — the model must justify every score |
| Suppression list | **Real** — checked before outreach is generated |
| Contact email and phone | **Real** — found or typed, never generated. The discovery agent is given neither field |
| Finding an email | **Real** — Hunter lookup where a key is set, plus domain-pattern candidates, each checked against the recipient's own mail server |
| Contact LinkedIn | **Guessed** — the agent writes a plausible profile URL. It shows as `Unchecked` until a person saves the real one |
| LinkedIn messaging | **Copy and open** — there is no send API, and automating the site gets accounts restricted. The drafted message copies to your clipboard and the profile opens |
| Calling | **Click-to-dial** — a `tel:` link into whatever softphone you already use, with the agent's opener and objection handling beside it |
| Bulk outreach | **Real** — upload a spreadsheet, send up to 100 paced 15s apart, from either brand |
| Send rotation | **Real** — the list cycles: least-recently-contacted first, no duplicates inside a run |
| Export | **Real** — the list, the client book or the replies, as .xlsx, .docx, .pdf or .csv |
| Freshness / retouch policy | **Real** — computed from `last_verified` |
| Enrichment (statement-tagged) | **Real** Claude call, but it *invents* the intel — that is exactly why it is tagged INFERENCE or GENERATION and marked unquotable |
| CRM sync to Salesforce / HubSpot | **Simulated** — a delay and a log line |
| Automated sequences (send on a schedule) | **Not built** — every send needs a person |

## The agents

| Agent | Tier | Does |
|---|---|---|
| Discovery & research | Large | Companies matching the ICP, with firmographics, a dossier — what they sell, their latest launch, why-now signals and likely pain points — an ICP score **and its reason codes**, and decision makers |
| Outreach & personalization | Large | Email, LinkedIn message, call opener, objection handling, plus a self-assessed personalization score |
| Enrichment | Small | Extra intel for one account, tagged `data` / `inference` / `generation` |
| Reply triage | Small | Classifies every inbound reply and auto-suppresses opt-outs |

The discovery dossier is model-written like everything else here, so the client
panel labels the whole block rather than implying any one field was sourced.

Every agent statement carries one of three types and they are never mixed. Only
`data` may be quoted back to a prospect — and since this build has no live data
sources, enrichment output is tagged `inference` or `generation`, which is the
honest answer rather than a confident-looking one.

## The screens

| Group | Screen | Does |
|---|---|---|
| Intelligence | Dashboard | Headline numbers, record growth, database health, action centre |
| | Priority Queue | Who deserves attention now, ranked, with the reasoning on every row |
| | Discover | Define the ICP, pick the area to search, deploy the agents |
| | Accounts | Table + detail panel: find and store email, phone and LinkedIn per contact, work all three channels, the research dossier, ICP reason codes, freshness |
| | Retouch | The decayed-record queue, priced before you approve anything |
| | Deal Board | Drag accounts across six stages; each move is saved |
| Outreach | **Inbox** | **Send outreach, sync replies, and answer them** |
| | **Outbox** | **Every message sent, from anywhere in the app, and who answered** |
| | **Bulk Outreach** | **Upload a list, send it paced, watch the replies land** |
| | Campaigns | Generated copy with its personalization score |
| | Templates | Reusable starting points with variable checking |
| | Analytics | Pipeline shape |
| System | **Mailboxes** | **Connect a real mailbox over IMAP/SMTP** |
| | AI Agents | Every agent, its trigger, tier, spend and who approves it |
| | Cost | Spend per agent, model routing, refresh policy |
| | Compliance | Do-not-contact list |
| | Integrations | Salesforce / HubSpot config (simulated) |

Interactive API docs while the backend runs: http://127.0.0.1:8000/docs

## Searching an area

Discover takes a geography alongside the ICP: a **city** (Pune, Mumbai), a
**state or region** (Maharashtra, Karnataka), a **country** (India, United
Kingdom), or **worldwide**. The field is free text; the chips just save typing.

It is a hard filter, not a preference. Asked for ten companies in Pune, a model
will cheerfully fill the quota with Mumbai and Bengaluru — which is the one
outcome that makes a location filter worse than none, because the list looks
right until you read the addresses. So the prompt says to **return fewer rather
than pad**, and every result is checked afterwards: any account whose
`headquarters` does not name the area you asked for is counted and reported at
the end of the run.

That check is a substring match, so it depends on the model naming the area —
which the prompt requires it to do. A Pune company written up as "Pimpri, India"
would be flagged even though it is in Maharashtra. Over-reporting drift is the
right way round for that to fail.

None of this touches the structured-output schema, so it costs nothing against
the grammar complexity budget described above `CompanyDraft` — the geography
lives entirely in the prompt.

## Getting email addresses

The discovery agent has no email field. This is not an oversight — a model with
no contact database can only produce something *shaped* like an address, and
the next thing this app does with an address is send real mail to it. A guess
either bounces, which is the strongest spam signal there is and costs you
deliverability on every legitimate send after it, or it reaches a real stranger
at a real company.

So addresses come from **Find email** on the client panel instead, which does
two things and shows you which is which:

**Hunter** (optional, `HUNTER_API_KEY` in `.env`) looks the person up in a
maintained database and returns its own confidence score and verification
status. Free tier is 25 lookups a month. This is the higher hit rate by a wide
margin.

**Domain patterns** always run: `priya.raval@`, `praval@`, `priya@` and the
other common corporate schemes, built from the company's website — which is why
the discovery dossier collects the domain.

Then every candidate is checked against the recipient's **own mail server**,
over MX plus an SMTP `RCPT TO` probe that sends nothing. You get one of:

| Badge | Means |
|---|---|
| `Confirmed` | the server said that mailbox exists |
| `Does not exist` | the server refused it — don't send |
| `Catch-all` | the domain accepts every address, so the check proves nothing |
| `Unconfirmed` | the domain takes mail but this mailbox could not be checked |
| `No mail server` | the domain publishes no MX at all |

**Expect `Unconfirmed` on a laptop.** Outbound port 25 is blocked on almost
every home and office connection, so the probe cannot run and the app says so
rather than inventing a verdict. Deploy the backend somewhere with port 25 open
and the same lookup starts returning `Confirmed` and `Does not exist`.

Nothing found is ever saved on its own. You pick a candidate, and it is stored
through exactly the same endpoint a hand-typed address goes through.

## Bulk outreach

**Bulk Outreach** is for lists you bring rather than accounts the agents found.
Drop in a `.xlsx`, `.csv` or `.txt`, pick which of the two businesses it goes
out as, and send.

Columns are matched by what the header says, not by position, so `Work E-mail`,
`Company Name`, `Designation` and `Country` all land in the right field, and a
file that is nothing but a column of addresses still works.

**Rows that share an email address are kept, not dropped.** Real lists carry the
same inbox across several people — a team `info@`, or a column somebody filled in
with a placeholder — and deleting those rows loses real contacts with no
explanation. So every row is imported and shown; only the first contact to hold
an address goes in the rotation, and the others are labelled with whose address
it is. Five rows sharing two addresses means five rows on screen and two people
mailed, which is both the honest count and the safe one.

Re-uploading the same file changes nothing: a row is a duplicate only when its
address, name *and* company all already exist.

The list lives in Postgres, so it survives signing out, closing the browser and
restarting the server, and uploads **add** to it rather than replacing it. It is
also the one thing in this app a person assembled by hand, so nothing deletes
rows on a single click: **Clear** asks first and names the count, and each
uploaded file is listed separately with its own remove button — so one bad
import can go without taking the rest of the list with it.

Two sender profiles ship with copy written from what each site actually sells,
**three angles each** so a second round does not repeat the first:

| Profile | Angles |
|---|---|
| IMR Tech Solutions | *Outgrown the tool* · *Where AI pays off* · *Site stopped selling* |
| Introspective Market Research | *Size before you spend* · *What buyers won't say* · *Competitor moves* |

Every one opens on the reader rather than on the sender, runs 85–110 words
(reply rates fall away sharply past about 130), and is editable before you send.
Picking a different angle for round two is the point: the rotation comes back to
the same people, and the identical email twice is what gets reported as spam.

Both are editable before you send, both fill `{{first_name}}`, `{{company_name}}`,
`{{job_title}}`, `{{industry}}` and `{{location}}` from the uploaded row, and both end with a
plain-language opt-out — which is what makes the existing reply triage useful,
since an "unsubscribe" reply is added to the suppression list automatically.

### The order

The list is a **circle, not a queue that empties**. Whoever has been emailed
least often, and longest ago, goes next. With 15 clients and batches of 10:

| Run | Goes to |
|---|---|
| 1 | 1 – 10 |
| 2 | 11 – 15, then wraps to 1 – 5 |
| 3 | 6 – 15 |
| 4 | 1 – 10 |

Two properties fall out of that ordering, and both matter:

- **Nobody appears twice in one run.** The batch is fixed when you press send,
  one row per recipient, so a duplicate is not possible by construction rather
  than prevented by a check afterwards.
- **Nobody gets a second email until everyone has had a first.** Round 2 cannot
  start for anyone while somebody is still on round 0.

Only a real send moves someone along — a skip or a bounce does not cost them
their place, so a batch cut short by the daily limit resumes exactly where it
stopped instead of starting again at the top.

The panel above the send button shows the next batch **in the order it will
actually go out**, with the round each person is on, before anything is sent.

### The pace

Batches are 1, 10, 50 or 100, sent **15 seconds apart** by default. A hundred
messages is therefore about twenty-five minutes, which is far longer than an
HTTP request should live — so the request queues a job and returns, the sending
runs in the background, and the screen polls it. You can stop a run mid-flight;
anything already sent stays sent.

The gap is deliverability, not politeness. A burst of near-identical mail from
one address is the fastest route into a spam folder. The mailbox's daily ceiling
and the suppression list are both re-checked **before every single message**, so
someone who opts out halfway through a run is dropped from the rest of that same
run, and a batch stops at the daily limit instead of pushing past it.

This is not the "automated sequences" left out below: a person still starts every
run and chooses every recipient. What is automated is the spacing.

### Export

The four buttons at the top download whatever you are looking at — the outreach
list, or the replies — as Excel, Word, PDF or CSV. **Clients** exports the
discovered pipeline instead: every account and contact with their email, phone
and LinkedIn.

## Connecting a mailbox

The Inbox is real email, over plain IMAP/SMTP — no OAuth app to register, works
with Gmail, Microsoft or any custom domain.

**Gmail:** you need an *App Password*, not your account password. Turn on
2-Step Verification, then Google Account → Security → App passwords. The
Mailboxes screen pre-fills the hosts:

```
SMTP  smtp.gmail.com : 587
IMAP  imap.gmail.com : 993
```

Both directions are verified before anything is stored — a mailbox that can
send but not read is worse than one that does neither, because replies would
vanish silently. The password is encrypted at rest with a key derived from
`SESSION_SECRET`, and only decrypted in memory when a connection opens.

### What happens when a reply arrives

Press **Sync replies** and each new message is pulled, quoted history stripped,
threaded onto what you sent, and classified by the small model into positive,
referral, neutral, not interested, unsubscribe or auto-reply. An **unsubscribe
is added to the suppression list automatically** — that is the one action taken
without asking, and afterwards any send or reply to that address is refused.

### Guard rails on sending

- Suppression is checked **at send time**, not when the audience is built
- Each mailbox has a hard daily ceiling; hitting it returns a 429 rather than
  spilling over — creating headroom to escape a limit is how domains get burned
- Nothing sends on its own. Every message needs a person to press send

## Deliberately not built

These come from the reference architecture but were left out to keep this
reliable rather than large: job queues and Redis, automated sequences that send
on a schedule, multi-provider data adapters, record deduplication and merge
history, a shared team inbox with assignment and internal notes, and
multi-tenancy. Nothing here blocks adding them later — the provider-agnostic
seams are in `agents.py`, `email_service.py` and `repository.py`.
