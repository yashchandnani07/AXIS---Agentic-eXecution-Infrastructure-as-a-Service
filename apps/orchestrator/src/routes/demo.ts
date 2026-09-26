/**
 * @file      apps/orchestrator/src/routes/demo.ts
 * @phase     P5
 * @owner     Orchestration & Cloud
 * @purpose   POST /api/demo/fault — controlled, repeatable fault for the live demo (PRD §9). Human-only.
 * @depends   hono, zod, @bobops/core, ../deps, ../lib/errors
 * @usedBy    control-center (⚡ button, visible with ?demo=1), scripts/demo/inject-fault.ts
 * @agentNotes Requires DEMO_MODE=true AND the human approval token. Bob must never call this.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { ProviderIdSchema } from '@bobops/core';
import type { Deps } from '../deps';
import { HttpError } from '../lib/errors';

const FaultBody = z.object({
  runId: z.string(),
  provider: ProviderIdSchema,
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default('CATALOG_MODE'),
});

export function demoRoutes(deps: Deps) {
  const r = new Hono();
  r.post('/fault', async (c) => {
    if (c.req.header('x-approval-token') !== deps.config.APPROVAL_TOKEN) {
      throw new HttpError(401, 'approval_token_required', 'Fault injection is a human-only demo control');
    }
    const body = FaultBody.parse(await c.req.json());
    return c.json(await deps.lifecycle.injectFault(body.runId, body.provider, body.key));
  });
  return r;
}
