/**
 * @file      apps/demo-service/src/app.test.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Pre-deploy test gate (the orchestrator runs this suite in the TEST stage before every deployment).
 * @depends   vitest, ./app
 * @usedBy    `pnpm test`, orchestrator TEST stage (`pnpm exec vitest run` in this folder)
 * @agentNotes Tests use explicit env objects — never read process.env here.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

const healthyEnv = { CATALOG_MODE: 'featured', APP_VERSION: 'test-1', DEPLOY_PROVIDER: 'local', ADMIN_TOKEN: 'admin-secret' };

describe('nimbus-books', () => {
  it('GET /health → 200 when configuration is complete', async () => {
    const res = await createApp(healthyEnv).request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; revision: string; checks: { config: { ok: boolean } } };
    expect(body.status).toBe('healthy');
    expect(body.revision).toBe('test-1');
    expect(body.checks.config.ok).toBe(true);
  });

  it('GET /health → 503 naming the missing variable when CATALOG_MODE is absent', async () => {
    const res = await createApp({ APP_VERSION: 'test-1' }).request('/health');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; checks: { config: { ok: boolean; missing: string[] } } };
    expect(body.status).toBe('unhealthy');
    expect(body.checks.config.missing).toEqual(['CATALOG_MODE']);
  });

  it('GET /api/books returns only featured books in featured mode', async () => {
    const res = await createApp(healthyEnv).request('/api/books');
    const body = (await res.json()) as { mode: string; books: Array<{ featured: boolean }> };
    expect(body.mode).toBe('featured');
    expect(body.books.length).toBeGreaterThan(0);
    expect(body.books.every((b) => b.featured)).toBe(true);
  });

  it('GET /api/books returns all books in all mode', async () => {
    const res = await createApp({ ...healthyEnv, CATALOG_MODE: 'all' }).request('/api/books');
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(6);
  });

  it('GET /api/books → 500 when configuration is missing', async () => {
    const res = await createApp({}).request('/api/books');
    expect(res.status).toBe(500);
  });

  it('GET /api/admin/stats → 401 without the admin token, 200 with it', async () => {
    const app = createApp(healthyEnv);
    expect((await app.request('/api/admin/stats')).status).toBe(401);
    expect((await app.request('/api/admin/stats', { headers: { 'x-admin-token': 'admin-secret' } })).status).toBe(200);
  });
});
