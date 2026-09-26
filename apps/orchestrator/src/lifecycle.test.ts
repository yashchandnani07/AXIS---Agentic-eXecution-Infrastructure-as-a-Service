/**
 * @file      apps/orchestrator/src/lifecycle.test.ts
 * @phase     P5
 * @owner     Orchestration & Cloud
 * @purpose   Proves the full loop with fake clouds: guard → approve → test → parallel deploy → verify → fault → incident
 *            → diagnosis → remediation approval → execute → re-verify → resolved.
 * @depends   vitest, @bobops/core, ./app, ./config, ./deps, ./testing/fake-provider
 * @usedBy    pnpm test
 * @agentNotes If this test fails after a change, the demo will fail too. Fix the code, not the test.
 */
import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_APP_PROFILE,
  computeMetrics,
  examplePlan,
  type Approval,
  type CloudProvider,
  type ProviderId,
  type RunAggregate,
} from '@bobops/core';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDeps } from './deps';
import { FakeProvider, fakeProbe } from './testing/fake-provider';

const TOKEN = 'test-approval-token';
const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

function setup(opts: { testsPass?: boolean } = {}) {
  const ibm = new FakeProvider('ibm-cloud');
  const aws = new FakeProvider('aws');
  const config = loadConfig({ APPROVAL_TOKEN: TOKEN, DEMO_MODE: 'true' } as NodeJS.ProcessEnv, { inMemory: true });
  const deps = createDeps(config, {
    providers: new Map<ProviderId, CloudProvider>([
      ['ibm-cloud', ibm],
      ['aws', aws],
    ]),
    probe: fakeProbe([ibm, aws]),
    runTests: async () => ({ ok: opts.testsPass ?? true, output: 'fake vitest output' }),
    github: null,
    retryDelayMs: 0,
  });
  return { deps, app: createApp(deps), ibm, aws };
}

type App = ReturnType<typeof createApp>;
const getRun = async (app: App, id: string) => (await (await app.request(`/api/runs/${id}`)).json()) as RunAggregate;
const approve = (app: App, approvalId: string) =>
  app.request(`/api/approvals/${approvalId}/decision`, post({ decision: 'approved', decidedBy: 'tester' }, { 'x-approval-token': TOKEN }));

async function plannedRun(app: App) {
  const run = (await (
    await app.request('/api/runs', post({ projectName: 'nimbus-books', repoPath: 'apps/orchestrator', objective: 'test', targets: ['ibm-cloud', 'aws'] }))
  ).json()) as { id: string };
  await app.request(`/api/runs/${run.id}/analysis`, post(EXAMPLE_APP_PROFILE));
  const { approval } = (await (await app.request(`/api/runs/${run.id}/plan`, post(examplePlan()))).json()) as { approval: Approval };
  return { runId: run.id, approvalId: approval.id };
}

async function healthyRun(ctx: ReturnType<typeof setup>) {
  const { runId, approvalId } = await plannedRun(ctx.app);
  expect((await approve(ctx.app, approvalId)).status).toBe(200);
  expect((await ctx.app.request(`/api/runs/${runId}/execute`, post({}))).status).toBe(202);
  await ctx.deps.lifecycle.waitForJob(runId);
  return runId;
}

describe('orchestrator lifecycle (fake clouds)', () => {
  it('blocks execution before human approval and records guard.blocked', async () => {
    const { app } = setup();
    const { runId } = await plannedRun(app);
    const res = await app.request(`/api/runs/${runId}/execute`, post({}));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('approval_required');
    expect((await getRun(app, runId)).events.some((e) => e.type === 'guard.blocked')).toBe(true);
  });

  it('tests, deploys to both clouds in parallel and verifies health', async () => {
    const ctx = setup();
    const runId = await healthyRun(ctx);
    const agg = await getRun(ctx.app, runId);
    expect(agg.run.state).toBe('healthy');
    expect(agg.deployments.filter((d) => d.status === 'succeeded')).toHaveLength(2);
    expect(ctx.ibm.deployCalls + ctx.aws.deployCalls).toBe(2);
    expect(agg.events.map((e) => e.type)).toEqual(expect.arrayContaining(['test.passed', 'provision.completed', 'build.completed', 'deploy.completed', 'verify.passed']));
    expect(computeMetrics(agg).providersLive).toBe(2);
  });

  it('deploys nothing when the pre-deploy tests fail', async () => {
    const ctx = setup({ testsPass: false });
    const runId = await healthyRun(ctx);
    const agg = await getRun(ctx.app, runId);
    expect(agg.run.state).toBe('failed');
    expect(ctx.ibm.deployCalls + ctx.aws.deployCalls).toBe(0);
  });

  it('detects a controlled fault, gates remediation on approval, and recovers', async () => {
    const ctx = setup();
    const { app } = ctx;
    const runId = await healthyRun(ctx);

    expect((await app.request('/api/demo/fault', post({ runId, provider: 'ibm-cloud' }))).status).toBe(401);
    expect((await app.request('/api/demo/fault', post({ runId, provider: 'ibm-cloud' }, { 'x-approval-token': TOKEN }))).status).toBe(200);
    expect((await getRun(app, runId)).run.state).toBe('healthy'); // not detected until verified

    await app.request(`/api/runs/${runId}/verify`, post({}));
    let agg = await getRun(app, runId);
    expect(agg.run.state).toBe('incident');
    const incident = agg.incidents[0]!;
    expect(incident.provider).toBe('ibm-cloud');

    const remediation = { action: { type: 'set_env', key: 'CATALOG_MODE', value: 'featured' }, rationale: 'Restore the approved configuration value', risk: 'low' };
    expect((await app.request(`/api/incidents/${incident.id}/remediation`, post(remediation))).status).toBe(409);

    const diagnosis = {
      summary: 'Configuration drift on IBM Cloud',
      rootCause: 'CATALOG_MODE is missing from the running revision',
      confidence: 'high',
      evidence: ['probe body: checks.config.missing = [CATALOG_MODE]', 'approved plan env: CATALOG_MODE=featured'],
    };
    expect((await app.request(`/api/incidents/${incident.id}/diagnosis`, post(diagnosis))).status).toBe(200);

    const proposed = await app.request(`/api/incidents/${incident.id}/remediation`, post(remediation));
    expect(proposed.status).toBe(201);
    const { approval } = (await proposed.json()) as { approval: Approval };
    expect((await getRun(app, runId)).run.state).toBe('awaiting_remediation_approval');

    expect((await app.request(`/api/incidents/${incident.id}/execute`, post({}))).status).toBe(403);
    expect((await approve(app, approval.id)).status).toBe(200);

    const executed = await app.request(`/api/incidents/${incident.id}/execute`, post({}));
    expect(executed.status).toBe(200);
    expect(((await executed.json()) as { ok: boolean }).ok).toBe(true);

    agg = await getRun(app, runId);
    expect(agg.run.state).toBe('healthy');
    expect(agg.incidents[0]!.status).toBe('resolved');
    expect(computeMetrics(agg).mttrMs).toBeGreaterThanOrEqual(0);
    expect(agg.events.filter((e) => e.type === 'guard.blocked').length).toBeGreaterThanOrEqual(1);
  });

  it('refuses to set secret-looking keys through remediation', async () => {
    const ctx = setup();
    const runId = await healthyRun(ctx);
    await ctx.app.request('/api/demo/fault', post({ runId, provider: 'aws' }, { 'x-approval-token': TOKEN }));
    await ctx.app.request(`/api/runs/${runId}/verify`, post({}));
    const incident = (await getRun(ctx.app, runId)).incidents[0]!;
    await ctx.app.request(`/api/incidents/${incident.id}/diagnosis`, post({ summary: 's', rootCause: 'r', confidence: 'low', evidence: ['a', 'b'] }));
    const res = await ctx.app.request(
      `/api/incidents/${incident.id}/remediation`,
      post({ action: { type: 'set_env', key: 'ADMIN_TOKEN', value: 'x' }, rationale: 'should be refused', risk: 'low' }),
    );
    expect(res.status).toBe(400);
  });

  it('long-poll wait reports when the plan is decided', async () => {
    const { app } = setup();
    const { runId, approvalId } = await plannedRun(app);
    const before = (await (await app.request(`/api/runs/${runId}/wait?until=plan_decided&timeoutSec=1`)).json()) as { reached: boolean };
    expect(before.reached).toBe(false);
    await approve(app, approvalId);
    const after = (await (await app.request(`/api/runs/${runId}/wait?until=plan_decided&timeoutSec=1`)).json()) as { reached: boolean; state: string };
    expect(after.reached).toBe(true);
    expect(after.state).toBe('approved');
  });
});
