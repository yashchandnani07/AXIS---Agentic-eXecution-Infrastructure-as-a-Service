<!--
@file     docs/plan/phase-05-orchestrator-lifecycle.md
@purpose  Orchestrator part 2: TEST→PROVISION→BUILD→DEPLOY→VERIFY execution, incidents, diagnosis, hash-bound
          remediation approvals, fault injection, long-poll waits, evidence export — fully tested with fake clouds.
@owner    Orchestration & Cloud (O)
-->
# Phase 05 — Orchestrator: lifecycle engine (~90 min)

**Goal:** Implement the full lifecycle behind the approval guard and prove it end to end with **fake providers**, with no
cloud involved. Phase 08 swaps in the real adapters without changing this code.

**Depends on:** Phase 04.
**Interfaces produced:**
- `GitHubPort` (`src/ports.ts`): `publishSentinelTargets`, `listOpenSentinelIncidents`, `commentAndCloseIncident`
- `TestResult`, `runPackageTests(sourceDir)` (`src/services/test-runner.ts`)
- `LifecycleService` (`src/services/lifecycle-service.ts`): `startExecution`, `waitForJob`, `verifyRun`,
  `requestVerification`, `openIncident`, `recordDiagnosis`, `proposeRemediation`, `executeRemediation`,
  `syncIncidents`, `injectFault`, `logs`, `waitFor`, `exportEvidence`, `latestDeployments`
- `FakeProvider`, `fakeProbe` (`src/testing/fake-provider.ts`)
- `Deps` gains `lifecycle`. `DepOverrides` gains `probe`, `runTests`, `github`, `retryDelayMs`.

---

### Task 5.1 — Dependencies and ports

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
    "@hono/node-server": "^1.13.7",
    "dotenv": "^16.4.7",
    "execa": "^9.5.2",
    "hono": "^4.7.0",
    "zod": "^3.25.0"
  }
}
```

- [ ] **Step 2:** `pnpm install`

- [ ] **Step 3: Create `apps/orchestrator/src/ports.ts`**

```ts
/**
 * @file      apps/orchestrator/src/ports.ts
 * @phase     P5
 * @owner     Orchestration & Cloud
 * @purpose   Interfaces for outbound integrations the lifecycle depends on (so tests can pass null / fakes).
 * @depends   @bobops/core (types)
 * @usedBy    LifecycleService, deps.ts; implemented by packages/github GitHubClient (Phase 12)
 * @agentNotes Keep ports minimal — add a method only when the lifecycle actually calls it.
 */
import type { SentinelIncidentPayload, SentinelTarget } from '@bobops/core';

export interface GitHubPort {
  /** Writes the endpoints the scheduled sentinel must probe (GitHub repo variable SENTINEL_TARGETS). */
  publishSentinelTargets(targets: SentinelTarget[]): Promise<void>;
  /** Open issues labelled sentinel-incident whose body carries a valid incident payload. */
  listOpenSentinelIncidents(): Promise<Array<{ issueNumber: number; url: string; payload: SentinelIncidentPayload }>>;
  /** Posts the recovery evidence and closes the issue. */
  commentAndCloseIncident(issueNumber: number, body: string): Promise<void>;
}
```

- [ ] **Step 4: Create `apps/orchestrator/src/services/test-runner.ts`**

```ts
/**
 * @file      apps/orchestrator/src/services/test-runner.ts
 * @phase     P5
 * @owner     Orchestration & Cloud
 * @purpose   TEST stage: runs the target application's Vitest suite before anything is deployed.
 * @depends   execa
 * @usedBy    deps.ts (default runTests), LifecycleService.executePlan
 * @agentNotes Runs `pnpm exec vitest run` inside the app folder. Output is trimmed to the last 20 lines for evidence.
 */
import { execa } from 'execa';

export interface TestResult {
  ok: boolean;
  output: string;
}

export async function runPackageTests(sourceDir: string): Promise<TestResult> {
  const result = await execa('pnpm', ['exec', 'vitest', 'run'], {
    cwd: sourceDir,
    reject: false,
    all: true,
    timeout: 180_000,
    env: { CI: 'true', FORCE_COLOR: '0' },
  });
  const tail = String(result.all ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-20)
    .join('\n');
  const shortMessage = (result as { shortMessage?: string }).shortMessage ?? '';
  return { ok: result.exitCode === 0, output: tail || shortMessage };
}
```

### Task 5.2 — Fake provider (test double)

- [ ] **Step 1: Create `apps/orchestrator/src/testing/fake-provider.ts`**

```ts
/**
 * @file      apps/orchestrator/src/testing/fake-provider.ts
 * @phase     P5
 * @owner     Orchestration & Cloud
 * @purpose   In-memory CloudProvider + matching probe so the whole lifecycle is testable without clouds or network.
 * @depends   @bobops/core (types)
 * @usedBy    lifecycle.test.ts
 * @agentNotes Health rule mirrors the real demo app: healthy iff CATALOG_MODE is set in the app's env.
 */
import type {
  CloudProvider,
  DeployInput,
  DeployResult,
  DeploymentRef,
  EnvChange,
  ProbeFn,
  ProgressFn,
  ProviderCapabilities,
  ProviderId,
  ProviderStatus,
  Resource,
  TargetPlan,
} from '@bobops/core';

export class FakeProvider implements CloudProvider {
  private readonly envByApp = new Map<string, Record<string, string>>();
  private revisionCounter = 0;
  deployCalls = 0;
  failNextDeploy = false;

  constructor(readonly id: ProviderId) {}

  endpointFor(appName: string): string {
    return `https://${appName}.${this.id}.fake`;
  }

  private bump(appName: string): DeployResult {
    this.revisionCounter++;
    return { endpoint: this.endpointFor(appName), revision: `r${this.revisionCounter}`, evidence: [] };
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      provider: this.id,
      displayName: `Fake ${this.id}`,
      authenticated: true,
      region: 'fake-1',
      services: ['fake'],
      supportsRollback: true,
      notes: ['in-memory test double'],
    };
  }

  planResources(target: TargetPlan): Resource[] {
    return [{ type: 'fake-app', name: target.appName, action: 'create' }];
  }

  async deploy(input: DeployInput, progress: ProgressFn): Promise<DeployResult> {
    this.deployCalls++;
    if (this.failNextDeploy) {
      this.failNextDeploy = false;
      throw new Error('fake deploy failure');
    }
    progress({ type: 'provision.completed', message: 'fake provision' });
    progress({ type: 'build.completed', message: 'fake build' });
    this.envByApp.set(input.target.appName, { ...input.target.env, ...input.secrets });
    return this.bump(input.target.appName);
  }

  async status(ref: DeploymentRef): Promise<ProviderStatus> {
    return {
      state: 'ready',
      revision: `r${this.revisionCounter}`,
      endpoint: this.endpointFor(ref.appName),
      env: this.envByApp.get(ref.appName) ?? {},
      raw: {},
    };
  }

  async logs(): Promise<string[]> {
    return ['[fake] GET /health 200'];
  }

  async setEnv(ref: DeploymentRef, change: EnvChange, _progress: ProgressFn): Promise<DeployResult> {
    const env = { ...(this.envByApp.get(ref.appName) ?? {}), ...(change.set ?? {}) };
    for (const key of change.remove ?? []) delete env[key];
    this.envByApp.set(ref.appName, env);
    return this.bump(ref.appName);
  }

  async rollback(ref: DeploymentRef): Promise<DeployResult> {
    return this.bump(ref.appName);
  }

  isHealthy(endpoint: string): boolean {
    for (const [app, env] of this.envByApp) {
      if (endpoint.startsWith(this.endpointFor(app))) return Boolean(env.CATALOG_MODE);
    }
    return false;
  }
}

export function fakeProbe(providers: FakeProvider[]): ProbeFn {
  return async (opts) => {
    const ok = providers.find((p) => p.id === opts.provider)?.isHealthy(opts.endpoint) ?? false;
    return {
      id: crypto.randomUUID(),
      provider: opts.provider,
      endpoint: new URL(opts.healthPath, opts.endpoint).toString(),
      ok,
      statusCode: ok ? 200 : 503,
      latencyMs: 5,
      body: ok ? { status: 'healthy' } : { status: 'unhealthy', checks: { config: { ok: false, missing: ['CATALOG_MODE'] } } },
      checkedAt: new Date().toISOString(),
    };
  };
}
```

### Task 5.3 — The lifecycle service

- [ ] **Step 1: Create `apps/orchestrator/src/services/lifecycle-service.ts`**

```ts
/**
 * @file      apps/orchestrator/src/services/lifecycle-service.ts
 * @phase     P5
 * @owner     Orchestration & Cloud
 * @purpose   The workflow executor for TEST → PROVISION → BUILD → DEPLOY → VERIFY → RECOVER. Enforces the approval guard
 *            (hash-matched human approvals), records evidence for every step, and coordinates providers + GitHub.
 * @depends   @bobops/core, ../store, ../events, ../lib/*, ./run-service, ./test-runner (type), ../ports (type)
 * @usedBy    routes/runs.ts, routes/incidents.ts, routes/demo.ts, src/index.ts (periodic incident sync)
 * @agentNotes
 *   - NEVER call a provider's deploy/setEnv/rollback without passing through requireApprovedPlan / the remediation
 *     approval check in executeRemediation (fault injection is the one human-only exception, gated by DEMO_MODE + token).
 *   - Every step emits an event with the correct actor + kind; evidence must be redacted (redactEnv) before storing.
 *   - State changes only via this.d.runs.transition().
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  canTransition,
  describeAction,
  evidence,
  formatDuration,
  isSecretKey,
  newId,
  nowIso,
  providerActor,
  redactEnv,
  renderAuditMarkdown,
  type Actor,
  type Approval,
  type CloudProvider,
  type DeployResult,
  type Deployment,
  type DeploymentRef,
  type Diagnosis,
  type EventKind,
  type EventType,
  type Evidence,
  type HealthCheck,
  type Incident,
  type ProbeFn,
  type ProgressFn,
  type ProviderCapabilities,
  type ProviderId,
  type RemediationAction,
  type Run,
  type Severity,
  type TargetPlan,
  type WaitCondition,
} from '@bobops/core';
import type { EventBus } from '../events/event-bus';
import { ApprovalRequiredError, BadRequestError, ConflictError, HttpError } from '../lib/errors';
import { sha256 } from '../lib/hash';
import type { GitHubPort } from '../ports';
import type { JsonStore } from '../store/json-store';
import type { RunService } from './run-service';
import type { TestResult } from './test-runner';

export interface LifecycleDeps {
  store: JsonStore;
  bus: EventBus;
  runs: RunService;
  providers: Map<ProviderId, CloudProvider>;
  probe: ProbeFn;
  runTests: (sourceDir: string) => Promise<TestResult>;
  repoRoot: string;
  resolveSecret: (name: string) => string | undefined;
  github: GitHubPort | null;
  retryDelayMs: number;
  demoMode: boolean;
}

export interface VerifyResult {
  ok: boolean;
  checks: HealthCheck[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class LifecycleService {
  private readonly jobs = new Map<string, Promise<void>>();

  constructor(private readonly d: LifecycleDeps) {}

  // ───────────────────────── helpers ─────────────────────────

  private emit(runId: string, actor: Actor, kind: EventKind, type: EventType, message: string, ev: Evidence[] = []) {
    return this.d.bus.emit({ runId, actor, kind, type, message, evidence: ev });
  }

  private provider(id: ProviderId): CloudProvider {
    const p = this.d.providers.get(id);
    if (!p) throw new BadRequestError(`Cloud provider ${id} is not configured in the orchestrator`);
    return p;
  }

  private progressFor(runId: string, provider: ProviderId): ProgressFn {
    return (e) => {
      this.emit(runId, providerActor(provider), e.kind ?? 'action', e.type, e.message, e.evidence ?? []);
    };
  }

  private refFor(dep: Deployment): DeploymentRef {
    return { provider: dep.provider, appName: dep.appName, region: dep.region, endpoint: dep.endpoint, revision: dep.revision };
  }

  /** Latest SUCCESSFUL deployment per provider for a run. */
  latestDeployments(runId: string): Deployment[] {
    const latest = new Map<ProviderId, Deployment>();
    for (const dep of this.d.store.data.deployments) {
      if (dep.runId === runId && dep.status === 'succeeded') latest.set(dep.provider, dep);
    }
    return [...latest.values()];
  }

  private latestDeployment(runId: string, provider: ProviderId): Deployment {
    const dep = this.latestDeployments(runId).find((d) => d.provider === provider);
    if (!dep) throw new ConflictError(`No successful ${provider} deployment exists for run ${runId}`);
    return dep;
  }

  private recordDeployment(base: Deployment, result: DeployResult, note: string): Deployment {
    const dep: Deployment = {
      ...base,
      id: newId('dep'),
      status: 'succeeded',
      endpoint: result.endpoint || base.endpoint,
      revision: result.revision,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      error: undefined,
      note,
    };
    this.d.store.upsert('deployments', dep);
    return dep;
  }

  // ───────────────────────── PROVISION / BUILD / TEST / DEPLOY ─────────────────────────

  private requireApprovedPlan(run: Run): void {
    const approved = this.d.store.data.approvals.some(
      (a) => a.runId === run.id && a.kind === 'deploy_plan' && a.status === 'approved' && a.subjectHash === run.planHash,
    );
    if (!approved || !run.plan || !['approved', 'failed'].includes(run.state)) {
      this.emit(
        run.id,
        'orchestrator',
        'verification',
        'guard.blocked',
        `Blocked deployment: no human-approved plan matches the current plan hash (run state: ${run.state})`,
      );
      throw new ApprovalRequiredError(
        'Deployment requires a human-approved plan. Ask the developer to approve it in the Control Center, then call devops_wait with until=plan_decided.',
      );
    }
  }

  startExecution(runId: string): { started: true; runId: string } {
    const run = this.d.store.getRun(runId);
    this.requireApprovedPlan(run);
    if (this.jobs.has(runId)) throw new ConflictError('A deployment job is already running for this run');
    const job = this.executePlan(runId)
      .catch((err) => {
        this.emit(runId, 'orchestrator', 'verification', 'deploy.failed', `Execution crashed: ${errMsg(err)}`);
        const current = this.d.store.getRun(runId);
        if (canTransition(current.state, 'failed')) this.d.runs.transition(current, 'failed');
      })
      .finally(() => this.jobs.delete(runId));
    this.jobs.set(runId, job);
    return { started: true, runId };
  }

  /** Resolves when the background job for this run (if any) finishes. Used by tests and waitFor. */
  waitForJob(runId: string): Promise<void> {
    return this.jobs.get(runId) ?? Promise.resolve();
  }

  private async executePlan(runId: string): Promise<void> {
    let run = this.d.store.getRun(runId);
    run = this.d.runs.transition(run, 'deploying');
    const plan = run.plan!;
    const sourceDir = path.resolve(this.d.repoRoot, run.repoPath);

    // TEST — nothing reaches a cloud unless the app's own test suite passes.
    this.emit(runId, 'orchestrator', 'action', 'test.started', `Running the pre-deploy test suite in ${run.repoPath}`);
    const tests = await this.d.runTests(sourceDir);
    if (!tests.ok) {
      this.emit(runId, 'orchestrator', 'verification', 'test.failed', 'Pre-deploy tests failed — nothing was deployed', [
        evidence('Test output (tail)', 'vitest', tests.output),
      ]);
      this.d.runs.transition(this.d.store.getRun(runId), 'failed');
      return;
    }
    this.emit(runId, 'orchestrator', 'verification', 'test.passed', 'Pre-deploy tests passed', [
      evidence('Test output (tail)', 'vitest', tests.output),
    ]);

    // PROVISION + BUILD + DEPLOY — all targets in parallel.
    const results = await Promise.allSettled(plan.targets.map((t) => this.deployTarget(runId, sourceDir, t)));
    if (!results.some((r) => r.status === 'fulfilled')) {
      this.d.runs.transition(this.d.store.getRun(runId), 'failed');
      return;
    }

    // VERIFY
    this.d.runs.transition(this.d.store.getRun(runId), 'verifying');
    const { ok } = await this.verifyRun(runId, 3);
    const allDeployed = results.every((r) => r.status === 'fulfilled');
    if (ok && allDeployed) {
      this.d.runs.transition(this.d.store.getRun(runId), 'healthy');
      await this.armSentinel(runId);
    } else {
      this.d.runs.transition(this.d.store.getRun(runId), 'failed');
    }
  }

  private async deployTarget(runId: string, sourceDir: string, target: TargetPlan): Promise<Deployment> {
    const provider = this.provider(target.provider);
    const progress = this.progressFor(runId, target.provider);
    const dep: Deployment = {
      id: newId('dep'),
      runId,
      provider: target.provider,
      appName: target.appName,
      region: target.region,
      healthPath: target.healthPath,
      status: 'in_progress',
      startedAt: nowIso(),
    };
    this.d.store.upsert('deployments', dep);

    const secrets: Record<string, string> = {};
    for (const name of target.secretRefs) {
      const value = this.d.resolveSecret(name);
      if (value) secrets[name] = value;
      else this.emit(runId, 'orchestrator', 'observation', 'orchestrator.warning', `Secret ${name} has no value (set SECRET_${name} in .env); deploying without it`);
    }

    progress({ type: 'deploy.started', message: `Deploying ${target.appName} to ${target.provider} (${target.service}, ${target.region})` });
    try {
      const result = await provider.deploy({ runId, target, sourceDir, secrets }, progress);
      const done: Deployment = { ...dep, status: 'succeeded', endpoint: result.endpoint, revision: result.revision, finishedAt: nowIso() };
      this.d.store.upsert('deployments', done);
      progress({
        type: 'deploy.completed',
        message: `${target.provider} is serving ${target.appName} at ${result.endpoint} (revision ${result.revision})`,
        evidence: result.evidence,
      });
      return done;
    } catch (err) {
      this.d.store.upsert('deployments', { ...dep, status: 'failed', error: errMsg(err), finishedAt: nowIso() });
      progress({ type: 'deploy.failed', kind: 'verification', message: `${target.provider} deployment failed: ${errMsg(err)}` });
      throw err;
    }
  }

  // ───────────────────────── VERIFY ─────────────────────────

  /** Probes every live deployment of the run (HTTP) + collects provider-native status. No state changes. */
  async verifyRun(runId: string, attempts = 1): Promise<VerifyResult> {
    const checks: HealthCheck[] = [];
    for (const dep of this.latestDeployments(runId)) {
      const probeOnce = () =>
        this.d.probe({ provider: dep.provider, endpoint: dep.endpoint ?? '', healthPath: dep.healthPath, timeoutMs: 10_000 });
      let check = await probeOnce();
      for (let i = 1; !check.ok && i < attempts; i++) {
        await sleep(this.d.retryDelayMs);
        check = await probeOnce();
      }
      const stored: HealthCheck = { ...check, runId };
      this.d.store.upsert('healthChecks', stored);
      checks.push(stored);

      let providerStatus: unknown;
      try {
        const s = await this.provider(dep.provider).status(this.refFor(dep));
        providerStatus = { ...s, env: redactEnv(s.env) };
      } catch (err) {
        providerStatus = { error: errMsg(err) };
      }
      this.emit(
        runId,
        'orchestrator',
        'verification',
        check.ok ? 'verify.passed' : 'verify.failed',
        check.ok
          ? `${dep.provider} healthy — HTTP ${check.statusCode} in ${check.latencyMs} ms (revision ${check.revision ?? dep.revision ?? 'n/a'})`
          : `${dep.provider} UNHEALTHY — ${check.statusCode ? `HTTP ${check.statusCode}` : (check.error ?? 'no response')} at ${check.endpoint}`,
        [evidence('HTTP health probe', check.endpoint, check), evidence('Provider-native status', `${dep.provider} API`, providerStatus)],
      );
    }
    return { ok: checks.length > 0 && checks.every((c) => c.ok), checks };
  }

  /** Manual/Bob-triggered verification. A failure on a HEALTHY run opens incident(s). */
  async requestVerification(runId: string): Promise<VerifyResult> {
    const run = this.d.store.getRun(runId);
    if (run.state !== 'healthy' && run.state !== 'failed') return this.verifyRun(runId, 1); // evidence only
    const wasHealthy = run.state === 'healthy';
    this.d.runs.transition(run, 'verifying');
    const result = await this.verifyRun(runId, wasHealthy ? 2 : 1);
    if (result.ok) {
      this.d.runs.transition(this.d.store.getRun(runId), 'healthy');
      if (!wasHealthy) await this.armSentinel(runId);
    } else if (wasHealthy) {
      for (const failing of result.checks.filter((c) => !c.ok)) {
        this.openIncident({ runId, provider: failing.provider, source: 'orchestrator', probes: [failing] });
      }
    } else {
      this.d.runs.transition(this.d.store.getRun(runId), 'failed');
    }
    return result;
  }

  private async armSentinel(runId: string): Promise<void> {
    if (!this.d.github) return;
    const targets = this.latestDeployments(runId).map((d) => ({
      runId,
      provider: d.provider,
      appName: d.appName,
      endpoint: d.endpoint ?? '',
      healthPath: d.healthPath,
    }));
    try {
      await this.d.github.publishSentinelTargets(targets);
      this.emit(runId, 'orchestrator', 'action', 'sentinel.armed', `GitHub health sentinel armed for ${targets.length} endpoint(s)`, [
        evidence('Sentinel targets (repo variable SENTINEL_TARGETS)', 'GitHub Actions', targets),
      ]);
    } catch (err) {
      this.emit(runId, 'orchestrator', 'observation', 'orchestrator.warning', `Could not arm the GitHub sentinel: ${errMsg(err)}`);
    }
  }

  // ───────────────────────── RECOVER ─────────────────────────

  openIncident(input: {
    runId: string;
    provider: ProviderId;
    source: 'sentinel' | 'orchestrator';
    probes: HealthCheck[];
    githubIssueNumber?: number;
    githubIssueUrl?: string;
  }): Incident {
    const existing = this.d.store.data.incidents.find(
      (i) => i.runId === input.runId && i.provider === input.provider && i.status !== 'resolved',
    );
    if (existing) {
      const merged: Incident = {
        ...existing,
        probes: [...existing.probes, ...input.probes].slice(-20),
        githubIssueNumber: existing.githubIssueNumber ?? input.githubIssueNumber,
        githubIssueUrl: existing.githubIssueUrl ?? input.githubIssueUrl,
      };
      this.d.store.upsert('incidents', merged);
      return merged;
    }
    const incident: Incident = {
      id: newId('inc'),
      runId: input.runId,
      provider: input.provider,
      source: input.source,
      status: 'open',
      title: `${input.provider} health checks failing`,
      openedAt: nowIso(),
      probes: input.probes,
      githubIssueNumber: input.githubIssueNumber,
      githubIssueUrl: input.githubIssueUrl,
    };
    this.d.store.upsert('incidents', incident);
    const run = this.d.store.getRun(input.runId);
    if (canTransition(run.state, 'incident') && ['healthy', 'verifying', 'failed'].includes(run.state)) {
      this.d.runs.transition(run, 'incident');
    }
    const failed = input.probes.filter((p) => !p.ok).length;
    this.emit(
      input.runId,
      input.source === 'sentinel' ? 'sentinel' : 'orchestrator',
      'observation',
      'incident.opened',
      `Incident ${incident.id} opened by the ${input.source}: ${input.provider} failed ${failed}/${input.probes.length} probes${input.githubIssueUrl ? ` (GitHub issue #${input.githubIssueNumber})` : ''}`,
      [evidence('Failing probes', input.source, input.probes)],
    );
    return incident;
  }

  recordDiagnosis(incidentId: string, diagnosis: Diagnosis): Incident {
    const inc = this.d.store.getIncident(incidentId);
    if (inc.status === 'resolved' || inc.status === 'remediating') throw new ConflictError(`Incident ${incidentId} is ${inc.status}`);
    const next: Incident = { ...inc, diagnosis, status: inc.status === 'remediation_proposed' ? inc.status : 'diagnosed' };
    this.d.store.upsert('incidents', next);
    this.emit(inc.runId, 'bob', 'inference', 'incident.diagnosed', `Diagnosis (${diagnosis.confidence} confidence): ${diagnosis.rootCause}`, [
      evidence('Diagnosis', 'bob:incident-investigator', diagnosis),
    ]);
    return next;
  }

  proposeRemediation(
    incidentId: string,
    input: { action: RemediationAction; rationale: string; risk: Severity },
  ): { incident: Incident; approval: Approval } {
    const inc = this.d.store.getIncident(incidentId);
    if (!inc.diagnosis) throw new ConflictError('Record a diagnosis (devops_record_diagnosis) before proposing a remediation');
    if (inc.status === 'resolved' || inc.status === 'remediating') throw new ConflictError(`Incident ${incidentId} is ${inc.status}`);
    if (input.action.type === 'set_env' && isSecretKey(input.action.key)) {
      throw new BadRequestError(`${input.action.key} looks like a secret. Secrets are never set through remediation; rotate them in the provider secret store.`);
    }
    const now = nowIso();
    for (const a of this.d.store.data.approvals) {
      if (a.kind === 'remediation' && a.status === 'pending' && a.subjectId === inc.remediation?.id) {
        this.d.store.upsert('approvals', { ...a, status: 'rejected', decidedAt: now, decidedBy: 'orchestrator', comment: 'Superseded by a newer remediation proposal' });
      }
    }
    const remediationId = newId('rem');
    const approval: Approval = {
      id: newId('apr'),
      runId: inc.runId,
      kind: 'remediation',
      subjectId: remediationId,
      subjectHash: sha256({ incidentId, action: input.action }),
      summary: `${describeAction(input.action)} on ${inc.provider} — ${input.rationale}`,
      risk: input.risk,
      status: 'pending',
      requestedAt: now,
    };
    const incident: Incident = {
      ...inc,
      status: 'remediation_proposed',
      remediation: { id: remediationId, action: input.action, rationale: input.rationale, risk: input.risk, status: 'proposed', approvalId: approval.id },
    };
    this.d.store.upsert('approvals', approval);
    this.d.store.upsert('incidents', incident);
    const run = this.d.store.getRun(inc.runId);
    if (['incident', 'failed', 'awaiting_remediation_approval'].includes(run.state)) this.d.runs.transition(run, 'awaiting_remediation_approval');
    this.emit(inc.runId, 'bob', 'proposal', 'remediation.proposed', `Bob proposes: ${describeAction(input.action)} (risk ${input.risk}) — ${input.rationale}`);
    this.emit(inc.runId, 'orchestrator', 'proposal', 'approval.requested', `Human approval required for the remediation (hash ${approval.subjectHash.slice(0, 12)}…)`);
    return { incident, approval };
  }

  async executeRemediation(incidentId: string): Promise<{ ok: boolean; incident: Incident; checks: HealthCheck[]; error?: string }> {
    const inc = this.d.store.getIncident(incidentId);
    const run = this.d.store.getRun(inc.runId);
    const rem = inc.remediation;
    const approval = rem?.approvalId ? this.d.store.data.approvals.find((a) => a.id === rem.approvalId) : undefined;
    const approved =
      !!rem &&
      !!approval &&
      approval.status === 'approved' &&
      approval.subjectHash === sha256({ incidentId, action: rem.action }) &&
      run.state === 'awaiting_remediation_approval';
    if (!approved || !rem) {
      this.emit(run.id, 'orchestrator', 'verification', 'guard.blocked', `Blocked remediation for ${incidentId}: no matching human approval`);
      throw new ApprovalRequiredError('Remediation requires human approval in the Control Center. Call devops_wait with until=remediation_decided.');
    }

    const dep = this.latestDeployment(run.id, inc.provider);
    this.d.runs.transition(run, 'remediating');
    this.d.store.upsert('incidents', { ...inc, status: 'remediating', remediation: { ...rem, status: 'executing' } });
    this.emit(run.id, 'orchestrator', 'action', 'remediation.started', `Executing approved remediation: ${describeAction(rem.action)} on ${inc.provider}/${dep.appName}`);

    try {
      const provider = this.provider(inc.provider);
      const progress = this.progressFor(run.id, inc.provider);
      const result =
        rem.action.type === 'set_env'
          ? await provider.setEnv(this.refFor(dep), { set: { [rem.action.key]: rem.action.value } }, progress)
          : await provider.rollback(this.refFor(dep), progress, rem.action.toRevision);
      this.recordDeployment(dep, result, `remediation ${rem.id}`);
      this.emit(run.id, providerActor(inc.provider), 'action', 'remediation.completed', `${inc.provider} change applied — new revision ${result.revision}`, result.evidence);
    } catch (err) {
      this.failRemediation(incidentId, `Remediation failed: ${errMsg(err)}`);
      return { ok: false, incident: this.d.store.getIncident(incidentId), checks: [], error: errMsg(err) };
    }

    this.d.runs.transition(this.d.store.getRun(run.id), 'verifying');
    const verification = await this.verifyRun(run.id, 6);
    if (!verification.ok) {
      this.failRemediation(incidentId, 'Re-verification failed after the remediation');
      return { ok: false, incident: this.d.store.getIncident(incidentId), checks: verification.checks };
    }

    const current = this.d.store.getIncident(incidentId);
    const resolvedAt = nowIso();
    const resolved: Incident = { ...current, status: 'resolved', resolvedAt, remediation: { ...current.remediation!, status: 'succeeded' } };
    this.d.store.upsert('incidents', resolved);
    this.d.runs.transition(this.d.store.getRun(run.id), 'healthy');
    const mttr = formatDuration(Date.parse(resolvedAt) - Date.parse(inc.openedAt));
    this.emit(
      run.id,
      'orchestrator',
      'verification',
      'incident.resolved',
      `Recovered and re-verified: every endpoint is healthy. Time to recovery ${mttr}`,
      verification.checks.map((c) => evidence(`Post-remediation probe (${c.provider})`, c.endpoint, c)),
    );
    if (this.d.github && inc.githubIssueNumber) {
      try {
        await this.d.github.commentAndCloseIncident(inc.githubIssueNumber, this.recoveryComment(resolved, verification.checks, mttr));
      } catch (err) {
        this.emit(run.id, 'orchestrator', 'observation', 'orchestrator.warning', `Could not close GitHub issue #${inc.githubIssueNumber}: ${errMsg(err)}`);
      }
    }
    return { ok: true, incident: resolved, checks: verification.checks };
  }

  private failRemediation(incidentId: string, message: string): void {
    const inc = this.d.store.getIncident(incidentId);
    this.d.store.upsert('incidents', { ...inc, status: 'open', remediation: inc.remediation ? { ...inc.remediation, status: 'failed' } : undefined });
    const run = this.d.store.getRun(inc.runId);
    if (canTransition(run.state, 'failed')) this.d.runs.transition(run, 'failed');
    this.emit(inc.runId, 'orchestrator', 'verification', 'remediation.failed', message);
  }

  private recoveryComment(inc: Incident, checks: HealthCheck[], mttr: string): string {
    return [
      '## ✅ Recovered and re-verified by BobOps',
      '',
      `**Diagnosis (IBM Bob):** ${inc.diagnosis?.rootCause ?? 'n/a'}`,
      `**Remediation (human-approved):** ${inc.remediation ? describeAction(inc.remediation.action) : 'n/a'}`,
      `**Time to recovery:** ${mttr}`,
      '',
      '| Provider | HTTP | Latency | Revision |',
      '|---|---|---|---|',
      ...checks.map((c) => `| ${c.provider} | ${c.statusCode} | ${c.latencyMs} ms | ${c.revision ?? ''} |`),
    ].join('\n');
  }

  async syncIncidents(): Promise<{ imported: number; open: number; note?: string }> {
    if (!this.d.github) return { imported: 0, open: 0, note: 'GitHub is not configured (GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO)' };
    const open = await this.d.github.listOpenSentinelIncidents();
    let imported = 0;
    for (const item of open) {
      if (!this.d.store.data.runs.some((r) => r.id === item.payload.runId)) continue;
      if (this.d.store.data.incidents.some((i) => i.githubIssueNumber === item.issueNumber)) continue;
      this.openIncident({
        runId: item.payload.runId,
        provider: item.payload.provider,
        source: 'sentinel',
        probes: item.payload.probes,
        githubIssueNumber: item.issueNumber,
        githubIssueUrl: item.url,
      });
      imported++;
    }
    return { imported, open: open.length };
  }

  /** DEMO ONLY (DEMO_MODE=true + human token checked by the route): remove an env key to create a controlled fault. */
  async injectFault(runId: string, providerId: ProviderId, key: string) {
    if (!this.d.demoMode) throw new HttpError(403, 'demo_mode_off', 'Fault injection requires DEMO_MODE=true');
    const dep = this.latestDeployment(runId, providerId);
    const result = await this.provider(providerId).setEnv(this.refFor(dep), { remove: [key] }, this.progressFor(runId, providerId));
    this.recordDeployment(dep, result, `fault injection: removed ${key}`);
    this.emit(runId, 'human', 'action', 'fault.injected', `Controlled fault injected by the presenter: removed ${key} from ${providerId}/${dep.appName} (revision ${result.revision})`);
    return { injected: true, provider: providerId, key, revision: result.revision };
  }

  // ───────────────────────── OBSERVE ─────────────────────────

  async logs(runId: string, providerId: ProviderId, lines: number): Promise<string[]> {
    const dep = this.latestDeployment(runId, providerId);
    return this.provider(providerId).logs(this.refFor(dep), lines);
  }

  async waitFor(runId: string, until: WaitCondition, timeoutMs: number): Promise<{ reached: boolean; state: Run['state'] }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const run = this.d.store.getRun(runId);
      if (this.conditionMet(run, until)) return { reached: true, state: run.state };
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { reached: false, state: run.state };
      await sleep(Math.min(1000, remaining));
    }
  }

  private conditionMet(run: Run, until: WaitCondition): boolean {
    switch (until) {
      case 'plan_decided':
        return !['created', 'analyzed', 'awaiting_approval'].includes(run.state);
      case 'deployed':
        return ['healthy', 'failed', 'incident'].includes(run.state) && !this.jobs.has(run.id);
      case 'remediation_decided':
        return !this.d.store.data.approvals.some((a) => a.runId === run.id && a.kind === 'remediation' && a.status === 'pending');
      case 'recovered':
        return (
          (run.state === 'healthy' && !this.d.store.data.incidents.some((i) => i.runId === run.id && i.status !== 'resolved')) ||
          run.state === 'failed'
        );
    }
  }

  async exportEvidence(runId: string): Promise<{ json: string; markdown: string }> {
    const agg = this.d.store.aggregate(runId);
    const dir = path.join(this.d.repoRoot, 'evidence', 'demo-runs');
    fs.mkdirSync(dir, { recursive: true });
    const jsonPath = path.join(dir, `${runId}.json`);
    const mdPath = path.join(dir, `${runId}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(agg, null, 2));
    fs.writeFileSync(mdPath, renderAuditMarkdown(agg));
    const capabilities: ProviderCapabilities[] = await Promise.all(
      [...this.d.providers.values()].map((p) =>
        p.capabilities().catch(
          (err): ProviderCapabilities => ({
            provider: p.id,
            displayName: p.id,
            authenticated: false,
            region: 'unknown',
            services: [],
            supportsRollback: false,
            notes: [errMsg(err)],
          }),
        ),
      ),
    );
    fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify(capabilities, null, 2));
    const rel = (p: string) => path.relative(this.d.repoRoot, p).split(path.sep).join('/');
    this.emit(runId, 'orchestrator', 'action', 'evidence.exported', `Audit trail exported to ${rel(mdPath)} and ${rel(jsonPath)}`);
    return { json: rel(jsonPath), markdown: rel(mdPath) };
  }
}
```

### Task 5.4 — Routes

- [ ] **Step 1: Replace `apps/orchestrator/src/routes/runs.ts`**

```ts
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
```

- [ ] **Step 2: Create `apps/orchestrator/src/routes/incidents.ts`**

```ts
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
```

- [ ] **Step 3: Create `apps/orchestrator/src/routes/demo.ts`**

```ts
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
```

### Task 5.5 — Composition root and app

- [ ] **Step 1: Replace `apps/orchestrator/src/deps.ts`**

```ts
/**
 * @file      apps/orchestrator/src/deps.ts
 * @phase     P4 (replaced in P5; replaced again in P8, P12)
 * @owner     Orchestration & Cloud
 * @purpose   Composition root: builds every service once and wires them together. Tests pass overrides (fakes).
 * @depends   @bobops/core, ./config, ./store, ./events, ./services, ./ports
 * @usedBy    src/index.ts, src/app.ts, tests
 * @agentNotes Add new services HERE, never `new` them inside routes.
 */
import { probeHealth, type CloudProvider, type ProbeFn, type ProviderId } from '@bobops/core';
import type { Config } from './config';
import { EventBus } from './events/event-bus';
import type { GitHubPort } from './ports';
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
  const providers = o.providers ?? new Map<ProviderId, CloudProvider>();
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

- [ ] **Step 2: Replace `apps/orchestrator/src/app.ts`**

```ts
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
```

### Task 5.6 — Lifecycle tests (the whole product loop, fake clouds)

- [ ] **Step 1: Create `apps/orchestrator/src/lifecycle.test.ts`**

```ts
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
```

- [ ] **Step 2:** `pnpm install; pnpm test` → Expected: all pass (core 23, demo 6, orchestrator 7 + 6 = 42).
- [ ] **Step 3:** `pnpm typecheck` → Expected: no errors.

## HANDOFF

```text
✅ PHASE 05 COMPLETE — Orchestrator lifecycle engine
BUILT:
  - LifecycleService: approval guard, TEST gate, parallel deploy, VERIFY (HTTP + provider-native), incidents,
    diagnosis, hash-bound remediation approvals, fault injection, wait long-poll, evidence export
  - Routes: /api/runs/:id/{execute,verify,logs,wait,export}, /api/incidents/*, /api/demo/fault
  - FakeProvider + 6 lifecycle tests covering the whole demo story
DO THIS (human):
  1. pnpm test; pnpm typecheck
  2. Read the test names in apps/orchestrator/src/lifecycle.test.ts — this is the demo, proven without clouds.
EXPECT:
  - 42 tests pass (≈ 2 s extra for the wait test)
IF IT FAILS:
  - "Invalid run transition" in a test → compare with TRANSITIONS in packages/core/src/state-machine.ts (don't edit tests)
  - execa import error → pnpm install (execa ^9 is ESM-only; package.json must have "type": "module")
EVIDENCE:
  - Screenshot Bob's task summary → evidence/bob-task-summaries/phase-05-orchestrator-lifecycle.png
  - git add -A; git commit -m "feat(p05): lifecycle engine"; git push
```
