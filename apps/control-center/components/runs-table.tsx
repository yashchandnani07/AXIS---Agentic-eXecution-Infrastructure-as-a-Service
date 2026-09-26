/**
 * @file      apps/control-center/components/runs-table.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   List of deployment runs with state and a link to the run page.
 * @depends   next/link, @bobops/core, ./ui, @/lib/format
 * @usedBy    app/page.tsx
 * @agentNotes Empty state teaches the judge how a run is started (from IBM Bob, not from this UI).
 */
import Link from 'next/link';
import type { Run } from '@bobops/core';
import { fmtTime } from '@/lib/format';
import { StateBadge } from './ui';

export function RunsTable({ runs }: { runs: Run[] }) {
  if (!runs.length) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted">
          No runs yet. In IBM Bob choose <b className="text-bob">🛰️ Multi-Cloud DevOps Engineer</b> and type{' '}
          <code className="rounded bg-layer-2 px-1.5 py-0.5 font-mono text-bob text-xs">/deploy apps/demo-service</code>.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-line">
          <tr>
            <th className="py-2.5 font-medium">Run ID</th>
            <th className="font-medium">Project</th>
            <th className="font-medium">Targets</th>
            <th className="font-medium">State</th>
            <th className="font-medium">Created</th>
            <th className="text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {runs.map((r) => (
            <tr key={r.id} className="hover:bg-layer-2/30 transition-colors">
              <td className="py-3 font-mono text-xs font-medium text-fg">{r.id}</td>
              <td className="font-medium">{r.projectName}</td>
              <td className="text-xs text-muted">{r.targets.join(' + ')}</td>
              <td>
                <StateBadge state={r.state} />
              </td>
              <td className="text-xs text-muted font-mono">{fmtTime(r.createdAt)}</td>
              <td className="text-right">
                <Link href={`/run?id=${r.id}`} className="inline-flex items-center text-xs font-medium text-ibm-soft hover:text-ibm hover:underline">
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
