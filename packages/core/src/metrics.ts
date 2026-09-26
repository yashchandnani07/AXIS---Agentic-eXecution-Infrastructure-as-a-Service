/**
 * @file      packages/core/src/metrics.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Business-value numbers shown in the Control Center and the exported audit trail.
 * @depends   ./schemas (types)
 * @usedBy    control-center MetricsStrip, audit.ts, README screenshots
 * @agentNotes "timeToHealthyMs" honestly includes the human approval time — say so in the pitch.
 */
import type { ProviderId, RunAggregate } from './schemas';

export interface RunMetrics {
  /** run created → first time the run became healthy */
  timeToHealthyMs?: number;
  /** mean incident open → resolved */
  mttrMs?: number;
  approvals: number;
  bobActions: number;
  guardBlocks: number;
  providersLive: number;
}

export function computeMetrics(agg: RunAggregate): RunMetrics {
  const created = Date.parse(agg.run.createdAt);
  const firstHealthy = agg.run.stateHistory.find((s) => s.state === 'healthy');
  const mttrs = agg.incidents
    .filter((i) => i.resolvedAt)
    .map((i) => Date.parse(i.resolvedAt as string) - Date.parse(i.openedAt));
  const latest = new Map<ProviderId, boolean>();
  for (const h of agg.healthChecks) latest.set(h.provider, h.ok);
  return {
    timeToHealthyMs: firstHealthy ? Date.parse(firstHealthy.at) - created : undefined,
    mttrMs: mttrs.length ? Math.round(mttrs.reduce((a, b) => a + b, 0) / mttrs.length) : undefined,
    approvals: agg.approvals.filter((a) => a.status === 'approved').length,
    bobActions: agg.events.filter((e) => e.actor === 'bob').length,
    guardBlocks: agg.events.filter((e) => e.type === 'guard.blocked').length,
    providersLive: [...latest.values()].filter(Boolean).length,
  };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}
