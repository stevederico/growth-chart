// ==== GITHUB DOWNLOAD & METRICS TRACKING ====
// Self-contained domain module: opens its own node:sqlite handle on the same
// database file the adapter uses, owns the downloads/repos/github_metrics
// tables, fetches snapshots from the GitHub API, and mounts the /api/downloads
// and /api/metrics routes. Kept out of server.ts so a skateboard boilerplate
// re-sync can't clobber it again (that drift is exactly what wiped this before).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Hono, Env } from 'hono';
import type { Logger } from './types.ts';

/** Metric kinds tracked in github_metrics. */
const VALID_METRICS = ['stars', 'forks', 'clones', 'views'] as const;
type Metric = (typeof VALID_METRICS)[number];

/** Narrow an arbitrary string to a supported {@link Metric}. */
function isMetric(value: string): value is Metric {
  return (VALID_METRICS as readonly string[]).includes(value);
}

/** Dependencies injected from server.ts. */
export interface GithubTrackingDeps {
  /** SQLite file path (config.database.connectionString). */
  connectionString: string;
  /** Structured logger. */
  logger: Logger;
}

/** A stored download snapshot row (one release tag on one date). */
interface DownloadRow {
  repo: string;
  date: string;
  tag: string;
  download_count: number;
}

/** A stored github_metrics row. */
interface MetricRow {
  repo: string;
  date: string;
  metric: string;
  count: number;
  uniques: number;
}

/** A repo record. */
interface RepoRow {
  id: number;
  repo: string;
  created_at: string;
}

/** Coerce an unknown DB/JSON value to a finite integer, defaulting to 0. */
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Read `value` as a plain object, or an empty object when it is not one. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Read `value` as an array, or an empty array when it is not one. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Today's date as YYYY-MM-DD (UTC). */
function todayUTC(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Build and initialize the GitHub tracking layer: open the database, create
 * tables/indexes, run the repo-column migration, and seed repos from env.
 *
 * @param deps - Injected connection string and logger
 * @returns A tracker exposing route registration and the collector loop
 */
export function createGithubTracking(deps: GithubTrackingDeps) {
  const { logger } = deps;
  const dbPath = deps.connectionString || './backend/databases/GrowthChart.db';

  const GITHUB_REPOS = (process.env.GITHUB_REPOS || process.env.GITHUB_REPO || '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

  /** Build headers for GitHub API requests; adds auth when requested and a token is set. */
  function githubHeaders(authenticated = false): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'GrowthChart-Bot/1.0',
      Accept: 'application/vnd.github+json',
    };
    if (authenticated && GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    }
    return headers;
  }

  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    // Directory already exists — ignore.
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      tag TEXT NOT NULL,
      download_count INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration: add repo column to pre-multi-repo databases (before index creation).
  try {
    db.prepare('SELECT repo FROM downloads LIMIT 1').get();
  } catch {
    logger.info('Migrating downloads table: adding repo column');
    db.exec(`ALTER TABLE downloads ADD COLUMN repo TEXT NOT NULL DEFAULT ''`);
    db.exec('DROP INDEX IF EXISTS idx_downloads_date_tag');
    const defaultRepo = GITHUB_REPOS[0] || '';
    db.prepare(`UPDATE downloads SET repo = ? WHERE repo = ''`).run(defaultRepo);
    logger.info('Migration complete: repo column added', { defaultRepo });
  }

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_downloads_repo_date_tag ON downloads(repo, date, tag)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS github_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      date TEXT NOT NULL,
      metric TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      uniques INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_github_metrics_repo_date_metric
      ON github_metrics(repo, date, metric)
  `);

  // Seed repos table from GITHUB_REPOS env var when empty.
  const repoCount = toInt(asRecord(db.prepare('SELECT COUNT(*) as count FROM repos').get()).count);
  if (repoCount === 0 && GITHUB_REPOS.length > 0) {
    const insertRepo = db.prepare('INSERT OR IGNORE INTO repos (repo) VALUES (?)');
    for (const repo of GITHUB_REPOS) insertRepo.run(repo);
    logger.info('Seeded repos table from GITHUB_REPOS env var', { count: GITHUB_REPOS.length });
  }

  /** All repo records, oldest first. */
  function getReposFromDb(): RepoRow[] {
    return db.prepare('SELECT id, repo, created_at FROM repos ORDER BY created_at ASC').all() as unknown as RepoRow[];
  }

  /** Repo name strings only. */
  function getRepoListFromDb(): string[] {
    return getReposFromDb().map((r) => r.repo);
  }

  /** Whether a snapshot row already exists for (repo, date[, metric]). */
  function hasRow(table: 'downloads' | 'github_metrics', repo: string, date: string, metric?: string): boolean {
    const sql = metric
      ? 'SELECT COUNT(*) as count FROM github_metrics WHERE repo = ? AND date = ? AND metric = ?'
      : `SELECT COUNT(*) as count FROM ${table} WHERE repo = ? AND date = ?`;
    const params = metric ? [repo, date, metric] : [repo, date];
    return toInt(asRecord(db.prepare(sql).get(...params)).count) > 0;
  }

  /** Log the GitHub rate-limit budget when the header is present. */
  function logRateLimit(response: Response, context: string): void {
    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (remaining) logger.debug(`GitHub rate limit remaining (${context})`, { remaining });
  }

  /**
   * Fetch release download counts for one repo and upsert today's snapshot.
   * Idempotent per (repo, date, tag).
   */
  async function fetchDownloadSnapshot(
    repo: string
  ): Promise<{ repo: string; date: string; releases: Array<{ tag: string; download_count: number }> } | undefined> {
    if (!repo) {
      logger.warn('No repo provided, skipping snapshot');
      return;
    }
    const today = todayUTC();
    if (hasRow('downloads', repo, today)) {
      logger.debug('Snapshot already exists for today', { repo, date: today });
      return { repo, date: today, releases: [] };
    }

    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
      headers: githubHeaders(),
    });
    if (!response.ok) {
      logger.warn('GitHub API request failed', {
        repo,
        status: response.status,
        rateLimitRemaining: response.headers.get('X-RateLimit-Remaining'),
      });
      throw new Error(`GitHub API returned ${response.status}`);
    }
    logRateLimit(response, 'downloads');

    const releases = asArray(await response.json());
    const insertStmt = db.prepare(
      'INSERT OR REPLACE INTO downloads (repo, date, tag, download_count) VALUES (?, ?, ?, ?)'
    );

    const results: Array<{ tag: string; download_count: number }> = [];
    for (const raw of releases) {
      const release = asRecord(raw);
      const tag = String(release.tag_name ?? '');
      const downloadCount = asArray(release.assets).reduce<number>(
        (sum, asset) => sum + toInt(asRecord(asset).download_count),
        0
      );
      insertStmt.run(repo, today, tag, downloadCount);
      results.push({ tag, download_count: downloadCount });
    }

    logger.info('Download snapshot saved', { repo, date: today, releaseCount: results.length });
    return { repo, date: today, releases: results };
  }

  /** Fetch download snapshots for every configured repo; per-repo errors are logged, not thrown. */
  async function fetchAllSnapshots(): Promise<void> {
    const repos = getRepoListFromDb();
    if (repos.length === 0) {
      logger.warn('No repos configured, skipping snapshot');
      return;
    }
    for (const repo of repos) {
      try {
        await fetchDownloadSnapshot(repo);
      } catch (err) {
        logger.error('Snapshot failed for repo', { repo, error: errMsg(err) });
      }
    }
  }

  /** Upsert a traffic metric (clones|views) from the GitHub traffic API. Needs GITHUB_TOKEN. */
  async function fetchTraffic(repo: string, metric: 'clones' | 'views'): Promise<void> {
    if (!GITHUB_TOKEN) {
      logger.warn(`GITHUB_TOKEN not set, skipping traffic ${metric}`, { repo });
      return;
    }
    const response = await fetch(`https://api.github.com/repos/${repo}/traffic/${metric}`, {
      headers: githubHeaders(true),
    });
    logRateLimit(response, metric);
    if (!response.ok) {
      logger.warn(`GitHub traffic/${metric} API failed`, { repo, status: response.status });
      return;
    }
    const data = asRecord(await response.json());
    const entries = asArray(data[metric]);
    const insertStmt = db.prepare(
      `INSERT OR REPLACE INTO github_metrics (repo, date, metric, count, uniques) VALUES (?, ?, '${metric}', ?, ?)`
    );
    for (const raw of entries) {
      const entry = asRecord(raw);
      const date = new Date(String(entry.timestamp)).toISOString().split('T')[0];
      insertStmt.run(repo, date, toInt(entry.count), toInt(entry.uniques));
    }
    logger.info(`Traffic ${metric} snapshot saved`, { repo, entries: entries.length });
  }

  /** Upsert today's stars or forks count from the repo endpoint. Idempotent per day. */
  async function fetchCountMetric(repo: string, metric: 'stars' | 'forks'): Promise<void> {
    const today = todayUTC();
    if (hasRow('github_metrics', repo, today, metric)) {
      logger.debug(`${metric} snapshot already exists for today`, { repo, date: today });
      return;
    }
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: githubHeaders(!!GITHUB_TOKEN),
    });
    logRateLimit(response, metric);
    if (!response.ok) {
      logger.warn(`GitHub repo API failed (${metric})`, { repo, status: response.status });
      return;
    }
    const data = asRecord(await response.json());
    const count = toInt(metric === 'stars' ? data.stargazers_count : data.forks_count);
    db.prepare(
      `INSERT OR REPLACE INTO github_metrics (repo, date, metric, count, uniques) VALUES (?, ?, '${metric}', ?, 0)`
    ).run(repo, today, count);
    logger.info(`${metric} snapshot saved`, { repo, date: today, count });
  }

  /** Dispatch a single metric fetch by kind. */
  function fetchMetric(repo: string, metric: Metric): Promise<void> {
    if (metric === 'clones' || metric === 'views') return fetchTraffic(repo, metric);
    return fetchCountMetric(repo, metric);
  }

  /** Fetch every metric for every repo; per-item errors are logged, not thrown. */
  async function fetchAllMetricSnapshots(): Promise<void> {
    const repos = getRepoListFromDb();
    if (repos.length === 0) {
      logger.warn('No repos configured, skipping metric snapshots');
      return;
    }
    for (const repo of repos) {
      for (const metric of VALID_METRICS) {
        try {
          await fetchMetric(repo, metric);
        } catch (err) {
          logger.error('Metric snapshot failed for repo', { repo, metric, error: errMsg(err) });
        }
      }
    }
  }

  /**
   * Mount all GitHub tracking routes on the app. Unauthenticated by design —
   * the dashboard reads these without a session (matches the original service).
   *
   * @param app - Hono application (any env — routes don't read context vars)
   */
  function registerRoutes<E extends Env>(app: Hono<E>): void {
    app.get('/api/downloads/repos', (c) => c.json({ repos: getRepoListFromDb() }));

    app.get('/api/repos', (c) => c.json({ repos: getReposFromDb() }));

    app.post('/api/repos', async (c) => {
      const body = asRecord(await c.req.json().catch(() => ({})));
      const repo = String(body.repo ?? '').trim();
      if (!repo || !repo.includes('/')) {
        return c.json({ error: 'Repo must be in "owner/name" format' }, 400);
      }
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: githubHeaders() });
        if (!res.ok) return c.json({ error: `GitHub repo "${repo}" not found` }, 400);
      } catch {
        return c.json({ error: 'Failed to validate repo on GitHub' }, 502);
      }
      try {
        db.prepare('INSERT INTO repos (repo) VALUES (?)').run(repo);
      } catch (err) {
        if (errMsg(err).includes('UNIQUE')) return c.json({ error: 'Repo already added' }, 409);
        throw err;
      }
      const inserted = db.prepare('SELECT id, repo, created_at FROM repos WHERE repo = ?').get(repo);
      fetchDownloadSnapshot(repo).catch((err) => {
        logger.error('Initial snapshot failed for new repo', { repo, error: errMsg(err) });
      });
      return c.json(inserted as unknown as RepoRow, 201);
    });

    app.delete('/api/repos/:id', (c) => {
      const id = toInt(c.req.param('id'));
      const existing = asRecord(db.prepare('SELECT repo FROM repos WHERE id = ?').get(id));
      if (existing.repo === undefined) return c.json({ error: 'Repo not found' }, 404);
      db.prepare('DELETE FROM repos WHERE id = ?').run(id);
      return c.json({ message: 'Repo removed', repo: String(existing.repo) });
    });

    app.get('/api/downloads', (c) => {
      try {
        const conditions: string[] = [];
        const params: string[] = [];
        for (const [col, val] of [
          ['repo', c.req.query('repo')],
          ['date >=', c.req.query('from')],
          ['date <=', c.req.query('to')],
        ] as const) {
          if (val) {
            conditions.push(col === 'repo' ? 'repo = ?' : `${col} ?`);
            params.push(val);
          }
        }
        let sql = 'SELECT repo, date, tag, download_count FROM downloads';
        if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
        sql += ' ORDER BY date DESC, tag ASC';
        return c.json(db.prepare(sql).all(...params) as unknown as DownloadRow[]);
      } catch (err) {
        logger.error('Failed to fetch downloads', { error: errMsg(err) });
        return c.json({ error: 'Failed to fetch downloads' }, 500);
      }
    });

    app.get('/api/downloads/daily', (c) => {
      try {
        const repo = c.req.query('repo');
        let sql = 'SELECT repo, date, tag, download_count FROM downloads';
        const params: string[] = [];
        if (repo) {
          sql += ' WHERE repo = ?';
          params.push(repo);
        }
        sql += ' ORDER BY date ASC, tag ASC';
        const rows = db.prepare(sql).all(...params) as unknown as DownloadRow[];
        return c.json(dailyDownloadDeltas(rows));
      } catch (err) {
        logger.error('Failed to compute daily deltas', { error: errMsg(err) });
        return c.json({ error: 'Failed to compute daily deltas' }, 500);
      }
    });

    app.get('/api/downloads/latest', (c) => {
      try {
        const repo = c.req.query('repo');
        let dateSql = 'SELECT date FROM downloads';
        const dateParams: string[] = [];
        if (repo) {
          dateSql += ' WHERE repo = ?';
          dateParams.push(repo);
        }
        dateSql += ' ORDER BY date DESC LIMIT 1';
        const latest = asRecord(db.prepare(dateSql).get(...dateParams));
        if (latest.date === undefined) return c.json({ date: null, total: 0, releases: [] });

        let rowsSql = 'SELECT tag, download_count FROM downloads WHERE date = ?';
        const rowsParams: string[] = [String(latest.date)];
        if (repo) {
          rowsSql += ' AND repo = ?';
          rowsParams.push(repo);
        }
        rowsSql += ' ORDER BY tag ASC';
        const rows = db.prepare(rowsSql).all(...rowsParams) as unknown as DownloadRow[];
        const total = rows.reduce((sum, r) => sum + r.download_count, 0);
        return c.json({
          date: String(latest.date),
          total,
          releases: rows.map((r) => ({ tag: r.tag, download_count: r.download_count })),
        });
      } catch (err) {
        logger.error('Failed to fetch latest downloads', { error: errMsg(err) });
        return c.json({ error: 'Failed to fetch latest downloads' }, 500);
      }
    });

    app.post('/api/downloads/snapshot', async (c) => {
      try {
        const body = asRecord(await c.req.json().catch(() => ({})));
        const repo = body.repo ? String(body.repo) : undefined;
        if (repo) return c.json((await fetchDownloadSnapshot(repo)) ?? {}, 201);
        await fetchAllSnapshots();
        return c.json({ message: 'Snapshots completed for all repos', repos: getRepoListFromDb() }, 201);
      } catch (err) {
        return c.json({ error: 'Failed to fetch snapshot: ' + errMsg(err) }, 500);
      }
    });

    app.post('/api/downloads/backfill', async (c) => {
      try {
        const body = asRecord(await c.req.json().catch(() => ({})));
        const date = body.date ? String(body.date) : '';
        const total = body.total;
        const repo = body.repo ? String(body.repo) : getRepoListFromDb()[0] || '';
        if (!date || total == null) return c.json({ error: 'date and total are required' }, 400);
        const totalNum = toInt(total);

        const nearest = asRecord(
          db
            .prepare(
              'SELECT DISTINCT date FROM downloads WHERE repo = ? ORDER BY ABS(julianday(date) - julianday(?)) LIMIT 1'
            )
            .get(repo, date)
        );
        if (nearest.date === undefined) {
          return c.json({ error: 'No existing snapshots to base distribution on' }, 400);
        }

        const refRows = db
          .prepare('SELECT tag, download_count FROM downloads WHERE repo = ? AND date = ?')
          .all(repo, String(nearest.date)) as unknown as DownloadRow[];
        const refTotal = refRows.reduce((s, r) => s + r.download_count, 0);
        const insertStmt = db.prepare(
          'INSERT OR REPLACE INTO downloads (repo, date, tag, download_count) VALUES (?, ?, ?, ?)'
        );

        const results: Array<{ tag: string; download_count: number }> = [];
        let assigned = 0;
        for (let i = 0; i < refRows.length; i++) {
          const isLast = i === refRows.length - 1;
          const count = Math.max(
            0,
            isLast ? totalNum - assigned : Math.round((refRows[i].download_count / refTotal) * totalNum)
          );
          assigned += count;
          insertStmt.run(repo, date, refRows[i].tag, count);
          results.push({ tag: refRows[i].tag, download_count: count });
        }
        logger.info('Backfill saved', { repo, date, total: totalNum, releaseCount: results.length });
        return c.json({ repo, date, total: totalNum, releases: results }, 201);
      } catch (err) {
        logger.error('Backfill failed', { error: errMsg(err) });
        return c.json({ error: 'Backfill failed: ' + errMsg(err) }, 500);
      }
    });

    app.get('/api/metrics', (c) => {
      try {
        const metric = c.req.query('metric');
        if (!metric || !isMetric(metric)) {
          return c.json({ error: `metric query param required, one of: ${VALID_METRICS.join(', ')}` }, 400);
        }
        let sql = 'SELECT repo, date, metric, count, uniques FROM github_metrics WHERE metric = ?';
        const params: string[] = [metric];
        for (const [col, val] of [
          ['repo =', c.req.query('repo')],
          ['date >=', c.req.query('from')],
          ['date <=', c.req.query('to')],
        ] as const) {
          if (val) {
            sql += ` AND ${col} ?`;
            params.push(val);
          }
        }
        sql += ' ORDER BY date DESC';
        return c.json(db.prepare(sql).all(...params) as unknown as MetricRow[]);
      } catch (err) {
        logger.error('Failed to fetch metrics', { error: errMsg(err) });
        return c.json({ error: 'Failed to fetch metrics' }, 500);
      }
    });

    app.get('/api/metrics/daily', (c) => {
      try {
        const metric = c.req.query('metric');
        if (!metric || !isMetric(metric)) {
          return c.json({ error: `metric query param required, one of: ${VALID_METRICS.join(', ')}` }, 400);
        }
        const repo = c.req.query('repo');
        let sql = 'SELECT date, SUM(count) as count, SUM(uniques) as uniques FROM github_metrics WHERE metric = ?';
        const params: string[] = [metric];
        if (repo) {
          sql += ' AND repo = ?';
          params.push(repo);
        }
        sql += ' GROUP BY date ORDER BY date ASC';
        const rows = db.prepare(sql).all(...params) as unknown as Array<{ date: string; count: number }>;
        const deltas: Array<{ date: string; total: number }> = [];
        for (let i = 1; i < rows.length; i++) {
          deltas.push({ date: rows[i].date, total: rows[i].count - rows[i - 1].count });
        }
        return c.json(deltas);
      } catch (err) {
        logger.error('Failed to compute metric daily deltas', { error: errMsg(err) });
        return c.json({ error: 'Failed to compute metric daily deltas' }, 500);
      }
    });

    app.get('/api/metrics/latest', (c) => {
      try {
        const metric = c.req.query('metric');
        if (!metric || !isMetric(metric)) {
          return c.json({ error: `metric query param required, one of: ${VALID_METRICS.join(', ')}` }, 400);
        }
        const repo = c.req.query('repo');
        let sql = 'SELECT date, SUM(count) as count, SUM(uniques) as uniques FROM github_metrics WHERE metric = ?';
        const params: string[] = [metric];
        if (repo) {
          sql += ' AND repo = ?';
          params.push(repo);
        }
        sql += ' ORDER BY date DESC LIMIT 1';
        // Aggregate (SUM) returns one row with NULL columns when empty, so guard
        // on null — not undefined — before stringifying the date.
        const row = asRecord(db.prepare(sql).get(...params));
        if (row.date == null) return c.json({ date: null, count: 0, uniques: 0 });
        return c.json({ date: String(row.date), count: toInt(row.count), uniques: toInt(row.uniques) });
      } catch (err) {
        logger.error('Failed to fetch latest metric', { error: errMsg(err) });
        return c.json({ error: 'Failed to fetch latest metric' }, 500);
      }
    });

    app.post('/api/metrics/snapshot', async (c) => {
      try {
        const body = asRecord(await c.req.json().catch(() => ({})));
        const metric = body.metric ? String(body.metric) : undefined;
        const repo = body.repo ? String(body.repo) : undefined;
        if (metric && !isMetric(metric)) {
          return c.json({ error: `Invalid metric, must be one of: ${VALID_METRICS.join(', ')}` }, 400);
        }
        const repos = repo ? [repo] : getRepoListFromDb();
        const metrics: readonly Metric[] = metric && isMetric(metric) ? [metric] : VALID_METRICS;
        for (const r of repos) {
          for (const m of metrics) {
            try {
              await fetchMetric(r, m);
            } catch (err) {
              logger.error('Metric snapshot failed', { repo: r, metric: m, error: errMsg(err) });
            }
          }
        }
        return c.json({ message: 'Metric snapshots completed', repos, metrics }, 201);
      } catch (err) {
        return c.json({ error: 'Failed to fetch metric snapshot: ' + errMsg(err) }, 500);
      }
    });
  }

  /**
   * Run an initial snapshot on startup, then hourly backfill any repo/metric
   * missing today's row (covers servers that stay up across midnight).
   *
   * @returns The interval timer (unref'd) so callers can clear it in tests
   */
  function startCollectors(): ReturnType<typeof setInterval> {
    fetchAllSnapshots().catch(() => {});
    fetchAllMetricSnapshots().catch(() => {});

    const timer = setInterval(async () => {
      try {
        const today = todayUTC();
        for (const repo of getRepoListFromDb()) {
          if (!hasRow('downloads', repo, today)) {
            logger.info('No snapshot for today, triggering fetch', { repo, date: today });
            try {
              await fetchDownloadSnapshot(repo);
            } catch (err) {
              logger.error('Hourly snapshot failed for repo', { repo, error: errMsg(err) });
            }
          }
          for (const metric of VALID_METRICS) {
            if (!hasRow('github_metrics', repo, today, metric)) {
              try {
                await fetchMetric(repo, metric);
              } catch (err) {
                logger.error('Hourly metric snapshot failed', { repo, metric, error: errMsg(err) });
              }
            }
          }
        }
      } catch (err) {
        logger.error('Hourly collector loop failed', { error: errMsg(err) });
      }
    }, 60 * 60 * 1000);
    timer.unref?.();
    return timer;
  }

  return { registerRoutes, startCollectors, db };
}

/**
 * Compute day-over-day download deltas from cumulative per-tag snapshots.
 *
 * @param rows - Download rows ordered by date then tag
 * @returns One entry per day (after the first) with the summed positive delta
 */
export function dailyDownloadDeltas(
  rows: DownloadRow[]
): Array<{ date: string; total: number; releases: Array<{ tag: string; delta: number }> }> {
  const byDate = new Map<string, Array<{ tag: string; download_count: number }>>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push({ tag: row.tag, download_count: row.download_count });
    byDate.set(row.date, list);
  }
  const dates = [...byDate.keys()].sort();
  const deltas: Array<{ date: string; total: number; releases: Array<{ tag: string; delta: number }> }> = [];
  for (let i = 1; i < dates.length; i++) {
    const prevMap = new Map((byDate.get(dates[i - 1]) ?? []).map((r) => [r.tag, r.download_count]));
    let total = 0;
    const releases: Array<{ tag: string; delta: number }> = [];
    for (const entry of byDate.get(dates[i]) ?? []) {
      const delta = entry.download_count - (prevMap.get(entry.tag) ?? 0);
      if (delta !== 0) {
        releases.push({ tag: entry.tag, delta });
        total += delta;
      }
    }
    deltas.push({ date: dates[i], total, releases });
  }
  return deltas;
}

/** Extract a message string from an unknown thrown value. */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
