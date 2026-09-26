/**
 * @file      apps/orchestrator/src/services/run-service.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   UNDERSTAND + PLAN stages: create runs, record Bob's analysis, accept hashed plans, record HUMAN approval decisions.
 * @depends   @bobops/core, ../store/json-store, ../events/event-bus, ../lib/*
 * @usedBy    routes/runs.ts, routes/approvals.ts, LifecycleService (transition)
 * @agentNotes ALL run state changes go through transition() (it validates against the core state machine and records
 *             stateHistory). decideApproval is only reachable through the token-protected route.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  assertTransition,
  evidence,
  newId,
  nowIso,
  type Actor,
  type AppProfile,
  type Approval,
  type DeploymentPlan,
  type ProviderId,
  type Run,
  type RunState,
  type Severity,
} from '@bobops/core';
import type { EventBus } from '../events/event-bus';
import { BadRequestError, ConflictError } from '../lib/errors';
import { sha256 } from '../lib/hash';
import type { JsonStore } from '../store/json-store';

export interface CreateRunInput {
  projectName: string;
  repoPath: string;
  objective: string;
  targets: ProviderId[];
}

const maxSeverity = (plan: DeploymentPlan): Severity =>
  plan.risks.some((r) => r.severity === 'high') ? 'high' : plan.risks.some((r) => r.severity === 'medium') ? 'medium' : 'low';

export class RunService {
  constructor(
    private readonly store: JsonStore,
    private readonly bus: EventBus,
    private readonly repoRoot: string,
  ) {}

  transition(run: Run, to: RunState): Run {
    assertTransition(run.state, to);
    const at = nowIso();
    const next: Run = { ...run, state: to, updatedAt: at, stateHistory: [...run.stateHistory, { state: to, at }] };
    this.store.upsert('runs', next);
    return next;
  }

  createRun(input: CreateRunInput, actor: Actor = 'human'): Run {
    const abs = path.resolve(this.repoRoot, input.repoPath);
    const rel = path.relative(this.repoRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new BadRequestError('repoPath must be inside the repository');
    if (!fs.existsSync(abs)) throw new BadRequestError(`repoPath ${input.repoPath} does not exist`);
    const now = nowIso();
    const run: Run = {
      id: newId('run'),
      projectName: input.projectName,
      repoPath: rel.split(path.sep).join('/'),
      objective: input.objective,
      targets: [...new Set(input.targets)],
      state: 'created',
      createdAt: now,
      updatedAt: now,
      stateHistory: [{ state: 'created', at: now }],
    };
    this.store.upsert('runs', run);
    this.bus.emit({
      runId: run.id,
      actor,
      kind: 'action',
      type: 'run.created',
      message: `Run created for ${run.projectName} (${run.repoPath}): "${run.objective}" → ${run.targets.join(' + ')}`,
    });
    return run;
  }

  recordAnalysis(runId: string, profile: AppProfile): Run {
    const run = this.store.getRun(runId);
    const next = this.transition({ ...run, profile }, 'analyzed');
    this.bus.emit({
      runId,
      actor: 'bob',
      kind: 'observation',
      type: 'analysis.recorded',
      message: `Bob profiled ${profile.name}: ${profile.runtime} ${profile.runtimeVersion} / ${profile.framework}, port ${profile.port}, health ${profile.healthPath}, required env [${profile.requiredEnv.join(', ')}]`,
      evidence: [evidence('Application profile', 'bob:synthesis', profile)],
    });
    for (const finding of profile.specialistFindings) {
      this.bus.emit({
        runId,
        actor: 'bob',
        kind: 'inference',
        type: 'specialist.finding',
        message: `${finding.specialist}: ${finding.summary}`,
        evidence: [evidence(`${finding.specialist} findings`, `bob:${finding.specialist}`, finding)],
      });
    }
    return next;
  }

  submitPlan(runId: string, plan: DeploymentPlan): { run: Run; approval: Approval } {
    const run = this.store.getRun(runId);
    if (!['analyzed', 'awaiting_approval', 'rejected'].includes(run.state)) {
      throw new ConflictError(`Cannot submit a plan while the run is ${run.state}. Record the analysis first.`);
    }
    for (const target of plan.targets) {
      if (!run.targets.includes(target.provider)) {
        throw new BadRequestError(`Plan targets ${target.provider}, which is not one of this run's targets (${run.targets.join(', ')})`);
      }
    }
    const now = nowIso();
    for (const a of this.store.data.approvals) {
      if (a.runId === runId && a.kind === 'deploy_plan' && a.status === 'pending') {
        this.store.upsert('approvals', { ...a, status: 'rejected', decidedAt: now, decidedBy: 'orchestrator', comment: 'Superseded by a newer plan' });
      }
    }
    const planHash = sha256(plan);
    const updated = this.transition({ ...run, plan, planHash }, 'awaiting_approval');
    const approval: Approval = {
      id: newId('apr'),
      runId,
      kind: 'deploy_plan',
      subjectId: runId,
      subjectHash: planHash,
      summary: plan.summary,
      risk: maxSeverity(plan),
      status: 'pending',
      requestedAt: now,
    };
    this.store.upsert('approvals', approval);
    this.bus.emit({
      runId,
      actor: 'bob',
      kind: 'proposal',
      type: 'plan.submitted',
      message: `Bob proposed a plan for ${plan.targets.map((t) => `${t.provider}/${t.service}`).join(' + ')} (${plan.risks.length} risks, ${plan.generatedAssets.length} generated assets)`,
      evidence: [evidence('Deployment plan', 'bob:synthesis', plan)],
    });
    this.bus.emit({
      runId,
      actor: 'orchestrator',
      kind: 'proposal',
      type: 'approval.requested',
      message: `Human approval required for the deployment plan (hash ${planHash.slice(0, 12)}…, risk ${approval.risk})`,
    });
    return { run: updated, approval };
  }

  decideApproval(approvalId: string, decision: 'approved' | 'rejected', decidedBy: string, comment?: string): Approval {
    const approval = this.store.getApproval(approvalId);
    if (approval.status !== 'pending') throw new ConflictError(`Approval ${approvalId} is already ${approval.status}`);
    const run = this.store.getRun(approval.runId);
    if (approval.kind === 'deploy_plan' && approval.subjectHash !== run.planHash) {
      throw new ConflictError('The plan changed after this approval was requested. Review the new plan.');
    }
    if (approval.kind === 'deploy_plan') {
      this.transition(run, decision === 'approved' ? 'approved' : 'rejected');
    } else {
      const incident = this.store.data.incidents.find((i) => i.remediation?.approvalId === approvalId);
      if (incident?.remediation) {
        this.store.upsert('incidents', {
          ...incident,
          status: decision === 'approved' ? incident.status : 'diagnosed',
          remediation: { ...incident.remediation, status: decision },
        });
        if (decision === 'rejected' && run.state === 'awaiting_remediation_approval') this.transition(run, 'incident');
      }
    }
    const decided: Approval = { ...approval, status: decision, decidedAt: nowIso(), decidedBy, comment };
    this.store.upsert('approvals', decided);
    this.bus.emit({
      runId: approval.runId,
      actor: 'human',
      kind: 'action',
      type: 'approval.decided',
      message: `${decidedBy} ${decision} the ${approval.kind === 'deploy_plan' ? 'deployment plan' : 'remediation'}${comment ? ` — "${comment}"` : ''}`,
    });
    return decided;
  }
}
