/**
 * @file      apps/orchestrator/src/routes/runs.ts
 * @phase     P4 (replaced in P5)
 * @owner     Orchestration & Cloud
 * @purpose   HTTP routes under /api/runs: create, analysis, plan, notes, execute, verify, logs, wait (long-poll), export.
 * @depends   hono, zod, @bobops/core, ../deps
 * @usedBy    app.ts (mounted at /api/runs); callers: bob-mcp, control-center, scripts
 * @agentNotes execute returns 202 immediately; the job runs in the background (poll with /wait?until=deployed).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  AppProfileSchema,
  DeploymentPlanSchema,
  EventKindSchema,
  ProviderIdSchema,
  SpecialistSchema,
  WaitConditionSchema,
} from '@bobops/core';
import type { Deps } from '../deps';

const CreateRunBody = z.object({
  projectName: z.string().min(1),
  repoPath: z.string().min(1),
  objective: z.string().min(1),
  targets: z.array(ProviderIdSchema).min(1),
  /** How often the user wants the GitHub sentinel to check on this deployment, in minutes. GitHub Actions cannot
   * schedule faster than every 5 minutes, so this must be a multiple of 5 (5, 10, 15, 30, 60, ...). */
  sentinelIntervalMinutes: z
    .number()
    .int()
    .min(5)
    .max(1440)
    .refine((n) => n % 5 === 0, 'sentinelIntervalMinutes must be a multiple of 5')
    .default(5)
    .optional(),
});

const NoteBody = z.object({
  kind: EventKindSchema.default('observation'),
  message: z.string().min(1),
  specialist: SpecialistSchema.optional(),
});

const clamp = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min);

export function runRoutes(deps: Deps) {
  const r = new Hono();

  r.get('/', (c) => c.json(deps.store.data.runs.slice().reverse()));

  r.post('/', async (c) => {
    const actor = c.req.header('x-actor') === 'bob' ? 'bob' : 'human';
    return c.json(deps.runs.createRun(CreateRunBody.parse(await c.req.json()), actor), 201);
  });

  r.get('/:id', (c) => c.json(deps.store.aggregate(c.req.param('id'))));

  r.post('/:id/analysis', async (c) =>
    c.json(deps.runs.recordAnalysis(c.req.param('id'), AppProfileSchema.parse(await c.req.json()))),
  );

  r.post('/:id/plan', async (c) =>
    c.json(deps.runs.submitPlan(c.req.param('id'), DeploymentPlanSchema.parse(await c.req.json())), 201),
  );

  r.post('/:id/notes', async (c) => {
    const runId = c.req.param('id');
    deps.store.getRun(runId);
    const body = NoteBody.parse(await c.req.json());
    const event = deps.bus.emit({
      runId,
      actor: 'bob',
      kind: body.kind,
      type: 'bob.note',
      message: body.specialist ? `${body.specialist}: ${body.message}` : body.message,
    });
    return c.json(event, 201);
  });

  r.post('/:id/execute', (c) => c.json(deps.lifecycle.startExecution(c.req.param('id')), 202));

  r.post('/:id/verify', async (c) => c.json(await deps.lifecycle.requestVerification(c.req.param('id'))));

  r.get('/:id/logs', async (c) => {
    const provider = ProviderIdSchema.parse(c.req.query('provider'));
    const lines = clamp(Number(c.req.query('lines') ?? 60), 10, 200);
    return c.json({ provider, lines: await deps.lifecycle.logs(c.req.param('id'), provider, lines) });
  });

  r.get('/:id/wait', async (c) => {
    const until = WaitConditionSchema.parse(c.req.query('until'));
    const timeoutSec = clamp(Number(c.req.query('timeoutSec') ?? 50), 1, 55);
    return c.json(await deps.lifecycle.waitFor(c.req.param('id'), until, timeoutSec * 1000));
  });

  r.post('/:id/export', async (c) => c.json(await deps.lifecycle.exportEvidence(c.req.param('id'))));

  return r;
}
