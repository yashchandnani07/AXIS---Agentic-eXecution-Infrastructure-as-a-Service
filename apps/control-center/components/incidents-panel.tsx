/**
 * @file      apps/control-center/components/incidents-panel.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   RECOVER view: incidents (sentinel/orchestrator), failing probes, GitHub issue link, Bob's diagnosis, remediation.
 * @depends   react, clsx, @bobops/core, @/lib/api, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes "Sync sentinel" pulls GitHub issues immediately (the orchestrator also syncs every 60 s).
 */
'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { describeAction, formatDuration, type RunAggregate } from '@bobops/core';
import { MODE, api } from '@/lib/api';
import { errorText, fmtTime } from '@/lib/format';
import { Panel, ProviderBadge } from './ui';

export function IncidentsPanel({ agg, onChanged }: { agg: RunAggregate; onChanged: () => void }) {
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const showSync = MODE === 'live' && ['healthy', 'incident', 'failed'].includes(agg.run.state);
  if (!agg.incidents.length && !showSync) return null;

  async function sync() {
    try {
      const r = await api.syncIncidents();
      setSyncNote(r.note ?? `Imported ${r.imported} of ${r.open} open sentinel issue(s)`);
      onChanged();
    } catch (err) {
      setSyncNote(errorText(err));
    }
  }

  return (
    <Panel
      title="RECOVER — incidents"
      subtitle="Detected by GitHub health sentinel or orchestrator probes · diagnosed by Bob · fixed only after approval"
      right={
        showSync ? (
          <button onClick={sync} className="rounded border border-line-strong px-3 py-1 text-xs text-fg hover:border-warn hover:text-warn transition-colors">
            Sync sentinel
          </button>
        ) : undefined
      }
    >
      {syncNote && <p className="mb-3 text-xs text-muted font-mono">{syncNote}</p>}
      {!agg.incidents.length && <p className="text-sm text-muted">No incidents. The sentinel probes every endpoint on schedule.</p>}
      <div className="space-y-4">
        {agg.incidents
          .slice()
          .reverse()
          .map((i) => (
            <article key={i.id} className={clsx('rounded-lg border p-4', i.status === 'resolved' ? 'border-ok/50 bg-ok/5' : 'border-bad/80 bg-bad/5')}>
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <ProviderBadge provider={i.provider} />
                  <span className="text-sm font-semibold text-fg">{i.title}</span>
                </div>
                <span className={clsx('rounded px-2 py-0.5 font-mono text-[10px] uppercase font-medium border', i.status === 'resolved' ? 'bg-ok/15 text-ok border-ok/30' : 'bg-bad/15 text-bad border-bad/30')}>
                  {i.status.replace(/_/g, ' ')}
                </span>
              </header>
              <p className="mt-1.5 text-xs text-muted">
                opened {fmtTime(i.openedAt)} by {i.source === 'sentinel' ? 'GitHub health sentinel' : 'orchestrator probe'}
                {i.githubIssueUrl && (
                  <>
                    {' · '}
                    <a href={i.githubIssueUrl} target="_blank" rel="noreferrer" className="text-ibm-soft hover:underline">
                      GitHub issue #{i.githubIssueNumber}
                    </a>
                  </>
                )}
                {i.resolvedAt && ` · resolved ${fmtTime(i.resolvedAt)} (MTTR ${formatDuration(Date.parse(i.resolvedAt) - Date.parse(i.openedAt))})`}
              </p>
              <table className="mt-3 w-full text-xs">
                <tbody>
                  {i.probes.slice(-4).map((p) => (
                    <tr key={p.id} className="border-t border-line/60">
                      <td className="py-1 pr-2 font-mono text-muted">{fmtTime(p.checkedAt)}</td>
                      <td className={clsx('py-1 pr-2 font-mono font-medium', p.ok ? 'text-ok' : 'text-bad')}>{p.statusCode || 'ERR'}</td>
                      <td className="py-1 pr-2 font-mono text-fg">{p.latencyMs} ms</td>
                      <td className="truncate py-1 font-mono text-muted">{p.error ?? JSON.stringify(p.body ?? '').slice(0, 110)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {i.diagnosis && (
                <div className="mt-3 rounded border border-bob/30 bg-bob/10 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-bob font-semibold">◆ Bob&apos;s Diagnosis · {i.diagnosis.confidence} confidence</span>
                    <span className="rounded bg-bob/20 px-2 py-0.5 font-mono text-[10px] text-bob font-medium border border-bob/40">IBM Granite · watsonx.ai</span>
                  </div>
                  <p className="mt-1 text-fg leading-relaxed">{i.diagnosis.rootCause}</p>
                  <ul className="mt-1.5 list-disc pl-4 text-xs text-muted space-y-0.5">
                    {i.diagnosis.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {i.remediation && (
                <div className="mt-3 rounded border border-warn/30 bg-layer-2 p-3 text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-warn font-semibold">Remediation · {i.remediation.status}</div>
                  <p className="mt-1 font-mono text-xs text-fg">{describeAction(i.remediation.action)}</p>
                  <p className="text-xs text-muted mt-0.5">{i.remediation.rationale}</p>
                </div>
              )}
            </article>
          ))}
      </div>
    </Panel>
  );
}
