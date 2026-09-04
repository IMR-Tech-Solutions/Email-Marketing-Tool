# AI Sales OS — Backend

FastAPI service running the Claude sales agents, with PostgreSQL persistence, a
login gate and real cost tracking. Consumed by the React app in `../frontend`.

## Setup

```bash
python -m venv venv
source venv/Scripts/activate    # Windows (Git Bash)
# venv\Scripts\activate         # Windows (CMD / PowerShell)
# source venv/bin/activate      # macOS / Linux

pip install -r requirements.txt
cp .env.example .env            # then fill in DATABASE_URL and ANTHROPIC_API_KEY
```

### Database

Create the role and database once:

```bash
psql -U postgres -c "CREATE ROLE salesos LOGIN PASSWORD 'your-password';"
psql -U postgres -c "CREATE DATABASE salesos OWNER salesos;"
```

Put the matching URL in `.env`:

```
DATABASE_URL="postgresql://salesos:your-password@127.0.0.1:5432/salesos"
```

**Tables are created automatically on startup** — there is no migration step.
`create_all` makes missing tables, and a short `ADD COLUMN IF NOT EXISTS` list
in `db.py` makes columns added after the first release, since `create_all`
leaves an existing table alone. Both are replayable, so restarting is free.
That list is the honest stopgap it looks like: the day a column needs a
backfill or a type change, add Alembic.

## Run

```bash
python run.py
```

or `uvicorn app.main:app --reload --reload-include .env --port 8000`.

**Use one of those two forms.** A plain `--reload` watches `.py` files only, so
editing `.env` — adding your API key, say — will not be picked up and the app
keeps reporting "No API key" until you restart it by hand. Docs at http://127.0.0.1:8000/docs

## Accounts

The first account is seeded from `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` in
`.env`, **but only while the users table is empty**. After that the database is
the source of truth and editing `.env` does nothing.

```bash
python scripts/manage_user.py list
python scripts/manage_user.py set <username> <password>   # create or reset
python scripts/manage_user.py disable <username>
python scripts/manage_user.py enable <username>
python scripts/manage_user.py delete <username>
```

Passwords are stored bcrypt-hashed. Logging in returns a JWT signed with
`SESSION_SECRET`; the frontend sends it as `Authorization: Bearer <token>`.
Every request re-checks the account against the database, so disabling or
deleting someone takes effect immediately rather than when their token expires.

## Layout

```
app/
├── main.py              FastAPI app, CORS, error handling, startup, /api/health
├── config.py            Settings, read from .env
├── db.py                Async engine, session dependency, table creation
├── models.py            SQLAlchemy models (snake_case columns)
├── schemas.py           Pydantic models — the wire contract AND the Claude
│                        response schemas (camelCase, to match the frontend)
├── repository.py        All database reads/writes + ORM → API translation
├── agents.py            The four agents, their prompts and model tiering
├── broadcast.py         Bulk outreach: read a list in, pace the send out,
│                        export it as xlsx / docx / pdf / csv
├── contact_finder.py    Email lookup: Hunter + domain patterns, verified
│                        against the recipient's mail server
├── email_service.py     SMTP send + IMAP sync, reply parsing and threading
├── crypto.py            Encrypts mailbox credentials at rest
├── pricing.py           Model rates and per-call cost maths
├── freshness.py         Freshness bands and the refresh policy
├── auth.py              Login, JWTs, the get_current_user dependency
├── security.py          bcrypt hashing
├── dependencies.py      Shared singletons
└── routers/
    ├── auth.py          /api/auth/login, /api/auth/me
    ├── companies.py     Read, restage, enrich and clear saved accounts
    ├── insights.py      /api/dashboard, /api/cost, /api/suppression
    ├── mailboxes.py     Connect, verify and manage mailboxes
    ├── inbox.py         Send, sync, triage and reply
    ├── workspace.py     Templates, priority queue, retouch, agent roster
    └── pipeline.py      /api/run-pipeline
scripts/
└── manage_user.py       Account management CLI
```

## Tables

| Table | Holds |
|---|---|
| `users` | Dashboard accounts. Bcrypt hashes only, never plaintext. |
| `companies` | Discovered accounts, their kanban `stage`, enrichment text, and the ICP that produced them. |
| `decision_makers` | Contacts per company. Cascades on company delete. |
| `outreach_campaigns` | Generated email / LinkedIn / call / objection copy, with its personalization score. Cascades on company delete. |
| `model_calls` | Every Claude call: agent, model, tokens, cost to 6 decimal places. Never cleared by "clear data". |
| `suppressions` | Do-not-contact addresses and domains. Never cleared by "clear data". |
| `mailboxes` | Connected mailboxes. Passwords are Fernet ciphertext, never plaintext. |
| `email_messages` | Every sent and received message, threaded and triaged. |
| `templates` | Reusable copy with variable checking. |

Ids are server-issued UUIDs. The ids the model invents are discarded, so a
campaign can never point at the wrong company.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | — | Models, and whether Claude and the database are wired up |
| `POST` | `/api/auth/login` | — | Exchange credentials for a token |
| `GET` | `/api/auth/me` | ✓ | Check a stored token is still valid |
| `GET` | `/api/companies` | ✓ | The whole saved board |
| `POST` | `/api/run-pipeline` | ✓ | Run agents 1–4, save, return the whole board |
| `PATCH` | `/api/companies/{id}` | ✓ | Move an account to another stage |
| `POST` | `/api/companies/{id}/enrich` | ✓ | Run agent 5 and store the result |
| `DELETE` | `/api/companies` | ✓ | Delete every saved account (users, cost and suppression kept) |
| `GET` | `/api/dashboard` | ✓ | Headline numbers and database health |
| `GET` | `/api/cost` | ✓ | Spend per agent, model routing, refresh policy |
| `GET` `POST` | `/api/suppression` | ✓ | Read / add do-not-contact entries |
| `DELETE` | `/api/suppression/{id}` | ✓ | Remove one entry |
| `GET` `POST` | `/api/mailboxes` | ✓ | List / connect a mailbox (verifies SMTP + IMAP) |
| `POST` | `/api/mailboxes/{id}/test` | ✓ | Re-verify a connection |
| `PATCH` `DELETE` | `/api/mailboxes/{id}` | ✓ | Change the limit / remove it |
| `GET` | `/api/inbox` | ✓ | Every conversation, grouped into threads |
| `POST` | `/api/inbox/send` | ✓ | Send one email (suppression checked here) |
| `POST` | `/api/inbox/sync` | ✓ | Pull replies, triage them, auto-suppress opt-outs |
| `POST` | `/api/inbox/threads/{key}/reply` | ✓ | Reply in a thread |
| `GET` `POST` | `/api/templates` | ✓ | List / create templates |
| `GET` | `/api/priority-queue` | ✓ | Ranked attention list with reasoning |
| `GET` | `/api/retouch` | ✓ | Decayed-record queue with a cost estimate |
| `GET` | `/api/agents` | ✓ | Agent roster, triggers and spend |

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | *(none)* | Required. `postgresql://user:pass@host:port/db` |
| `ANTHROPIC_API_KEY` | *(none)* | Required. Agent endpoints return 502 without it. |
| `CLAUDE_MODEL_LARGE` | `claude-opus-5` | Discovery, research, personalization. |
| `CLAUDE_MODEL_SMALL` | `claude-haiku-4-5` | Enrichment and classification. |
| `HIGH_ICP_THRESHOLD` | `75` | At or above this an account counts as qualified. |
| `REFRESH_DAYS_HIGH_ICP_ACTIVE` | `30` | Refresh interval, high ICP in a campaign. |
| `REFRESH_DAYS_HIGH_ICP_DORMANT` | `90` | Refresh interval, high ICP dormant. |
| `REFRESH_DAYS_MID_ICP` | `180` | Refresh interval, mid ICP. |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | `admin` / *(none)* | Seeds the first account only. |
| `SESSION_SECRET` | *(generated)* | Signs tokens. Blank means a new one per restart, which signs everyone out. |
| `SESSION_HOURS` | `12` | How long a login lasts. |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated. |
| `MAX_CONCURRENT_OUTREACH` | `4` | Outreach drafts generated in parallel. |
| `ENRICHMENT_DELAY_SECONDS` | `1.5` | Fake latency so the UI spinner is visible. |
| `CRM_SYNC_DELAY_SECONDS` | `0.8` | Fake latency for the simulated CRM push. |

## Error format

Every failure returns `{"error": "..."}` — including validation errors — because
that is the shape the frontend reads. Agent failures are `502`, bad input `422`,
signed-out `401`, missing rows `404`.


## Cost tracking

`model_calls` records agent, model, input/output tokens and USD cost for every
Claude call, at 6 decimal places — a Haiku call costs a fraction of a cent, and
rounding those to zero is how a cost dashboard starts lying.

Rates live in `pricing.py`. A model id that is not in that table is charged at
Opus-tier rates rather than zero, and the server logs a warning at startup, so an
unknown model shows up as expensive rather than free. Update the table if
Anthropic's published prices change.

A run that fails partway still records what it spent before it died.

## Statement types

Section C of the reference architecture: every agent statement is `data`
(observed and sourced), `inference` (derived) or `generation` (written by the
model), and they are never mixed. **Only `data` may be quoted to a prospect.**

This build has no live data provider, so the enrichment agent is instructed that
it has no `data` available — its output comes back tagged `inference` or
`generation` and the UI shows that tag on every enriched card. The tag is the
feature: it is what stops invented intel being pasted into an email as fact.


## Email

Plain IMAP/SMTP via `aiosmtplib` and `imap-tools` - no provider API, so any host
works with an app password. `email_service.py` owns the protocol work:

- **Sending** builds a proper MIME message with a real `Message-ID`, and sets
  `In-Reply-To` / `References` on replies so they thread in the recipient's
  client.
- **Receiving** runs the blocking IMAP client in a worker thread, tracks the
  last seen UID per mailbox so a sync only pulls what is new, and strips quoted
  history before the text reaches the classifier - quoted threads make triage
  worse and cost more.
- **Threading** prefers the Message-ID chain and falls back to a normalised
  subject plus the other party, because clients rewrite ids.

Credentials never sit in the database as plaintext. `crypto.py` encrypts them
with a Fernet key derived from `SESSION_SECRET`; changing that secret makes
stored passwords undecryptable and the mailbox simply has to be reconnected.

### Reply triage

Every inbound message goes to the small model and comes back as one of
`positive`, `referral`, `neutral`, `not_interested`, `unsubscribe` or
`auto_reply`, with a confidence and a one-line reason. An `unsubscribe` is
written to the suppression list immediately - the only automatic action in the
system. Every triage call is priced into `model_calls` like any other.
