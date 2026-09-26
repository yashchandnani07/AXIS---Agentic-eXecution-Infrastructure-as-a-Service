/**
 * @file      packages/core/src/state-machine.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   The explicit run lifecycle (PRD §8 "Orchestrator"). Every state change in the orchestrator goes through assertTransition.
 * @depends   ./schemas (types)
 * @usedBy    orchestrator RunService.transition()
 * @agentNotes Approval gates are encoded here: there is NO edge from analyzed/awaiting_approval to deploying,
 *             and NO edge from incident to remediating. Keep it that way.
 */
import type { RunState } from './schemas';

export const TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  created: ['analyzed'],
  analyzed: ['analyzed', 'awaiting_approval'],
  awaiting_approval: ['awaiting_approval', 'approved', 'rejected'],
  rejected: ['analyzed', 'awaiting_approval'],
  approved: ['deploying'],
  deploying: ['verifying', 'failed'],
  verifying: ['healthy', 'failed', 'incident'],
  healthy: ['verifying', 'incident'],
  failed: ['deploying', 'verifying', 'incident', 'awaiting_remediation_approval'],
  incident: ['incident', 'awaiting_remediation_approval'],
  awaiting_remediation_approval: ['awaiting_remediation_approval', 'remediating', 'incident'],
  remediating: ['verifying', 'failed'],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: RunState,
    readonly to: RunState,
  ) {
    super(`Invalid run transition ${from} → ${to}. Allowed from ${from}: [${TRANSITIONS[from].join(', ')}]`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
