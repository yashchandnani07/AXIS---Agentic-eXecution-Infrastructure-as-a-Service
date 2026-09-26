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
    return { provider: dep.provider, service: dep.service, appName: dep.appName, region: dep.region, endpoint: dep.endpoint, revision: dep.revision };
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
      service: target.service,
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
    const run = this.d.store.getRun(runId);
    const targets = this.latestDeployments(runId).map((d) => ({
      runId,
      provider: d.provider,
      appName: d.appName,
      endpoint: d.endpoint ?? '',
      healthPath: d.healthPath,
      intervalMinutes: run.sentinelIntervalMinutes,
    }));
    try {
      await this.d.github.publishSentinelTargets(targets);
      this.emit(
        runId,
        'orchestrator',
        'action',
        'sentinel.armed',
        `GitHub health sentinel armed for ${targets.length} endpoint(s), checking in every ${run.sentinelIntervalMinutes} min`,
        [evidence('Sentinel targets (repo variable SENTINEL_TARGETS)', 'GitHub Actions', targets)],
      );
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
            offeredServices: [],
            supportsRollback: false,
            notes: [errMsg(err)],
          }),
        ),
      ),
    );
    // Public evidence: drop account names/ids and identity notes (the repo is public).
    const publicCapabilities = capabilities.map((c) => ({ ...c, account: undefined, notes: [] }));
    fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify(publicCapabilities, null, 2));
    const rel = (p: string) => path.relative(this.d.repoRoot, p).split(path.sep).join('/');
    this.emit(runId, 'orchestrator', 'action', 'evidence.exported', `Audit trail exported to ${rel(mdPath)} and ${rel(jsonPath)}`);
    return { json: rel(jsonPath), markdown: rel(mdPath) };
  }
}
