/**
 * @file      apps/control-center/components/lifecycle-stepper.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   The 8-stage lifecycle bar (PRD §3). Stage done = at least one event of that stage; current = stage of run state.
 * @depends   clsx, @bobops/core (LIFECYCLE_STAGES, stageForEvent, stageForState)
 * @usedBy    app/run/page.tsx
 * @agentNotes RECOVER shows "standby" until an incident exists — recovery is a stage, not the product's identity.
 */
import clsx from 'clsx';
import { LIFECYCLE_STAGES, stageForEvent, stageForState, type RunAggregate } from '@bobops/core';

export function LifecycleStepper({ agg }: { agg: RunAggregate }) {
  const reached = new Set(agg.events.map((e) => stageForEvent(e.type)).filter(Boolean));
  const current = stageForState(agg.run.state);
  const settled = agg.run.state === 'healthy';
  const failed = agg.run.state === 'failed' || agg.run.state === 'incident';
  const recovered = agg.incidents.some((i) => i.status === 'resolved');

  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-8">
      {LIFECYCLE_STAGES.map((stage, i) => {
        const isCurrent = stage === current && !settled;
        const done = reached.has(stage) && !isCurrent;
        const label =
          stage === 'RECOVER' && recovered ? 'recovered ✓' : isCurrent ? (failed ? 'attention' : 'in progress') : done ? 'done' : stage === 'RECOVER' ? 'standby' : 'pending';
        return (
          <li
            key={stage}
            className={clsx(
              'rounded-lg border bg-layer px-3 py-2.5 transition-colors',
              isCurrent ? (failed ? 'border-bad/80 text-bad bg-bad/5' : 'border-ibm text-ibm-soft bg-ibm/5') : done ? 'border-ok/40 text-ok bg-ok/5' : 'border-line text-muted',
            )}
          >
            <div className="font-mono text-[10px] opacity-60">{String(i + 1).padStart(2, '0')}</div>
            <div className="text-xs font-semibold tracking-wider text-fg">{stage}</div>
            <div className={clsx('mt-1 text-[10px] font-mono', isCurrent && !failed && 'animate-pulse font-medium text-ibm-soft')}>{label}</div>
          </li>
        );
      })}
    </ol>
  );
}
