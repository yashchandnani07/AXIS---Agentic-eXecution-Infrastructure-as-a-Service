/**
 * @file      apps/control-center/app/run/page.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   One run, end to end: header, lifecycle, metrics, approvals, incidents, environments, plan, analysis, logs, audit.
 * @depends   next/navigation, @/lib/use-run, components
 * @usedBy    route "/run?id=<runId>[&demo=1]" (query param keeps static export simple)
 * @agentNotes Order = what needs a human first (approvals, incidents), then evidence. `demo=1` shows the fault control.
 */
'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AnalysisPanel } from '@/components/analysis-panel';
import { ApprovalQueue } from '@/components/approval-queue';
import { AuditTrail } from '@/components/audit-trail';
import { BrainFeed } from '@/components/brain-feed';
import { CostTimeline } from '@/components/cost-timeline';
import { DeploymentComparison } from '@/components/deployment-comparison';
import { DeploymentsPanel } from '@/components/deployments-panel';
import { IncidentsPanel } from '@/components/incidents-panel';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import { LogsPanel } from '@/components/logs-panel';
import { MetricsStrip } from '@/components/metrics-strip';
import { PlanPanel } from '@/components/plan-panel';
import { StateBadge } from '@/components/ui';
import { WatsonAgent } from '@/components/watson-agent';
import { useRun } from '@/lib/use-run';

export default function RunPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted font-mono">Loading run details…</p>}>
      <RunView />
    </Suspense>
  );
}

type RunTab = 'overview' | 'analytics' | 'brain';

function RunView() {
  const params = useSearchParams();
  const id = params.get('id');
  const demoFromQuery = params.get('demo') === '1';
  const [demoMode, setDemoMode] = useState<boolean>(demoFromQuery || true);
  const { data, error, refresh } = useRun(id);
  const [activeTab, setActiveTab] = useState<RunTab>('overview');

  if (!id) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-muted">
          No run selected. <Link href="/" className="text-ibm-soft hover:underline">Back to all runs</Link>
        </p>
      </div>
    );
  }
  if (error && !data) return <p className="text-sm text-bad font-mono">Could not load run {id}: {error}</p>;
  if (!data) return <p className="text-sm text-muted font-mono">Loading run {id}…</p>;

  const latest = data.events.at(-1);
  return (
    <div className="space-y-6 min-w-0 w-full">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5 min-w-0">
        <div className="min-w-0">
          <Link href="/" className="text-xs text-muted hover:text-fg font-mono inline-flex items-center gap-1 transition-colors">
            ← Back to AXIS Overview
          </Link>
          <h1 className="mt-1.5 text-2xl font-semibold text-fg flex items-center gap-3">
            <span>{data.run.projectName}</span>
            <span className="font-mono text-xs text-muted font-normal border border-line bg-layer px-2 py-0.5 rounded">{data.run.id}</span>
          </h1>
          <p className="mt-1.5 text-xs text-muted leading-relaxed break-words">
            {data.run.objective} · <span className="font-mono text-fg">{data.run.repoPath}</span> · <span className="text-fg">{data.run.targets.join(' + ')}</span>
            {' · sentinel check-in every '}
            <span className="font-mono text-fg font-medium">{data.run.sentinelIntervalMinutes} min</span>
          </p>
        </div>
        <div className="text-right flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDemoMode(!demoMode)}
              title="Toggle presenter demo controls (💥 Inject Vulnerability & Notify)"
              className={clsx(
                'px-2.5 py-1 rounded text-xs font-mono border transition-all cursor-pointer flex items-center gap-1.5',
                demoMode
                  ? 'border-bad/60 bg-bad/10 text-bad font-semibold'
                  : 'border-line bg-layer-2 text-muted hover:text-fg'
              )}
            >
              <span className={clsx('h-1.5 w-1.5 rounded-full', demoMode ? 'bg-bad animate-pulse' : 'bg-muted')} />
              💥 Demo Mode: {demoMode ? 'ON' : 'OFF'}
            </button>
            <StateBadge state={data.run.state} />
          </div>
          {latest && <p className="mt-1 max-w-md text-xs text-muted truncate">Latest: {latest.message}</p>}
        </div>
      </header>

      <LifecycleStepper agg={data} />
      <MetricsStrip agg={data} />

      {/* Tab navigation */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line pb-1 min-w-0">
        {([
          { id: 'overview',  label: '🚀 Overview',         desc: 'Approvals, deployments, plan, logs' },
          { id: 'analytics', label: '📊 Analytics',         desc: 'Cost timeline, uptime, comparison' },
          { id: 'brain',     label: '🧠 Bob\'s Brain',      desc: 'Live labelled audit event feed' },
        ] as { id: RunTab; label: string; desc: string }[]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.desc}
            className={clsx(
              'px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer',
              activeTab === tab.id
                ? 'bg-layer text-fg border border-line shadow-sm'
                : 'text-muted hover:text-fg hover:bg-layer/50',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB: Overview */}
      {activeTab === 'overview' && (
        <div className="grid gap-6 grid-cols-1 xl:grid-cols-3 min-w-0 w-full">
          <div className="space-y-6 xl:col-span-2 min-w-0 w-full">
            <ApprovalQueue agg={data} onDecided={refresh} />
            <IncidentsPanel agg={data} onChanged={refresh} />
            <DeploymentsPanel agg={data} onChanged={refresh} demo={demoMode} />
            <PlanPanel agg={data} />
            <AnalysisPanel agg={data} />
            <LogsPanel agg={data} />
          </div>
          <div className="space-y-6 xl:col-span-1 min-w-0 w-full">
            <AuditTrail agg={data} />
            <WatsonAgent runId={data.run.id} />
          </div>
        </div>
      )}

      {/* TAB: Analytics */}
      {activeTab === 'analytics' && (
        <div className="space-y-6 min-w-0 w-full">
          <CostTimeline agg={data} />
          <DeploymentComparison agg={data} />
          <div className="grid gap-6 grid-cols-1 xl:grid-cols-3 min-w-0 w-full">
            <div className="xl:col-span-2 space-y-6 min-w-0 w-full">
              <DeploymentsPanel agg={data} onChanged={refresh} demo={demoMode} />
            </div>
            <div className="xl:col-span-1 min-w-0 w-full">
              <WatsonAgent runId={data.run.id} />
            </div>
          </div>
        </div>
      )}

      {/* TAB: Bob's Brain */}
      {activeTab === 'brain' && (
        <div className="space-y-6">
          <BrainFeed agg={data} />
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <AuditTrail agg={data} />
            </div>
            <div>
              <WatsonAgent runId={data.run.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
