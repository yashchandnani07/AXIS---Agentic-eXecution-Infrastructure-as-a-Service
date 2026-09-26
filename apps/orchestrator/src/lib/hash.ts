/**
 * @file      apps/orchestrator/src/lib/hash.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   sha256 over stable JSON — binds human approvals to the exact plan/remediation that was reviewed.
 * @depends   node:crypto, @bobops/core (stableStringify)
 * @usedBy    RunService.submitPlan, LifecycleService (remediation approvals, guards)
 * @agentNotes Changing this function invalidates every stored approval. Don't.
 */
import { createHash } from 'node:crypto';
import { stableStringify } from '@bobops/core';

export const sha256 = (value: unknown): string => createHash('sha256').update(stableStringify(value)).digest('hex');
