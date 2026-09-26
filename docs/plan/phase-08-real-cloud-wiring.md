<!--
@file     docs/plan/phase-08-real-cloud-wiring.md
@purpose  Wire the real IBM Cloud + AWS adapters into the orchestrator and prove the full API-level loop on real clouds.
@owner    Orchestration & Cloud (O)
-->
# Phase 08 — Real-cloud wiring and API end-to-end ← FIRST MILESTONE (~60 min)

**Goal:** Put the real providers behind the orchestrator. Then prove, **without Bob or the UI**, that the whole loop works on
real clouds: plan → blocked-before-approval → approve → TEST → parallel deploy to IBM Cloud and AWS → verify → fault →
incident → diagnosis → remediation approval → recover → export evidence.

After this phase the product works. Everything later makes it Bob-driven, visible and judge-ready.

**Depends on:** Phases 05, 06 and 07.
**Interfaces produced:** `buildProviders(config)` (`apps/orchestrator/src/providers/registry.ts`), plus the scripts
`pnpm api:e2e [--targets ibm-cloud,aws] [--with-recovery] [--fault-provider ibm-cloud]` and
`pnpm demo:fault [--run <id>] [--provider ibm-cloud] [--key CATALOG_MODE]`.

---

### Task 8.1 — Provider registry

- [ ] **Step 1: Replace `apps/orchestrator/package.json`**

```json
{
  "name": "@bobops/orchestrator",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@bobops/core": "workspace:*",
    "@bobops/provider-aws": "workspace:*",
    "@bobops/provider-ibm-cloud": "workspace:*",
    "@hono/node-server": "^1.13.7",
    "dotenv": "^16.4.7",
    "execa": "^9.5.2",
    "hono": "^4.7.0",
    "zod": "^3.25.0"
  }
}
```

- [ ] **Step 2: Create `apps/orchestrator/src/providers/registry.ts`**

```ts
/**
 * @file      apps/orchestrator/src/providers/registry.ts
 * @phase     P8
 * @owner     Orchestration & Cloud
 * @purpose   Builds the real provider adapters from config. The ONLY place the orchestrator knows concrete clouds.
 * @depends   @bobops/provider-ibm-cloud, @bobops/provider-aws, ../config
 * @usedBy    deps.ts (default providers)
 * @agentNotes V2: add `['vercel', new VercelProvider(...)]` here (+ extend ProviderIdSchema) — the workflow code stays unchanged.
 */
import type { CloudProvider, ProviderId } from '@bobops/core';
import { AwsLambdaProvider } from '@bobops/provider-aws';
import { IbmCloudProvider } from '@bobops/provider-ibm-cloud';
import type { Config } from '../config';

export function buildProviders(config: Config): Map<ProviderId, CloudProvider> {
  return new Map<ProviderId, CloudProvider>([
    [
      'ibm-cloud',
      new IbmCloudProvider({
        apiKey: config.IBMCLOUD_API_KEY,
        region: config.IBMCLOUD_REGION,
        resourceGroup: config.IBMCLOUD_RESOURCE_GROUP,
        project: config.IBM_CE_PROJECT,
      }),
    ],
    ['aws', new AwsLambdaProvider({ region: config.AWS_REGION, roleArn: config.AWS_LAMBDA_ROLE_ARN })],
  ]);
}
```

- [ ] **Step 3: Replace `apps/orchestrator/src/deps.ts`** (the only change from Phase 5 is the default `providers`)

```ts
/**
 * @file      apps/orchestrator/src/deps.ts
 * @phase     P4 (replaced in P5, P8; replaced again in P12)
 * @owner     Orchestration & Cloud
 * @purpose   Composition root: builds every service once and wires them together. Tests pass overrides (fakes).
 * @depends   @bobops/core, ./config, ./store, ./events, ./services, ./ports, ./providers/registry
 * @usedBy    src/index.ts, src/app.ts, tests
 * @agentNotes Add new services HERE, never `new` them inside routes. Tests MUST pass `providers` fakes.
 */
import { probeHealth, type CloudProvider, type ProbeFn, type ProviderId } from '@bobops/core';
import type { Config } from './config';
import { EventBus } from './events/event-bus';
import type { GitHubPort } from './ports';
import { buildProviders } from './providers/registry';
import { LifecycleService } from './services/lifecycle-service';
import { RunService } from './services/run-service';
import { runPackageTests, type TestResult } from './services/test-runner';
import { JsonStore } from './store/json-store';

export interface Deps {
  config: Config;
  store: JsonStore;
  bus: EventBus;
  runs: RunService;
  lifecycle: LifecycleService;
  providers: Map<ProviderId, CloudProvider>;
}

export interface DepOverrides {
  providers?: Map<ProviderId, CloudProvider>;
  probe?: ProbeFn;
  runTests?: (sourceDir: string) => Promise<TestResult>;
  github?: GitHubPort | null;
  retryDelayMs?: number;
}

export function createDeps(config: Config, o: DepOverrides = {}): Deps {
  const store = new JsonStore(config.dataFile);
  const bus = new EventBus(store);
  const runs = new RunService(store, bus, config.repoRoot);
  const providers = o.providers ?? buildProviders(config);
  const lifecycle = new LifecycleService({
    store,
    bus,
    runs,
    providers,
    probe: o.probe ?? probeHealth,
    runTests: o.runTests ?? runPackageTests,
    repoRoot: config.repoRoot,
    resolveSecret: (name) => config.secrets[name],
    github: o.github ?? null,
    retryDelayMs: o.retryDelayMs ?? 5000,
    demoMode: config.demoMode,
  });
  return { config, store, bus, runs, lifecycle, providers };
}
```

- [ ] **Step 4:** `pnpm install; pnpm test; pnpm typecheck` → Expected: green (48 tests).

### Task 8.2 — Demo scripts

- [ ] **Step 1: Create `scripts/demo/api-e2e.ts`**

```ts
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
```

- [ ] **Step 2: Create `scripts/demo/inject-fault.ts`**

```ts
/**
 * @file      scripts/demo/inject-fault.ts
 * @phase     P8
 * @owner     Product & Experience
 * @purpose   Presenter tool: injects the controlled fault (removes CATALOG_MODE) on one provider of a healthy run.
 * @depends   ../lib/env, @bobops/core
 * @usedBy    `pnpm demo:fault [--run <id>] [--provider ibm-cloud|aws] [--key CATALOG_MODE]` (HUMAN)
 * @agentNotes Human-only (uses the approval token). The Control Center has the same control behind ?demo=1.
 */
import { arg, requireEnv } from '../lib/env';
import { ProviderIdSchema, type Run } from '@bobops/core';

const API = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000';

async function main() {
  const token = requireEnv('APPROVAL_TOKEN');
  let runId = arg('--run');
  if (!runId) {
    const runs = (await (await fetch(`${API}/api/runs`)).json()) as Run[];
    runId = runs.find((r) => r.state === 'healthy')?.id;
    if (!runId) throw new Error('No healthy run found. Pass --run <id>.');
  }
  const provider = ProviderIdSchema.parse(arg('--provider') ?? 'ibm-cloud');
  const key = arg('--key') ?? 'CATALOG_MODE';
  console.log(`Injecting fault: remove ${key} on ${provider} for run ${runId} …`);
  const res = await fetch(`${API}/api/demo/fault`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-approval-token': token },
    body: JSON.stringify({ runId, provider, key }),
  });
  console.log(res.status, await res.text());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 3: Replace `scripts/package.json`**

```json
{
  "name": "@bobops/scripts",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "demo:golden": "tsx demo/golden.ts",
    "demo:reset": "tsx demo/reset.ts",
    "demo:fault": "tsx demo/inject-fault.ts",
    "api:e2e": "tsx demo/api-e2e.ts",
    "smoke:ibm": "tsx smoke/deploy-ibm.ts",
    "smoke:aws": "tsx smoke/deploy-aws.ts"
  },
  "dependencies": {
    "@bobops/core": "workspace:*",
    "@bobops/provider-aws": "workspace:*",
    "@bobops/provider-ibm-cloud": "workspace:*",
    "dotenv": "^16.4.7"
  }
}
```

- [ ] **Step 4:** `pnpm install; pnpm typecheck`

### Task 8.3 — The milestone run (HUMAN, ~8–10 min)

- [ ] **Step 1:** `pnpm demo:golden` (the Dockerfile and lambda.ts must exist for this API-only test).
- [ ] **Step 2 (terminal 1):** `pnpm dev:api`
- [ ] **Step 3 (terminal 2):** `curl.exe -s http://localhost:4000/api/providers`
  Expected: two entries, both with `"authenticated":true`.
- [ ] **Step 4 (terminal 2):** `pnpm api:e2e --with-recovery`
  Expected output (abridged):
  ```text
  ▶ Guard check: executing before approval must be refused
    ✔ 403 approval_required
  ▶ Execute: TEST → PROVISION → BUILD → DEPLOY → VERIFY …
    … state=deploying   (repeats while Code Engine builds)
    … state=healthy
    ibm-cloud https://bobops-nimbus-books.<hash>.us-south.codeengine.appdomain.cloud  rev=bobops-nimbus-books-000NN  health=200 in 180ms
    aws       https://<id>.lambda-url.us-east-1.on.aws/  rev=N  health=200 in 90ms
  ▶ Inject controlled fault on ibm-cloud …
  ▶ Verify → expect an incident
    incident inc_… (ibm-cloud)
  …
  ▶ Execute remediation + re-verify
    ✔ recovered in 1m 2Xs
  ✅ E2E PASSED — run run_…
  ```
- [ ] **Step 5:** Open `evidence/demo-runs/<runId>.md`. Expected: a Markdown audit trail with deployments, an incident and a
  timeline, including a `guard.blocked` row.
- [ ] **Step 6:** Stop the orchestrator (Ctrl+C), then run `pnpm demo:reset`.

### Task 8.4 — RETROFIT (post-phase-9): smoke test the other architecture on each cloud

> Depends on Task 2.13 (core), 6.6 (IBM), 7.6 (AWS). `scripts/smoke/deploy-ibm.ts` and `scripts/smoke/deploy-aws.ts` now
> read `--scale-to-zero` / `--provisioned` flags so a human can prove BOTH real architectures work against real clouds,
> not just the defaults `examplePlan()` happens to use.

- [ ] **Step 1: In `scripts/smoke/deploy-ibm.ts`**, import `type ServiceId` from `@bobops/core`; add
  `const service: ServiceId = process.argv.includes('--scale-to-zero') ? 'code-engine-scale-to-zero' : 'code-engine';`
  near the top; use `service` (not the literal `'code-engine'`) in the deploy `target`; add
  `architectureRationale: 'Smoke test target, chosen via --scale-to-zero flag or default (always-on).'`; and pass
  `service` to the final `provider.logs({ provider: 'ibm-cloud', service, appName: ..., region }, 10)` call (it now
  requires `service`).

- [ ] **Step 2: In `scripts/smoke/deploy-aws.ts`**, the same pattern with
  `const service: ServiceId = process.argv.includes('--provisioned') ? 'lambda-provisioned' : 'lambda';` and
  `architectureRationale: 'Smoke test target, chosen via --provisioned flag or default (on-demand).'`.

- [ ] **Step 3 (HUMAN, optional but recommended before the real demo):**
  ```powershell
  pnpm demo:golden
  pnpm --filter @bobops/scripts run smoke:ibm -- --scale-to-zero
  pnpm --filter @bobops/scripts run smoke:aws -- --provisioned
  pnpm demo:reset
  ```
  Expected: both deploy successfully; the AWS one additionally logs
  `Configuring provisioned concurrency (1) on bobops-nimbus-books:N ...` and the health probe still returns 200 once
  provisioned concurrency reports `READY` (can take up to ~1–2 min).

## HANDOFF

```text
✅ PHASE 08 COMPLETE — Real clouds wired; API-level E2E passes  ◄ MILESTONE
BUILT:
  - providers/registry.ts (IBM Cloud Code Engine + AWS Lambda behind the orchestrator)
  - scripts: api:e2e (full loop on real clouds), demo:fault (presenter control)
DO THIS (human):
  1. pnpm demo:golden
  2. terminal 1: pnpm dev:api
  3. terminal 2: curl.exe -s http://localhost:4000/api/providers ; pnpm api:e2e --with-recovery
  4. open evidence/demo-runs/<runId>.md ; stop the API ; pnpm demo:reset
EXPECT:
  - both providers authenticated:true
  - "✔ 403 approval_required", both clouds health=200, incident opened, "✔ recovered in …", "✅ E2E PASSED"
IF IT FAILS:
  - Run state "failed" → GET http://localhost:4000/api/runs/<id> and read the last deploy.failed / verify.failed event message
  - IBM auth error → IBMCLOUD_API_KEY / IBMCLOUD_RESOURCE_GROUP in .env
  - AWS 403 on Function URL → Phase 07 troubleshooting
EVIDENCE:
  - Screenshot Bob's task summary → evidence/bob-task-summaries/phase-08-real-cloud-e2e.png
  - Screenshot the terminal showing "✅ E2E PASSED" → evidence/demo-runs/api-e2e-passed.png
  - git add -A; git commit -m "feat(p08): real-cloud wiring + API e2e"; git push
```
