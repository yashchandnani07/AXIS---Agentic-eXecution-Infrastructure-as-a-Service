/**
 * @file      packages/core/src/events.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Canonical audit event types and their mapping to the 8 lifecycle stages shown in the UI.
 * @depends   (type-only) ./schemas
 * @usedBy    schemas.ts (RunEventSchema), orchestrator (emits), control-center (stepper)
 * @agentNotes Adding an event type? Add it to EVENT_TYPES and, if it belongs to a stage, make its prefix map in PREFIX_STAGE.
 */
import type { RunState } from './schemas';

export const EVENT_TYPES = [
  'run.created',
  'analysis.recorded',
  'specialist.finding',
  'bob.note',
  'plan.submitted',
  'approval.requested',
  'approval.decided',
  'guard.blocked',
  'test.started',
  'test.passed',
  'test.failed',
  'provision.started',
  'provision.completed',
  'build.started',
  'build.completed',
  'deploy.started',
  'deploy.completed',
  'deploy.failed',
  'verify.passed',
  'verify.failed',
  'sentinel.armed',
  'fault.injected',
  'incident.opened',
  'incident.diagnosed',
  'remediation.proposed',
  'remediation.started',
  'remediation.completed',
  'remediation.failed',
  'incident.resolved',
  'provider.progress',
  'orchestrator.warning',
  'evidence.exported',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const LIFECYCLE_STAGES = ['UNDERSTAND', 'PLAN', 'PROVISION', 'BUILD', 'TEST', 'DEPLOY', 'VERIFY', 'RECOVER'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

const PREFIX_STAGE: Record<string, LifecycleStage> = {
  run: 'UNDERSTAND',
  analysis: 'UNDERSTAND',
  specialist: 'UNDERSTAND',
  plan: 'PLAN',
  approval: 'PLAN',
  provision: 'PROVISION',
  build: 'BUILD',
  test: 'TEST',
  deploy: 'DEPLOY',
  verify: 'VERIFY',
  sentinel: 'VERIFY',
  fault: 'RECOVER',
  incident: 'RECOVER',
  remediation: 'RECOVER',
};

/** Stage an event belongs to, or null for cross-cutting events (bob.note, guard.blocked, …). */
export function stageForEvent(type: EventType): LifecycleStage | null {
  const prefix = type.split('.')[0] ?? '';
  return PREFIX_STAGE[prefix] ?? null;
}

/** Stage the run is currently in, derived from its state. */
export function stageForState(state: RunState): LifecycleStage {
  switch (state) {
    case 'created':
    case 'analyzed':
      return 'UNDERSTAND';
    case 'awaiting_approval':
    case 'approved':
    case 'rejected':
      return 'PLAN';
    case 'deploying':
      return 'DEPLOY';
    case 'verifying':
    case 'healthy':
    case 'failed':
      return 'VERIFY';
    case 'incident':
    case 'awaiting_remediation_approval':
    case 'remediating':
      return 'RECOVER';
  }
}
