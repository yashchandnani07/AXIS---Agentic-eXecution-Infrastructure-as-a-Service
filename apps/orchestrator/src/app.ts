/**
 * @file      apps/orchestrator/src/app.ts
 * @phase     P4 (replaced in P5)
 * @owner     Orchestration & Cloud
 * @purpose   Builds the Hono app: CORS, route mounting, and the single error-to-JSON mapping.
 * @depends   hono, zod, @bobops/core, ./deps, ./routes/*, ./lib/errors
 * @usedBy    src/index.ts, tests (app.request())
 * @agentNotes Error body is ALWAYS { error, code }. Keep CORS allowHeaders in sync with headers used by the UI.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { InvalidTransitionError } from '@bobops/core';
import type { Deps } from './deps';
import { HttpError } from './lib/errors';
import { approvalRoutes } from './routes/approvals';
import { demoRoutes } from './routes/demo';
import { eventRoutes } from './routes/events';
import { incidentRoutes } from './routes/incidents';
import { providerRoutes } from './routes/providers';
import { runRoutes } from './routes/runs';

export function createApp(deps: Deps) {
  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: [deps.config.CONTROL_CENTER_ORIGIN],
      allowHeaders: ['content-type', 'x-approval-token', 'x-actor'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.get('/api/health', (c) => c.json({ ok: true, service: 'bobops-orchestrator', time: new Date().toISOString() }));
  app.route('/api/runs', runRoutes(deps));
  app.route('/api/approvals', approvalRoutes(deps));
  app.route('/api/incidents', incidentRoutes(deps));
  app.route('/api/providers', providerRoutes(deps));
  app.route('/api/events', eventRoutes(deps));
  app.route('/api/demo', demoRoutes(deps));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, code: err.code }, err.status as ContentfulStatusCode);
    if (err instanceof InvalidTransitionError) return c.json({ error: err.message, code: 'invalid_transition' }, 409);
    if (err instanceof ZodError) return c.json({ error: 'Validation failed', code: 'validation', issues: err.issues }, 400);
    if (err instanceof SyntaxError) return c.json({ error: 'Request body must be valid JSON', code: 'bad_json' }, 400);
    console.error('[orchestrator] unhandled error', err);
    return c.json({ error: err instanceof Error ? err.message : 'Internal error', code: 'internal' }, 500);
  });

  return app;
}
