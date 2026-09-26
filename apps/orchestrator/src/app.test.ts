/**
 * @file      apps/orchestrator/src/app.test.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   HTTP-level tests of runs, plans and the HUMAN approval gate (in-memory store, no clouds).
 * @depends   vitest, @bobops/core fixtures, ./app, ./config, ./deps
 * @usedBy    pnpm test
 * @agentNotes repoPath uses 'apps/orchestrator' because it always exists, even before the demo app is built.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_APP_PROFILE, examplePlan, type Approval, type RunAggregate } from '@bobops/core';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDeps } from './deps';

const TOKEN = 'test-approval-token';
const testConfig = () => loadConfig({ APPROVAL_TOKEN: TOKEN, DEMO_MODE: 'true' } as NodeJS.ProcessEnv, { inMemory: true });
const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

function setup() {
  const deps = createDeps(testConfig());
  return { deps, app: createApp(deps) };
}

async function createRun(app: ReturnType<typeof createApp>) {
  const res = await app.request('/api/runs', post({ projectName: 'nimbus-books', repoPath: 'apps/orchestrator', objective: 'test', targets: ['ibm-cloud', 'aws'] }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function plannedRun(app: ReturnType<typeof createApp>) {
  const runId = await createRun(app);
  expect((await app.request(`/api/runs/${runId}/analysis`, post(EXAMPLE_APP_PROFILE))).status).toBe(200);
  const res = await app.request(`/api/runs/${runId}/plan`, post(examplePlan()));
  expect(res.status).toBe(201);
  const { approval } = (await res.json()) as { approval: Approval };
  return { runId, approval };
}

const getRun = async (app: ReturnType<typeof createApp>, id: string) => (await (await app.request(`/api/runs/${id}`)).json()) as RunAggregate;

describe('orchestrator: runs, plans and approvals', () => {
  it('reports health', async () => {
    const { app } = setup();
    expect((await app.request('/api/health')).status).toBe(200);
  });

  it('moves a run to awaiting_approval with a hash-bound pending approval', async () => {
    const { app } = setup();
    const { runId, approval } = await plannedRun(app);
    const agg = await getRun(app, runId);
    expect(agg.run.state).toBe('awaiting_approval');
    expect(approval.status).toBe('pending');
    expect(approval.subjectHash).toBe(agg.run.planHash);
    expect(agg.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['run.created', 'analysis.recorded', 'specialist.finding', 'plan.submitted', 'approval.requested']),
    );
  });

  it('refuses approval without the human token and records guard.blocked', async () => {
    const { app } = setup();
    const { runId, approval } = await plannedRun(app);
    const res = await app.request(`/api/approvals/${approval.id}/decision`, post({ decision: 'approved' }));
    expect(res.status).toBe(401);
    const agg = await getRun(app, runId);
    expect(agg.run.state).toBe('awaiting_approval');
    expect(agg.events.some((e) => e.type === 'guard.blocked')).toBe(true);
  });

  it('approves with the human token', async () => {
    const { app } = setup();
    const { runId, approval } = await plannedRun(app);
    const res = await app.request(`/api/approvals/${approval.id}/decision`, post({ decision: 'approved', decidedBy: 'tester' }, { 'x-approval-token': TOKEN }));
    expect(res.status).toBe(200);
    expect((await getRun(app, runId)).run.state).toBe('approved');
  });

  it('supersedes the pending approval when a new plan is submitted', async () => {
    const { app } = setup();
    const { runId, approval } = await plannedRun(app);
    await app.request(`/api/runs/${runId}/plan`, post(examplePlan(['ibm-cloud'])));
    const agg = await getRun(app, runId);
    expect(agg.approvals.find((a) => a.id === approval.id)?.status).toBe('rejected');
    expect(agg.approvals.filter((a) => a.status === 'pending')).toHaveLength(1);
  });

  it('rejects a plan before analysis with 409', async () => {
    const { app } = setup();
    const runId = await createRun(app);
    expect((await app.request(`/api/runs/${runId}/plan`, post(examplePlan()))).status).toBe(409);
  });

  it('rejects a repoPath outside the repository with 400', async () => {
    const { app } = setup();
    const res = await app.request('/api/runs', post({ projectName: 'x', repoPath: '../../Windows', objective: 'x', targets: ['aws'] }));
    expect(res.status).toBe(400);
  });
});
