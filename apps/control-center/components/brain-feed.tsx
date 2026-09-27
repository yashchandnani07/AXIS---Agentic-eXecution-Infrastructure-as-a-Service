/**
 * @file      apps/control-center/components/brain-feed.tsx
 * @phase     P11+
 * @owner     Product & Experience
 * @purpose   "Bob's Brain" — real-time scrolling feed of labelled OBSERVE/INFER/PROPOSE/ACTION/VERIFY events
 *            with specialist badges. The live scrolling is the WOW demo moment: judges watch Bob think.
 * @depends   react, clsx, @bobops/core (RunAggregate, RunEvent)
 * @usedBy    app/run/page.tsx analytics tab
 * @agentNotes Auto-scrolls to latest. Renders the last 80 events max (perf).
 */
'use client';
import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import type { Actor, EventKind, RunAggregate, RunEvent, Specialist } from '@bobops/core';
import { fmtTime } from '@/lib/format';

// ── Label styling ─────────────────────────────────────────────────────────────
const KIND_STYLES: Record<EventKind, { label: string; cls: string }> = {
  observation: { label: 'OBS',    cls: 'bg-info/15 text-info border-info/30' },
  inference:   { label: 'INFER',  cls: 'bg-bob/15 text-bob border-bob/30' },
  proposal:    { label: 'PROP',   cls: 'bg-warn/15 text-warn border-warn/30' },
  action:      { label: 'ACTION', cls: 'bg-ibm/15 text-ibm-soft border-ibm/30' },
  verification:{ label: 'VERIFY', cls: 'bg-ok/15 text-ok border-ok/30' },
};

const ACTOR_STYLES: Record<string, string> = {
  bob:               'text-bob',
  human:             'text-fg',
  orchestrator:      'text-ibm-soft',
  sentinel:          'text-warn',
  'provider:ibm-cloud': 'text-ibm-soft',
  'provider:aws':    'text-aws',
};

const SPECIALIST_LABELS: Partial<Record<Specialist, string>> = {
  'application-analyst':  '⚙ App',
  'cloud-architect':      '☁ Arch',
  'security-reviewer':    '🔒 Sec',
  'release-verifier':     '✓ Rel',
  'incident-investigator':'🔍 Inv',
};

function actorLabel(actor: Actor, message: string): string {
  // Extract specialist prefix from message like "cloud-architect: ..."
  const match = /^(application-analyst|cloud-architect|security-reviewer|release-verifier|incident-investigator):\s/.exec(message);
  if (match) {
    const spec = match[1] as Specialist;
    return SPECIALIST_LABELS[spec] ?? actor;
  }
  const labels: Record<string, string> = {
    bob: 'Bob',
    human: 'Human',
    orchestrator: 'Orch',
    sentinel: 'Sentinel',
    'provider:ibm-cloud': 'IBM',
    'provider:aws': 'AWS',
  };
  return labels[actor] ?? actor;
}

function EventRow({ event }: { event: RunEvent }) {
  const kind = KIND_STYLES[event.kind] ?? KIND_STYLES.observation;
  const actorCls = ACTOR_STYLES[event.actor] ?? 'text-muted';
  const label = actorLabel(event.actor, event.message);
  // Strip specialist prefix if present
  const text = event.message.replace(/^[a-z-]+:\s/, '');

  return (
    <div className="flex items-start gap-2.5 py-1.5 border-b border-line/30 last:border-0 hover:bg-layer-2/40 transition-colors px-1 rounded text-xs">
      {/* Time */}
      <span className="text-[10px] font-mono text-muted/70 whitespace-nowrap mt-0.5 w-14 shrink-0">
        {fmtTime(event.at)}
      </span>
      {/* Kind badge */}
      <span className={clsx('rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide shrink-0 mt-0.5', kind.cls)}>
        {kind.label}
      </span>
      {/* Actor badge */}
      <span className={clsx('text-[10px] font-mono font-semibold shrink-0 w-14 mt-0.5', actorCls)}>
        {label}
      </span>
      {/* Message */}
      <span className="text-fg leading-relaxed break-words min-w-0 flex-1">{text}</span>
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatsBar({ events }: { events: RunEvent[] }) {
  const counts = events.reduce(
    (acc, e) => ({ ...acc, [e.kind]: (acc[e.kind as EventKind] ?? 0) + 1 }),
    {} as Record<EventKind, number>,
  );
  return (
    <div className="flex flex-wrap gap-3 px-4 py-2.5 bg-canvas/60 border-b border-line text-[10px] font-mono">
      {(Object.entries(KIND_STYLES) as [EventKind, { label: string; cls: string }][]).map(([k, v]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={clsx('rounded border px-1.5 py-0.5 font-semibold', v.cls)}>{v.label}</span>
          <span className="text-fg">{counts[k] ?? 0}</span>
        </span>
      ))}
      <span className="ml-auto text-muted">{events.length} total events</span>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export function BrainFeed({ agg }: { agg: RunAggregate }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const events = agg.events.slice(-80); // cap at 80 for perf

  // Auto-scroll to latest
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div className="rounded-xl border border-line bg-layer overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="h-2 w-2 rounded-full bg-bob animate-pulse" />
          <h3 className="text-sm font-semibold text-fg">Bob&apos;s Brain — Live Audit Feed</h3>
        </div>
        <span className="text-[10px] font-mono text-muted border border-line bg-canvas px-2 py-0.5 rounded">
          SSE-driven · auto-refreshes
        </span>
      </div>

      {/* Stats bar */}
      <StatsBar events={agg.events} />

      {/* Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto max-h-[420px] p-3">
        {events.length === 0 ? (
          <p className="text-sm text-muted text-center py-8 font-mono">Waiting for first event…</p>
        ) : (
          <div>
            {events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-line bg-canvas/60 px-4 py-2 flex items-center justify-between text-[10px] font-mono text-muted">
        <span>
          IBM Bob evidence standard: every event labeled OBSERVATION · INFERENCE · PROPOSAL · ACTION · VERIFICATION
        </span>
        <span>
          {agg.events.filter((e) => e.actor === 'bob').length} Bob events
          · {agg.events.filter((e) => e.actor === 'human').length} Human decisions
        </span>
      </div>
    </div>
  );
}
