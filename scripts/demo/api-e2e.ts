/**
 * @file      scripts/demo/api-e2e.ts
 * @phase     P8
 * @owner     Orchestration & Cloud
 * @purpose   Drives the full lifecycle over HTTP against the RUNNING orchestrator and REAL clouds, playing both "Bob"
 *            (fixture analysis/plan/diagnosis) and "human" (approvals with the token). The Bob-independent safety net.
 * @depends   ../lib/env, @bobops/core
 * @usedBy    `pnpm api:e2e [--targets ibm-cloud,aws] [--with-recovery] [--fault-provider ibm-cloud] [--ui-approval]` (HUMAN)
 * @agentNotes Needs `pnpm dev:api` running and generated assets present (pnpm demo:golden).
 */
import { arg } from '../lib/env';
import {
  EXAMPLE_APP_PROFILE,
  ProviderIdSchema,
  examplePlan,
  formatDuration,
  type Approval,
  type Incident,
  type RunAggregate,
} from '@bobops/core';

const API = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000';
const TOKEN = process.env.APPROVAL_TOKEN ?? '';
const targets = (arg('--targets') ?? 'ibm-cloud,aws').split(',').map((t) => ProviderIdSchema.parse(t.trim()));
const withRecovery = process.argv.includes('--with-recovery');
/** --ui-approval: do NOT approve from the script; wait for a human to click Approve in the Control Center (Phase 11 test). */
const uiApproval = process.argv.includes('--ui-approval');
const faultProvider = ProviderIdSchema.parse(arg('--fault-provider') ?? targets[0]);
const human = { 'x-approval-token': TOKEN };
const UI = process.env.CONTROL_CENTER_URL ?? 'http://localhost:3000';

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as { error?: string }) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data?.error ?? text}`);
  return data as T;
}

const step = (msg: string) => console.log(`\n▶ ${msg}`);

async function waitFor(runId: string, until: string, timeoutSec: number) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const r = await call<{ reached: boolean; state: string }>('GET', `/api/runs/${runId}/wait?until=${until}&timeoutSec=50`);
    console.log(`  … state=${r.state}`);
    if (r.reached) return r;
  }
  throw new Error(`Timed out waiting for ${until}`);
}

function printStatus(agg: RunAggregate) {
  const health = new Map(agg.healthChecks.map((h) => [h.provider, h] as const));
  const latest = new Map(agg.deployments.filter((d) => d.status === 'succeeded').map((d) => [d.provider, d] as const));
  for (const d of latest.values()) {
    const h = health.get(d.provider);
    console.log(`  ${d.provider.padEnd(9)} ${d.endpoint}  rev=${d.revision}  health=${h ? `${h.statusCode} in ${h.latencyMs}ms` : 'n/a'}`);
  }
  console.log(`  run state: ${agg.run.state}`);
}

async function main() {
  if (!TOKEN) throw new Error('APPROVAL_TOKEN is missing from the root .env');

  step(`Create run → ${targets.join(' + ')}`);
  const run = await call<{ id: string }>('POST', '/api/runs', {
    projectName: 'nimbus-books',
    repoPath: 'apps/demo-service',
    objective: `E2E: deploy to ${targets.join(' + ')}`,
    targets,
  });
  console.log(`  run ${run.id}`);

  step('Record analysis (fixture — Bob does this in the real demo)');
  await call('POST', `/api/runs/${run.id}/analysis`, EXAMPLE_APP_PROFILE);

  step('Submit plan (fixture)');
  const { approval } = await call<{ approval: Approval }>('POST', `/api/runs/${run.id}/plan`, examplePlan(targets));

  step('Guard check: executing before approval must be refused');
  const blocked = await fetch(`${API}/api/runs/${run.id}/execute`, { method: 'POST' });
  if (blocked.status !== 403) throw new Error(`Expected 403, got ${blocked.status}`);
  console.log('  ✔ 403 approval_required');

  if (uiApproval) {
    step(`Waiting for YOU to approve the plan in the Control Center: ${UI}/run?id=${run.id}`);
    await waitFor(run.id, 'plan_decided', 900);
  } else {
    step('Human approves the plan');
    await call('POST', `/api/approvals/${approval.id}/decision`, { decision: 'approved', decidedBy: 'e2e-script' }, human);
  }

  step('Execute: TEST → PROVISION → BUILD → DEPLOY → VERIFY (IBM Cloud build takes 2–5 min)');
  await call('POST', `/api/runs/${run.id}/execute`, {});
  await waitFor(run.id, 'deployed', 1500);
  let agg = await call<RunAggregate>('GET', `/api/runs/${run.id}`);
  printStatus(agg);
  if (agg.run.state !== 'healthy') throw new Error(`Run ended in state ${agg.run.state} — inspect GET /api/runs/${run.id}`);

  if (withRecovery) {
    step(`Inject controlled fault on ${faultProvider} (removes CATALOG_MODE)`);
    await call('POST', '/api/demo/fault', { runId: run.id, provider: faultProvider }, human);

    step('Verify → expect an incident');
    await call('POST', `/api/runs/${run.id}/verify`, {});
    agg = await call<RunAggregate>('GET', `/api/runs/${run.id}`);
    const incident = agg.incidents.find((i) => i.status !== 'resolved');
    if (!incident) throw new Error(`Expected an incident; run state is ${agg.run.state}`);
    console.log(`  incident ${incident.id} (${incident.provider})`);

    step('Record diagnosis (fixture — Bob does this in the real demo)');
    await call('POST', `/api/incidents/${incident.id}/diagnosis`, {
      summary: 'Configuration drift',
      rootCause: 'CATALOG_MODE is missing from the running revision',
      confidence: 'high',
      evidence: ['probe body: checks.config.missing=[CATALOG_MODE]', 'approved plan env: CATALOG_MODE=featured'],
    });

    step('Propose remediation');
    const proposal = await call<{ approval: Approval }>('POST', `/api/incidents/${incident.id}/remediation`, {
      action: { type: 'set_env', key: 'CATALOG_MODE', value: 'featured' },
      rationale: 'Restore the approved configuration value',
      risk: 'low',
    });

    if (uiApproval) {
      step(`Waiting for YOU to approve the remediation in the Control Center: ${UI}/run?id=${run.id}`);
      await waitFor(run.id, 'remediation_decided', 900);
    } else {
      step('Human approves the remediation');
      await call('POST', `/api/approvals/${proposal.approval.id}/decision`, { decision: 'approved', decidedBy: 'e2e-script' }, human);
    }

    step('Execute remediation + re-verify');
    const result = await call<{ ok: boolean; incident: Incident }>('POST', `/api/incidents/${incident.id}/execute`, {});
    if (!result.ok) throw new Error('Remediation did not recover the service');
    agg = await call<RunAggregate>('GET', `/api/runs/${run.id}`);
    printStatus(agg);
    const resolved = agg.incidents.find((i) => i.id === incident.id);
    if (resolved?.resolvedAt) console.log(`  ✔ recovered in ${formatDuration(Date.parse(resolved.resolvedAt) - Date.parse(resolved.openedAt))}`);
  }

  step('Export evidence');
  console.log(await call('POST', `/api/runs/${run.id}/export`, {}));
  console.log(`\n✅ E2E PASSED — run ${run.id}`);
}

main().catch((err) => {
  console.error(`\n❌ E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
