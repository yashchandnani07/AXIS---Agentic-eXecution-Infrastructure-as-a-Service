/**
 * @file      apps/bob-mcp/src/summarize.test.ts
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   The compact summary Bob sees must include state, endpoints, health, approvals and incidents.
 * @depends   vitest, @bobops/core, ./summarize
 * @usedBy    pnpm test
 * @agentNotes Keep summaries small — they are paid for in Bobcoins on every devops_get_run / devops_wait call.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_APP_PROFILE, examplePlan, type RunAggregate } from '@bobops/core';
import { summarizeRun } from './summarize';

const agg: RunAggregate = {
  run: {
    id: 'run_1',
    projectName: 'nimbus-books',
    repoPath: 'apps/demo-service',
    objective: 'deploy',
    targets: ['ibm-cloud'],
    sentinelIntervalMinutes: 5,
    state: 'incident',
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
    stateHistory: [],
    profile: EXAMPLE_APP_PROFILE,
    plan: examplePlan(['ibm-cloud']),
    planHash: 'abcdef1234567890',
  },
  approvals: [
    { id: 'apr_1', runId: 'run_1', kind: 'remediation', subjectId: 'rem_1', subjectHash: 'h', summary: 'Set CATALOG_MODE=featured', risk: 'low', status: 'pending', requestedAt: 'x' },
  ],
  deployments: [
    { id: 'dep_1', runId: 'run_1', provider: 'ibm-cloud', service: 'code-engine', appName: 'bobops-nimbus-books', region: 'us-south', healthPath: '/health', status: 'succeeded', endpoint: 'https://x', revision: 'r2', startedAt: 'x' },
  ],
  healthChecks: [
    { id: 'h1', runId: 'run_1', provider: 'ibm-cloud', endpoint: 'https://x/health', ok: false, statusCode: 503, latencyMs: 80, body: { status: 'unhealthy' }, checkedAt: 'x' },
  ],
  incidents: [{ id: 'inc_1', runId: 'run_1', provider: 'ibm-cloud', source: 'sentinel', status: 'open', title: 't', openedAt: 'x', probes: [] }],
  events: [{ id: 'e1', runId: 'run_1', at: '2026-09-27T10:00:01.000Z', actor: 'sentinel', kind: 'observation', type: 'incident.opened', message: 'opened', evidence: [] }],
};

describe('summarizeRun', () => {
  it('produces a compact, decision-ready view', () => {
    const s = summarizeRun(agg, 'http://localhost:3000');
    expect(s.state).toBe('incident');
    expect(s.controlCenterUrl).toBe('http://localhost:3000/run?id=run_1');
    expect(s.deployments[0]?.endpoint).toBe('https://x');
    expect(s.deployments[0]?.service).toBe('code-engine');
    expect(s.targets[0]?.architectureRationale).toContain('always-on');
    expect(s.health[0]?.statusCode).toBe(503);
    expect(s.health[0]?.body).toEqual({ status: 'unhealthy' });
    expect(s.pendingApprovals).toHaveLength(1);
    expect(s.openIncidents[0]?.id).toBe('inc_1');
    expect(s.recentEvents[0]).toContain('incident.opened');
  });
});
