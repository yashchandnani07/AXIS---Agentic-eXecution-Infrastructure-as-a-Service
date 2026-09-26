/**
 * @file      packages/core/src/metrics.test.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Verifies the business-value metrics (time-to-healthy, MTTR, counters).
 * @depends   vitest, ./metrics, ./audit
 * @usedBy    pnpm test
 * @agentNotes Build aggregates by hand here — do not import orchestrator code into core tests.
 */
import { describe, expect, it } from 'vitest';
import { renderAuditMarkdown } from './audit';
import { computeMetrics, formatDuration } from './metrics';
import type { RunAggregate } from './schemas';

const agg: RunAggregate = {
  run: {
    id: 'run_1',
    projectName: 'nimbus-books',
    repoPath: 'apps/demo-service',
    objective: 'deploy',
    targets: ['ibm-cloud'],
    state: 'healthy',
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:10:00.000Z',
    stateHistory: [
      { state: 'created', at: '2026-09-27T10:00:00.000Z' },
      { state: 'healthy', at: '2026-09-27T10:04:30.000Z' },
    ],
  },
  approvals: [
    { id: 'a', runId: 'run_1', kind: 'deploy_plan', subjectId: 'run_1', subjectHash: 'h', summary: 's', risk: 'low', status: 'approved', requestedAt: 'x' },
  ],
  deployments: [],
  healthChecks: [
    { id: 'h', provider: 'ibm-cloud', endpoint: 'e', ok: true, statusCode: 200, latencyMs: 90, checkedAt: 'x' },
  ],
  incidents: [
    { id: 'i', runId: 'run_1', provider: 'ibm-cloud', source: 'sentinel', status: 'resolved', title: 't', openedAt: '2026-09-27T10:05:00.000Z', resolvedAt: '2026-09-27T10:07:00.000Z', probes: [] },
  ],
  events: [
    { id: 'e1', runId: 'run_1', at: '2026-09-27T10:00:01.000Z', actor: 'bob', kind: 'observation', type: 'analysis.recorded', message: 'm', evidence: [] },
    { id: 'e2', runId: 'run_1', at: '2026-09-27T10:00:02.000Z', actor: 'orchestrator', kind: 'verification', type: 'guard.blocked', message: 'm', evidence: [] },
  ],
};

describe('metrics', () => {
  it('computes business metrics', () => {
    const m = computeMetrics(agg);
    expect(m.timeToHealthyMs).toBe(270_000);
    expect(m.mttrMs).toBe(120_000);
    expect(m.approvals).toBe(1);
    expect(m.bobActions).toBe(1);
    expect(m.guardBlocks).toBe(1);
    expect(m.providersLive).toBe(1);
  });
  it('formats durations', () => {
    expect(formatDuration(270_000)).toBe('4m 30s');
    expect(formatDuration(9_000)).toBe('9s');
  });
  it('renders an audit trail', () => {
    expect(renderAuditMarkdown(agg)).toContain('Run created → verified healthy:** 4m 30s');
  });
});
