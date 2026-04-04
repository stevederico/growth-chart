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
Automatic nightly snapshots of download counts via a scheduled cron job (6 AM UTC). Each snapshot records cumulative downloads per release tag.

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

1. Backend fetches cumulative download counts from the GitHub Releases API
2. A daily cron job wakes the service, triggering a fresh snapshot
3. Daily deltas are computed by diffing consecutive snapshots
4. Dashboard shows total/growth rate chart, stats cards, daily downloads, and per-release breakdown

<br />

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/downloads` | All download snapshots (supports `?from`, `?to`, `?repo` filters) |
| `GET` | `/api/downloads/daily` | Daily download deltas (supports `?repo` filter) |
| `GET` | `/api/downloads/latest` | Most recent snapshot with total (supports `?repo` filter) |
| `GET` | `/api/downloads/repos` | List of configured repos |
| `POST` | `/api/downloads/snapshot` | Manually trigger a download snapshot |
| `POST` | `/api/downloads/backfill` | Insert historical data (`{ date, total, repo? }`) |

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
| `GITHUB_REPOS` | Yes | Comma-separated repos to track (`owner/repo,owner/other`) |
| `GITHUB_REPO` | — | Single repo shorthand (fallback if `GITHUB_REPOS` not set) |
| `PORT` | — | Server port (default: `8000`) |
| `JWT_SECRET` | — | Token signing key (if auth enabled) |
| `STRIPE_KEY` | — | Stripe secret key (if payments enabled) |
| `STRIPE_ENDPOINT_SECRET` | — | Stripe webhook secret (if payments enabled) |
| `NODE_ENV` | — | Set to `production` for deployment |

<br />

## Database

SQLite by default. The `downloads` table stores daily snapshots:

```sql
CREATE TABLE downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  tag TEXT NOT NULL,
  download_count INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_downloads_repo_date_tag ON downloads(repo, date, tag);
```

Also supports PostgreSQL (`DATABASE_URL`) and MongoDB (`MONGODB_URL`) via the adapter pattern in `backend/adapters/`.

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
│   │   ├── HomeView.jsx          # Downloads dashboard
│   │   ├── SectionCards.jsx      # WoW growth, goal tracker, daily downloads
│   │   ├── ChartAreaInteractive.jsx  # Total/Daily toggle chart
│   │   ├── DataTable.jsx         # Daily table + per-release breakdown
│   │   └── CommandMenu.jsx       # Cmd+K command palette
│   ├── assets/
│   │   └── styles.css            # Theme overrides
│   ├── main.jsx                  # Route definitions
│   └── constants.json            # App configuration
├── backend/
│   ├── server.js                 # Hono server + GitHub API integration
│   ├── adapters/                 # SQLite, PostgreSQL, MongoDB adapters
│   ├── databases/                # SQLite database files
│   └── config.json               # Backend configuration
├── Dockerfile                    # Multi-stage Node 22 Alpine build
└── vite.config.js                # Vite configuration
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
