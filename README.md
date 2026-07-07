<p align="center">
  <img src="public/icons/icon.png" width="60" height="60" alt="Growth Chart Logo">
</p>
<h1 align="center" style="border-bottom: none; margin-bottom: 0;">Growth Chart</h1>
<h3 align="center" style="margin-top: 0; font-weight: normal;">
  GitHub release download analytics with daily snapshots and growth tracking
</h3>

<br />

> "If you really want to hold yourself to a high standard, graph the growth rate of the number you care about instead of the number itself. Then you're winning if you can even keep it flat." — [Paul Graham](https://x.com/paulg/status/2034756891818004629)

<br />

## Quick Start

```bash
git clone https://github.com/stevederico/growth-chart.git
cd growth-chart
npm install
```

Set the repos you want to track in `backend/.env`:

```bash
GITHUB_REPOS=owner/repo,owner/another-repo
```

Start the dev server:

```bash
npm run start
```

Frontend: http://localhost:5173 | Backend: http://localhost:8000

<br />

## Features

### Daily Tracking
Automatic snapshots of download counts. The service snapshots on startup (woken by a Railway cron at 6 AM UTC) and runs an in-process hourly self-check that backfills any repo/metric missing today's row — so a long-running instance stays current across midnight. Each snapshot records cumulative downloads per release tag.

### GitHub Metrics
Beyond downloads, tracks **stars**, **forks**, **clones**, and **views** per repo (traffic metrics require `GITHUB_TOKEN`). Switch metric with the dashboard selector.

### Growth Metrics
- **Week-over-Week Growth** — 7-day percentage change with trend indicators
- **20% Growth Goal** — Shows downloads needed to hit a 20% WoW target
- **Downloads Today** — Real-time daily delta from the latest snapshot

### Interactive Charts
Toggle between **Total** (cumulative downloads over time) and **Daily** (new downloads per day) views. Area chart with gradient fill and custom tooltips.

### Per-Release Breakdown
Sortable table showing download counts per release tag. See which versions are getting the most traction.

### Multi-Repo Support
Track multiple GitHub repositories from a single dashboard. Switch between repos with the dropdown selector.

### Historical Backfill
Insert historical data for dates before you started tracking. The backfill endpoint distributes totals proportionally across releases.

<br />

## How It Works

1. Backend fetches cumulative download counts (Releases API) plus stars/forks/clones/views from GitHub
2. Snapshots run on startup and hourly; a Railway cron wakes the sleeping service daily to trigger one
3. Daily deltas are computed by diffing consecutive snapshots
4. Dashboard shows total/growth chart, stats cards, daily totals, and per-release breakdown

<br />

## API Endpoints

All GitHub-tracking endpoints are unauthenticated (the dashboard reads them without a session).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/downloads` | All download snapshots (supports `?from`, `?to`, `?repo` filters) |
| `GET` | `/api/downloads/daily` | Daily download deltas (supports `?repo` filter) |
| `GET` | `/api/downloads/latest` | Most recent snapshot with total (supports `?repo` filter) |
| `GET` | `/api/downloads/repos` | List of configured repo names |
| `POST` | `/api/downloads/snapshot` | Manually trigger a download snapshot (`{ repo? }`) |
| `POST` | `/api/downloads/backfill` | Insert historical data (`{ date, total, repo? }`) |
| `GET` | `/api/metrics` | Metric rows — requires `?metric=stars\|forks\|clones\|views` (supports `?from`, `?to`, `?repo`) |
| `GET` | `/api/metrics/daily` | Day-over-day metric deltas (requires `?metric`, supports `?repo`) |
| `GET` | `/api/metrics/latest` | Most recent metric snapshot (requires `?metric`, supports `?repo`) |
| `POST` | `/api/metrics/snapshot` | Manually trigger a metric snapshot (`{ metric?, repo? }`) |
| `GET` | `/api/repos` | List tracked repos with `id`, `repo`, `created_at` |
| `POST` | `/api/repos` | Add a repo (`{ repo }`); validated against GitHub before insert |
| `DELETE` | `/api/repos/:id` | Remove a repo (download history is preserved) |

> Auth, user, and payment routes (`/api/signup`, `/api/signin`, `/api/me`, `/api/usage`, `/api/checkout`, `/api/portal`, Stripe webhook) come from the skateboard backend and are documented in `docs/API.md`.

<br />

## Configuration

### Frontend — `src/constants.json`

```json
{
  "appName": "Growth Chart",
  "tagline": "GitHub Release Download Analytics",
  "noLogin": true,
  "sidebarCollapsed": true,
  "pages": [
    { "title": "Downloads", "url": "home", "icon": "download" }
  ]
}
```

### Backend — `backend/config.json`

```json
{
  "staticDir": "../dist",
  "database": {
    "db": "GrowthChart",
    "dbType": "sqlite",
    "connectionString": "./backend/databases/GrowthChart.db"
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_REPOS` | Yes | Comma-separated repos to track (`owner/repo,owner/other`). Seeds the `repos` table on first boot when empty |
| `GITHUB_REPO` | — | Single repo shorthand (fallback if `GITHUB_REPOS` not set) |
| `GITHUB_TOKEN` | — | GitHub PAT — required for traffic metrics (clones/views); raises rate limits for stars/forks/downloads |
| `PORT` | — | Server port (default: `8000`) |
| `JWT_SECRET` | — | Token signing key (if auth enabled) |
| `STRIPE_KEY` | — | Stripe secret key (if payments enabled) |
| `STRIPE_ENDPOINT_SECRET` | — | Stripe webhook secret (if payments enabled) |
| `NODE_ENV` | — | Set to `production` for deployment |

<br />

## Database

SQLite by default. The GitHub-tracking tables are owned by `backend/github.ts`, which opens its own handle on the configured database file and creates them on boot:

```sql
-- Cumulative download counts, one row per (repo, date, release tag)
CREATE TABLE downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  tag TEXT NOT NULL,
  download_count INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_downloads_repo_date_tag ON downloads(repo, date, tag);

-- Tracked repos (seeded from GITHUB_REPOS, editable via /api/repos)
CREATE TABLE repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- stars/forks/clones/views, one row per (repo, date, metric)
CREATE TABLE github_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  date TEXT NOT NULL,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_github_metrics_repo_date_metric ON github_metrics(repo, date, metric);
```

The skateboard auth/user/payment tables (`Users`, `Auths`, `WebhookEvents`) also support PostgreSQL and MongoDB via the adapter pattern in `backend/adapters/`; the GitHub-tracking tables are SQLite-only.

<br />

## Tech Stack

| Technology | Purpose |
|------------|---------|
| React 19 | UI Framework |
| Vite 7.1+ | Build Tool |
| Recharts | Charts |
| Tailwind CSS v4 | Styling |
| skateboard-ui | Application Shell |
| Hono | Backend Server |
| SQLite | Database |

<br />

## Project Structure

```
growth-chart/
├── src/
│   ├── components/
│   │   ├── HomeView.tsx          # Downloads/metrics dashboard
│   │   ├── SectionCards.tsx      # WoW growth, goal tracker, daily total
│   │   ├── ChartAreaInteractive.tsx  # Total/Daily toggle chart
│   │   ├── DataTable.tsx         # Daily table + per-release breakdown
│   │   └── CommandMenu.tsx       # Cmd+K command palette
│   ├── assets/
│   │   └── styles.css            # Theme overrides
│   ├── main.tsx                  # Route definitions
│   └── constants.json            # App configuration
├── backend/
│   ├── server.ts                 # Skateboard Hono server (auth, users, payments)
│   ├── github.ts                 # GitHub download/metrics tracking (routes + collector)
│   ├── adapters/                 # SQLite, PostgreSQL, MongoDB adapters
│   ├── databases/                # SQLite database files
│   └── config.json               # Backend configuration
├── Dockerfile                    # Multi-stage Node 24 Alpine build
└── vite.config.ts                # Vite configuration
```

<br />

## Development

```bash
npm run start          # Start frontend + backend concurrently
npm run front          # Frontend only (Vite dev server on :5173)
npm run server         # Backend only (Hono server on :8000)
npm run build          # Production build
npm run test           # Run tests
npm run test:watch     # Watch mode
```

<br />

## Deployment

Growth Chart includes a `Dockerfile` for deploying to any container host. The server snapshots downloads on startup, so schedule a daily cron job (e.g. `0 6 * * *`) to wake the service and capture fresh data.

<br />

## Community

- **Issues**: [GitHub Issues](https://github.com/stevederico/growth-chart/issues)
- **X**: [@stevederico](https://x.com/stevederico)

<br />

## License

MIT License — see [LICENSE](LICENSE) for details.

<br />

---

<div align="center">
  <p>
    Built by <a href="https://github.com/stevederico">Steve Derico</a>
  </p>
  <p>
    Made with <a href="https://github.com/stevederico/skateboard">Skateboard</a> — a React boilerplate with auth and payments
  </p>
</div>
