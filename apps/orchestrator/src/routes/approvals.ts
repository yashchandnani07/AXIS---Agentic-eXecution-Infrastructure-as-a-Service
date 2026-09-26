/**
 * @file      apps/orchestrator/src/routes/approvals.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   Human approval endpoints. Deciding requires the x-approval-token header, which only the Control Center has.
 * @depends   hono, zod, ../deps, ../lib/errors
 * @usedBy    control-center ApprovalQueue; NEVER bob-mcp (by design there is no approve tool)
 * @agentNotes Do not add any alternative way to approve. Failed attempts are logged as guard.blocked audit events.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps';
import { HttpError } from '../lib/errors';

const DecisionBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  decidedBy: z.string().min(1).default('developer'),
  comment: z.string().optional(),
});

export function approvalRoutes(deps: Deps) {
  const r = new Hono();

  r.get('/', (c) => {
    const status = c.req.query('status');
    return c.json(deps.store.data.approvals.filter((a) => !status || a.status === status));
  });

  r.post('/:id/decision', async (c) => {
    const approval = deps.store.getApproval(c.req.param('id'));
    if (c.req.header('x-approval-token') !== deps.config.APPROVAL_TOKEN) {
      deps.bus.emit({
        runId: approval.runId,
        actor: 'orchestrator',
        kind: 'verification',
        type: 'guard.blocked',
        message: 'Blocked an approval decision that did not come from a human in the Control Center (missing/invalid approval token)',
      });
      throw new HttpError(401, 'approval_token_required', 'Only a human using the Control Center can decide approvals');
    }
    const body = DecisionBody.parse(await c.req.json());
    return c.json(deps.runs.decideApproval(approval.id, body.decision, body.decidedBy, body.comment));
  });

  return r;
}
