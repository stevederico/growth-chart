# Growth Chart

> "If you really want to hold yourself to a high standard, graph the growth rate of the number you care about instead of the number itself. Then you're winning if you can even keep it flat." — [Paul Graham](https://x.com/paulg/status/2034756891818004629)

Track GitHub release download counts over time. Automatic nightly snapshots with a dashboard to visualize growth.

## Stack

- React + Vite frontend with recharts
- Hono backend with SQLite
- Railway (serverless + cron)

## How It Works

- Backend fetches cumulative download counts from the GitHub Releases API on startup
- Railway cron wakes the serverless service daily, triggering a fresh snapshot
- Daily deltas are computed by diffing consecutive snapshots
- Dashboard shows total/growth rate chart, stats cards, daily downloads, and per-release breakdown

## Setup

```bash
git clone https://github.com/stevederico/growth-chart.git
cd growth-chart
npm install
```

Set the `GITHUB_REPO` environment variable to the repo you want to track:

```
GITHUB_REPO=owner/repo
```

## Development

```bash
npm run start
```

Frontend: http://localhost:5173
Backend: http://localhost:8000

## License

MIT
