/**
 * @file      apps/control-center/components/ui.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Shared visual primitives: Panel, StateBadge, KindChip, ActorBadge, ProviderBadge, SeverityDot.
 * @depends   clsx, @bobops/core (types)
 * @usedBy    all components
 * @agentNotes Colour semantics: purple=Bob, blue=IBM Cloud, orange=AWS, green=verified, red=incident, yellow=needs human.
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { Actor, EventKind, ProviderId, RunState, Severity } from '@bobops/core';

export function Panel({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-layer shadow-sm">
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-fg">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {right}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

const STATE_TONE: Record<RunState, string> = {
  created: 'bg-layer-2 text-fg border border-line',
  analyzed: 'bg-info/10 text-info border border-info/30',
  awaiting_approval: 'bg-warn/10 text-warn border border-warn/30',
  approved: 'bg-info/10 text-info border border-info/30',
  rejected: 'bg-bad/10 text-bad border border-bad/30',
  deploying: 'bg-ibm/20 text-ibm-soft border border-ibm/40',
  verifying: 'bg-ibm/20 text-ibm-soft border border-ibm/40',
  healthy: 'bg-ok/10 text-ok border border-ok/30',
  failed: 'bg-bad/10 text-bad border border-bad/30',
  incident: 'bg-bad/10 text-bad border border-bad/30',
  awaiting_remediation_approval: 'bg-warn/10 text-warn border border-warn/30',
  remediating: 'bg-ibm/20 text-ibm-soft border border-ibm/40',
};

export function StateBadge({ state }: { state: RunState }) {
  return <span className={clsx('rounded px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide', STATE_TONE[state])}>{state.replace(/_/g, ' ')}</span>;
}

const KIND_TONE: Record<EventKind, string> = {
  observation: 'border-info/40 text-info bg-info/5',
  inference: 'border-bob/40 text-bob bg-bob/5',
  proposal: 'border-warn/40 text-warn bg-warn/5',
  action: 'border-ibm-soft/40 text-ibm-soft bg-ibm/5',
  verification: 'border-ok/40 text-ok bg-ok/5',
};

export function KindChip({ kind }: { kind: EventKind }) {
  return <span className={clsx('rounded border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider', KIND_TONE[kind])}>{kind}</span>;
}

const ACTOR: Record<Actor, { label: string; cls: string }> = {
  bob: { label: '◆ IBM Bob', cls: 'bg-bob/15 text-bob border border-bob/30' },
  human: { label: '● Developer', cls: 'bg-layer-2 text-fg border border-line' },
  orchestrator: { label: '▣ Orchestrator', cls: 'bg-layer-2 text-muted border border-line' },
  sentinel: { label: '⏱ GitHub Sentinel', cls: 'bg-warn/15 text-warn border border-warn/30' },
  'provider:ibm-cloud': { label: 'IBM Cloud', cls: 'bg-ibm/20 text-ibm-soft border border-ibm/30' },
  'provider:aws': { label: 'AWS', cls: 'bg-aws/15 text-aws border border-aws/30' },
};

export function ActorBadge({ actor }: { actor: Actor }) {
  const a = ACTOR[actor];
  return <span className={clsx('rounded px-1.5 py-px text-[10px] font-medium font-mono', a.cls)}>{a.label}</span>;
}

const PROVIDER: Record<ProviderId, { label: string; dot: string }> = {
  'ibm-cloud': { label: 'IBM Cloud', dot: 'bg-ibm' },
  aws: { label: 'AWS', dot: 'bg-aws' },
};

export function ProviderBadge({ provider }: { provider: ProviderId }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold">
      <span className={clsx('h-2.5 w-2.5 rounded-full', PROVIDER[provider].dot)} />
      {PROVIDER[provider].label}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: Severity }) {
  const tone = severity === 'high' ? 'bg-bad' : severity === 'medium' ? 'bg-warn' : 'bg-ok';
  return <span className={clsx('mr-1.5 inline-block h-2 w-2 rounded-full align-middle', tone)} title={severity} />;
}
