# AI Sales OS — Frontend

React 19 + Vite + Tailwind v4. Talks to the FastAPI backend in `../Backend`.

## Setup

```bash
npm install
copy .env.example .env      # optional - the defaults already work
npm run dev
```

Open http://localhost:5173

**Start the backend first** (see `../Backend/README.md`) — every view depends on it.

## Environment

No API keys belong here. The Claude key lives in `Backend/.env`; anything
prefixed `VITE_` is bundled into the JavaScript and is **public**.

| Variable | Default | Does |
|---|---|---|
| `BACKEND_URL` | `http://127.0.0.1:8000` | Where the dev server proxies `/api/*`. Read by `vite.config.ts`, never sent to the browser. |
| `VITE_API_URL` | *(empty)* | Absolute backend URL for the browser to call. Leave empty locally — the proxy handles it and relative paths avoid CORS. Set it only when deploying without that proxy in front. |

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server with HMR and the `/api` proxy |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built `dist/` |
| `npm run lint` | TypeScript check (`tsc --noEmit`) |

## Layout

```
src/
├── App.tsx              All app state, auth gate + view switching
├── types.ts             Shared types (mirrors Backend/app/schemas.py)
├── lib/
│   ├── api.ts           Backend client — the only place fetch is called
│   ├── auth.ts          Session token storage (localStorage)
│   └── utils.ts         cn() class helper
└── components/
    ├── LoginView.tsx            Sign-in screen
    ├── Sidebar.tsx              Navigation + signed-in user / sign out
    ├── RunAgentsView.tsx        Control Center — ICP input, deploy agents
    ├── InternalCrmView.tsx      Deal Board — drag-and-drop kanban
    ├── CompaniesView.tsx        Enriched Accounts
    ├── OutreachView.tsx         Campaigns
    ├── AnalyticsView.tsx        Pipeline Analytics
    ├── CrmSettingsView.tsx      CRM Integration (simulated)
    └── SystemSettingsView.tsx   Stored-data count and clearing
```

## State and persistence

`App.tsx` holds the working copy in `useState`, but the source of truth is
PostgreSQL behind the backend:

- The saved board is fetched once on sign-in (`GET /api/companies`).
- Dragging a card updates the UI immediately, then persists it with
  `PATCH /api/companies/{id}` — and rolls the card back if the save fails.
- Running the pipeline appends to what is already stored and returns the whole
  board, so runs accumulate.
- A refresh no longer loses anything.

The session token is kept in `localStorage`. A 401 from any call clears it and
returns you to the login screen.
