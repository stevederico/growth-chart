import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGithubTracking, dailyDownloadDeltas } from './github.ts';
import type { Logger } from './types.ts';

/** Silent logger so tests don't spew structured logs. */
const noopLogger: Logger = { error() {}, warn() {}, info() {}, debug() {} };

describe('dailyDownloadDeltas', () => {
  it('returns no deltas for fewer than two dates', () => {
    assert.deepEqual(dailyDownloadDeltas([]), []);
    assert.deepEqual(dailyDownloadDeltas([{ repo: 'a/b', date: '2026-01-01', tag: 'v1', download_count: 5 }]), []);
  });

  it('computes per-tag positive deltas between consecutive days', () => {
    const rows = [
      { repo: 'a/b', date: '2026-01-01', tag: 'v1', download_count: 10 },
      { repo: 'a/b', date: '2026-01-02', tag: 'v1', download_count: 15 },
      { repo: 'a/b', date: '2026-01-02', tag: 'v2', download_count: 3 },
    ];
    const out = dailyDownloadDeltas(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].date, '2026-01-02');
    assert.equal(out[0].total, 8); // v1 +5, v2 +3 (new tag, prev 0)
    assert.deepEqual(out[0].releases, [
      { tag: 'v1', delta: 5 },
      { tag: 'v2', delta: 3 },
    ]);
  });

  it('omits zero-delta tags', () => {
    const rows = [
      { repo: 'a/b', date: '2026-01-01', tag: 'v1', download_count: 10 },
      { repo: 'a/b', date: '2026-01-02', tag: 'v1', download_count: 10 },
    ];
    assert.deepEqual(dailyDownloadDeltas(rows), [{ date: '2026-01-02', total: 0, releases: [] }]);
  });
});

describe('GitHub tracking routes (no network)', () => {
  const dbPath = join(tmpdir(), `gc-github-test-${process.pid}.db`);
  let app: Hono;

  before(() => {
    delete process.env.GITHUB_REPOS;
    delete process.env.GITHUB_REPO;
    const tracking = createGithubTracking({ connectionString: dbPath, logger: noopLogger });
    app = new Hono();
    tracking.registerRoutes(app);
  });

  after(async () => {
    await rm(dbPath, { force: true }).catch(() => {});
    await rm(`${dbPath}-wal`, { force: true }).catch(() => {});
    await rm(`${dbPath}-shm`, { force: true }).catch(() => {});
  });

  it('GET /api/downloads/repos returns an empty list when unseeded', async () => {
    const res = await app.request('/api/downloads/repos');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { repos: [] });
  });

  it('GET /api/downloads returns an empty array', async () => {
    const res = await app.request('/api/downloads');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });

  it('GET /api/metrics without a metric param is a 400', async () => {
    const res = await app.request('/api/metrics');
    assert.equal(res.status, 400);
  });

  it('GET /api/metrics/latest returns an empty snapshot for a valid metric', async () => {
    const res = await app.request('/api/metrics/latest?metric=stars');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { date: null, count: 0, uniques: 0 });
  });

  it('POST /api/repos rejects a name without a slash before any network call', async () => {
    const res = await app.request('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'noslash' }),
    });
    assert.equal(res.status, 400);
  });

  it('DELETE /api/repos/:id is a 404 for an unknown id', async () => {
    const res = await app.request('/api/repos/999', { method: 'DELETE' });
    assert.equal(res.status, 404);
  });
});
