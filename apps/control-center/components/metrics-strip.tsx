/**
 * @file      apps/control-center/components/metrics-strip.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Business-value numbers (time to verified multi-cloud, MTTR, approvals, Bob actions, unsafe actions blocked).
 * @depends   @bobops/core (computeMetrics, formatDuration)
 * @usedBy    app/run/page.tsx
 * @agentNotes These numbers are quoted in the pitch — keep labels honest (time includes human approval time).
 */
import { computeMetrics, formatDuration, type RunAggregate } from '@bobops/core';

export function MetricsStrip({ agg }: { agg: RunAggregate }) {
  const m = computeMetrics(agg);
  const items: Array<[string, string]> = [
    ['Run → verified multi-cloud', m.timeToHealthyMs !== undefined ? formatDuration(m.timeToHealthyMs) : '—'],
    ['Mean time to recovery (MTTR)', m.mttrMs !== undefined ? formatDuration(m.mttrMs) : '—'],
    ['Clouds live & verified', `${m.providersLive} / ${agg.run.targets.length}`],
    ['Human approvals decided', String(m.approvals)],
    ['Bob specialist actions', String(m.bobActions)],
    ['Unsafe actions blocked', String(m.guardBlocks)],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-line bg-layer px-4 py-3 flex flex-col justify-between">
          <div className="text-[10px] uppercase tracking-wider text-muted font-medium">{label}</div>
          <div className="mt-1 font-mono text-xl font-semibold text-fg">{value}</div>
        </div>
      ))}
    </div>
  );
}
