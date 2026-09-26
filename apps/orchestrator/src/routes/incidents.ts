/**
 * @file      apps/orchestrator/src/routes/incidents.ts
 * @phase     P5
 * @owner     Orchestration & Cloud
 * @purpose   /api/incidents — list/get, sentinel sync, Bob's diagnosis, remediation proposal, approved execution.
 * @depends   hono, zod, @bobops/core, ../deps
 * @usedBy    bob-mcp (diagnosis, remediation, execute), control-center (list, sync)
 * @agentNotes /:id/execute is guarded inside LifecycleService.executeRemediation (hash-matched human approval).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { DiagnosisSchema, RemediationActionSchema, SeveritySchema } from '@bobops/core';
import type { Deps } from '../deps';

const RemediationBody = z.object({
  action: RemediationActionSchema,
  rationale: z.string().min(10),
  risk: SeveritySchema,
});

export function incidentRoutes(deps: Deps) {
  const r = new Hono();

  r.get('/', (c) => c.json(deps.store.data.incidents.slice().reverse()));

  r.post('/sync', async (c) => c.json(await deps.lifecycle.syncIncidents()));

  r.get('/:id', (c) => {
    const incident = deps.store.getIncident(c.req.param('id'));
    const run = deps.store.getRun(incident.runId);
    const recentEvents = deps.store.data.events
      .filter((e) => e.runId === incident.runId)
      .slice(-15)
      .map((e) => ({ at: e.at, actor: e.actor, kind: e.kind, type: e.type, message: e.message }));
    const planTarget = run.plan?.targets.find((t) => t.provider === incident.provider);
    return c.json({ incident, run: { id: run.id, state: run.state, repoPath: run.repoPath }, approvedPlanEnv: planTarget?.env ?? {}, recentEvents });
  });

  r.post('/:id/diagnosis', async (c) =>
    c.json(deps.lifecycle.recordDiagnosis(c.req.param('id'), DiagnosisSchema.parse(await c.req.json()))),
  );

  r.post('/:id/remediation', async (c) =>
    c.json(deps.lifecycle.proposeRemediation(c.req.param('id'), RemediationBody.parse(await c.req.json())), 201),
  );

  r.post('/:id/execute', async (c) => c.json(await deps.lifecycle.executeRemediation(c.req.param('id'))));

  return r;
}
