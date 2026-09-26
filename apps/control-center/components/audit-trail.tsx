/**
 * @file      apps/control-center/components/audit-trail.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   The audit trail: every event with actor, evidence kind, message and expandable evidence JSON; kind filter; export.
 * @depends   react, clsx, @bobops/core, @/lib/api, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes This panel is the closing shot of the demo (repository → plan → approval → deployment → incident → recovery).
 */
'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { EventKindSchema, type EventKind, type RunAggregate } from '@bobops/core';
import { MODE, api } from '@/lib/api';
import { errorText, fmtTime, json } from '@/lib/format';
import { ActorBadge, KindChip, Panel } from './ui';

const FILTERS: Array<EventKind | 'all'> = ['all', ...EventKindSchema.options];

export function AuditTrail({ agg }: { agg: RunAggregate }) {
  const [filter, setFilter] = useState<EventKind | 'all'>('all');
  const [note, setNote] = useState<string | null>(null);
  const events = agg.events
    .slice()
    .reverse()
    .filter((e) => filter === 'all' || e.kind === filter);

  async function exportTrail() {
    try {
      const r = await api.exportEvidence(agg.run.id);
      setNote(`Saved ${r.markdown}`);
    } catch (err) {
      setNote(errorText(err));
    }
  }

  return (
    <aside className="xl:sticky xl:top-20 xl:self-start">
      <Panel
        title="Audit trail"
        subtitle="Observation · inference · proposal · action · verification — with evidence"
        right={
          MODE === 'live' ? (
            <button onClick={exportTrail} className="rounded border border-line-strong px-3 py-1 text-xs text-fg hover:border-ok hover:text-ok transition-colors">
              Export
            </button>
          ) : undefined
        }
      >
        <div className="mb-3.5 flex flex-wrap gap-1">
          {FILTERS.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={clsx('rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors', filter === k ? 'bg-ibm text-white font-medium' : 'bg-layer-2 text-muted hover:text-fg')}
            >
              {k}
            </button>
          ))}
        </div>
        {note && <p className="mb-2.5 text-[11px] font-mono text-ok">{note}</p>}
        <ol className="max-h-[72vh] space-y-3 overflow-auto pr-1">
          {events.map((e) => (
            <li key={e.id} className={clsx('border-l-2 pl-3 py-0.5', e.type === 'guard.blocked' ? 'border-bad' : e.actor === 'bob' ? 'border-bob' : 'border-line')}>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span className="font-mono text-muted">{fmtTime(e.at)}</span>
                <ActorBadge actor={e.actor} />
                <KindChip kind={e.kind} />
              </div>
              <p className="mt-1 text-xs leading-relaxed text-fg">{e.message}</p>
              {e.evidence.length > 0 && (
                <details className="mt-1.5 group">
                  <summary className="cursor-pointer text-[10px] font-mono text-ibm-soft hover:underline">
                    evidence ({e.evidence.length})
                  </summary>
                  {e.evidence.map((ev, idx) => (
                    <div key={idx} className="mt-1.5 rounded border border-line bg-canvas p-2">
                      <div className="text-[10px] font-mono text-muted mb-1">
                        {ev.label} · <span className="text-fg">{ev.source}</span>
                      </div>
                      <pre className="max-h-48 overflow-auto rounded bg-layer p-2 font-mono text-[10px] text-fg leading-relaxed select-text">{json(ev.data)}</pre>
                    </div>
                  ))}
                </details>
              )}
            </li>
          ))}
        </ol>
      </Panel>
    </aside>
  );
}
