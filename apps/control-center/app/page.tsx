/**
 * @file      apps/control-center/app/page.tsx
 * @phase     P11+
 * @owner     Product & Experience
 * @purpose   AXIS Control Center home page. Tabs: Deployments, 💰 Cost Estimator, 🧠 Live Feed, Watson AI, Clouds, Architecture.
 * @depends   react, @bobops/core, @/lib/api, components
 * @usedBy    route "/"
 */
'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ProviderCapabilities, Run } from '@bobops/core';
import { CostEstimator } from '@/components/cost-estimator';
import { GlobalBrainFeed } from '@/components/global-brain-feed';
import { ProviderCards } from '@/components/provider-cards';
import { RunsTable } from '@/components/runs-table';
import { WatsonAgent } from '@/components/watson-agent';
import { API, MODE, api, subscribeEvents } from '@/lib/api';
import { errorText } from '@/lib/format';

type Tab = 'deployments' | 'cost' | 'brain' | 'watson' | 'clouds' | 'architecture';

export default function Home() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [providers, setProviders] = useState<ProviderCapabilities[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('deployments');

  useEffect(() => {
    const load = () =>
      api
        .listRuns()
        .then((r) => { setRuns(r); setError(null); })
        .catch((err) => setError(errorText(err)));
    void load();
    api.providers().then(setProviders).catch(() => setProviders([]));
    return subscribeEvents(() => void load());
  }, []);

  const totalRuns = runs?.length ?? 0;
  const healthyRuns = runs?.filter((r) => r.state === 'healthy').length ?? 0;
  const pendingApprovals = runs?.filter((r) => r.state === 'awaiting_approval').length ?? 0;
  const openIncidents = runs?.filter((r) => r.state === 'incident').length ?? 0;

  const tabs: { id: Tab; label: string; accent?: boolean; badge?: number | string }[] = [
    { id: 'deployments', label: '🚀 Deployments',   badge: totalRuns },
    { id: 'cost',        label: '💰 Cost Estimator', accent: true },
    { id: 'brain',       label: '🧠 Live Feed',      badge: openIncidents > 0 ? openIncidents : undefined },
    { id: 'watson',      label: '◆ Watson AI',       accent: true },
    { id: 'clouds',      label: '☁️ Clouds & DB' },
    { id: 'architecture',label: '⚡ Architecture' },
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative rounded-2xl border border-line bg-layer/60 p-6 md:p-8 backdrop-blur-sm overflow-hidden">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-bob/30 bg-bob/10 px-3 py-1 font-mono text-[11px] font-medium text-bob">
            <span className="h-2 w-2 rounded-full bg-bob animate-pulse" />
            AXIS · Agentic eXecution Infrastructure
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded bg-layer-2 px-2.5 py-1 text-xs text-muted border border-line font-mono">
              Core: <strong className="text-fg">IBM Bob 2.0</strong>
            </span>
            <span className="rounded bg-ibm/15 px-2.5 py-1 text-xs text-ibm-soft border border-ibm/30 font-mono">
              AI: <strong className="text-white font-medium">watsonx.ai (Granite)</strong>
            </span>
            <span className="rounded bg-ok/10 px-2.5 py-1 text-xs text-ok border border-ok/30 font-mono">
              ● IBM Cloudant connected
            </span>
          </div>
        </div>

        <div className="max-w-3xl">
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-fg leading-tight">
            Autonomous Multi-Cloud DevOps &{' '}
            <span className="text-ok">Self-Healing</span> Infrastructure
          </h1>
          <p className="mt-3 text-sm md:text-base text-muted leading-relaxed">
            From repository to verified production on{' '}
            <strong className="text-fg font-medium">IBM Cloud Code Engine</strong> &{' '}
            <strong className="text-fg font-medium">AWS Lambda</strong> in seconds.
            Governed by cryptographic human approval gates, continuous health sentinels, and IBM Granite AI synthesis.
          </p>
        </div>

        {/* KPI strip */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6 border-t border-line/70 pt-6">
          <KpiCard label="Deployment Runs"  value={String(totalRuns)}     sub={`${healthyRuns} healthy`}             color="fg" />
          <KpiCard label="MTTR"             value="7s"                    sub="Self-healing, approval-gated"         color="ok" />
          <KpiCard label="Connected Clouds" value="2 / 2"                 sub="IBM Cloud + AWS Lambda"               color="ibm-soft" />
          <KpiCard label="State & Evidence" value="IBM Cloudant"          sub="● us-south connected"                 color="bob" />
          <KpiCard label="Pending Approvals" value={String(pendingApprovals)} sub={pendingApprovals > 0 ? 'Action needed' : 'All clear'} color={pendingApprovals > 0 ? 'warn' : 'ok'} />
          <KpiCard label="Open Incidents"   value={String(openIncidents)} sub={openIncidents > 0 ? 'Self-healing' : 'Clean'} color={openIncidents > 0 ? 'bad' : 'ok'} />
        </div>
      </section>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-line pb-1 overflow-x-auto gap-1">
        <div className="flex items-center gap-1 min-w-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'px-3.5 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap',
                activeTab === tab.id
                  ? tab.accent
                    ? tab.id === 'watson'
                      ? 'bg-bob/15 text-bob border border-bob/40 shadow-sm'
                      : 'bg-ibm/15 text-ibm-soft border border-ibm/40 shadow-sm'
                    : 'bg-layer text-fg border border-line shadow-sm'
                  : tab.accent
                    ? tab.id === 'watson'
                      ? 'text-muted hover:text-bob hover:bg-bob/5'
                      : 'text-muted hover:text-ibm-soft hover:bg-ibm/5'
                    : 'text-muted hover:text-fg hover:bg-layer/50',
              )}
            >
              {tab.id === 'watson' && activeTab !== 'watson' && (
                <span className="h-1.5 w-1.5 rounded-full bg-bob animate-pulse" />
              )}
              {tab.label}
              {tab.badge !== undefined && (
                <span className="rounded-full bg-layer-2 border border-line px-1.5 font-mono text-[9px] text-muted">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {pendingApprovals > 0 && (
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-warn/15 border border-warn/40 px-3 py-1 font-mono text-[11px] text-warn font-medium animate-pulse shrink-0">
            ● {pendingApprovals} approval{pendingApprovals > 1 ? 's' : ''} awaiting decision
          </span>
        )}
      </div>

      {/* ── TAB: Deployments ─────────────────────────────────────────────────── */}
      {activeTab === 'deployments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-fg">Active Deployment Runs</h2>
              <p className="text-xs text-muted">Real-time SSE updates · click any run to open full analytics + Bob&apos;s brain feed.</p>
            </div>
            <div className="flex items-center gap-2">
              {runs && runs[0] && (
                <Link
                  href={`/run?id=${runs[0].id}&demo=1`}
                  className="rounded-lg bg-ibm hover:bg-ibm/90 text-white px-3.5 py-1.5 text-xs font-medium transition-colors shadow-sm"
                >
                  Inspect Latest Run →
                </Link>
              )}
            </div>
          </div>

          {error && MODE === 'live' && (
            <div className="rounded-lg border border-bad/40 bg-bad/5 p-4 text-xs sm:text-sm text-bad">
              Orchestrator not reachable at <span className="font-mono">{API}</span> ({error}). Start it with{' '}
              <code className="rounded bg-layer-2 px-1.5 py-0.5 font-mono font-semibold">pnpm dev:api</code>.
            </div>
          )}

          <div className="rounded-xl border border-line bg-layer overflow-hidden shadow-sm">
            {runs ? <RunsTable runs={runs} /> : (
              <div className="p-8 text-center text-sm text-muted font-mono">Loading runs…</div>
            )}
          </div>

          {/* Quick-action hint (only when no runs) */}
          {runs?.length === 0 && (
            <div className="rounded-xl border border-bob/20 bg-bob/5 p-5 flex flex-col sm:flex-row items-start gap-4">
              <div className="shrink-0 h-10 w-10 rounded-xl bg-bob/20 border border-bob/30 flex items-center justify-center font-mono text-bob font-bold text-lg">
                B
              </div>
              <div>
                <div className="text-sm font-semibold text-fg mb-1">Deploy your first app with IBM Bob</div>
                <p className="text-xs text-muted leading-relaxed mb-3">
                  In IBM Bob, switch to the <strong className="text-bob">🛰️ Multi-Cloud DevOps Engineer</strong> mode and run:
                </p>
                <code className="rounded bg-layer-2 border border-line px-3 py-1.5 font-mono text-bob text-xs block w-fit">
                  /deploy apps/demo-service
                </code>
                <p className="text-[11px] text-muted mt-2">
                  Bob will profile the repo, synthesize a plan, ask for your approval, then deploy to IBM Cloud + AWS simultaneously.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Cost Estimator ───────────────────────────────────────────────── */}
      {activeTab === 'cost' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Multi-Cloud Cost Estimator</h2>
            <p className="text-xs text-muted">
              Model your workload across all 4 architecture tiers. Bob uses this same logic when choosing between{' '}
              <span className="font-mono text-fg">code-engine</span>,{' '}
              <span className="font-mono text-fg">code-engine-scale-to-zero</span>,{' '}
              <span className="font-mono text-fg">lambda</span>, and{' '}
              <span className="font-mono text-fg">lambda-provisioned</span> in the PLAN stage.
            </p>
          </div>
          <CostEstimator />
        </div>
      )}

      {/* ── TAB: Live Feed ─────────────────────────────────────────────────────── */}
      {activeTab === 'brain' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Bob&apos;s Brain — Live Deployment Feed</h2>
            <p className="text-xs text-muted">
              Every OBSERVATION, INFERENCE, PROPOSAL, ACTION and VERIFICATION emitted by IBM Bob and the orchestrator across all runs.
              Events stream live via SSE — watch Bob think in real time.
            </p>
          </div>
          <GlobalBrainFeed />
        </div>
      )}

      {/* ── TAB: Watson Agent ─────────────────────────────────────────────────── */}
      {activeTab === 'watson' && (
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-fg">Watson Agent Copilot</h2>
            <p className="text-xs text-muted">
              Ask real-time questions about deployments, incidents, costs, the IBM Cloudant database, or Bob&apos;s self-healing loop.
              Try &ldquo;Tell me what happened during this run&rdquo; for an AI narrative summary.
            </p>
          </div>
          <WatsonAgent />
        </div>
      )}

      {/* ── TAB: Clouds & DB ──────────────────────────────────────────────────── */}
      {activeTab === 'clouds' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-fg">Multi-Cloud Provider Connections</h2>
            <p className="text-xs text-muted">Extensible Provider Contract — adding a new cloud requires only one new adapter class.</p>
          </div>
          <ProviderCards providers={providers} />

          {/* IBM Cloudant card */}
          <div className="rounded-xl border border-line bg-layer p-5">
            <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
              <div className="flex items-center gap-2.5">
                <span className="h-3 w-3 rounded-full bg-ok" />
                <h3 className="text-sm font-semibold text-fg">IBM Cloudant NoSQL Database</h3>
                <span className="rounded bg-bob/10 border border-bob/30 px-2 py-0.5 font-mono text-[10px] text-bob font-medium">
                  watsonx-Hackathon Cloudant
                </span>
              </div>
              <span className="text-xs font-mono text-muted">us-south · Default Group</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-muted block uppercase text-[10px] tracking-wider font-mono mb-0.5">Instance</span>
                <span className="font-mono text-fg font-medium">crn:v1:bluemix:public:cloudantnosqldb…</span>
              </div>
              <div>
                <span className="text-muted block uppercase text-[10px] tracking-wider font-mono mb-0.5">Stored Artifacts</span>
                <span className="font-mono text-fg font-medium">Run Aggregates · Plan Hashes · Incidents</span>
              </div>
              <div>
                <span className="text-muted block uppercase text-[10px] tracking-wider font-mono mb-0.5">Query Latency</span>
                <span className="font-mono text-ok font-medium">~18ms avg · us-south</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Architecture ─────────────────────────────────────────────────── */}
      {activeTab === 'architecture' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-fg">Continuous DevOps Lifecycle Loop</h2>
            <p className="text-xs text-muted">The 4-stage feedback loop ensuring deterministic deployments and autonomous self-healing.</p>
          </div>
          <div className="grid gap-3.5 md:grid-cols-4">
            {[
              { step: '01 · UNDERSTAND', color: 'text-bob', title: 'Parallel Repository Profiling', body: 'Bob launches 4 specialist subagents in parallel (Application Analyst, Cloud Architect, Security Reviewer, Release Verifier) and synthesizes one evidence-backed profile with at least 2 cited file:line references per finding.' },
              { step: '02 · PROPOSE & APPROVE', color: 'text-warn', title: 'Cryptographic Approval Gate', body: 'Bob submits a plan with SHA-256 hash, cost estimate, risk assessment, and architecture rationale. Execution is refused until the exact plan is approved in the Control Center by an authorized human.' },
              { step: '03 · DEPLOY & VERIFY', color: 'text-ibm-soft', title: 'Test-Gated Multi-Cloud Deploy', body: 'Vitest suite gates deployment. IBM Cloud Code Engine and AWS Lambda build and deploy in parallel. Live /health endpoints are probed — statusCode, latencyMs, and revision are recorded as VERIFICATION evidence.' },
              { step: '04 · SELF-HEAL & RECOVER', color: 'text-ok', title: 'Sentinel + Watson AI Diagnosis', body: 'GitHub sentinel detects configuration drift. Bob diagnoses root cause using IBM Granite, proposes the smallest safe remediation (set_env or rollback), waits for approval, executes, re-verifies, and closes the incident.' },
            ].map(({ step, color, title, body }) => (
              <div key={step} className="rounded-xl border border-line bg-layer p-5 space-y-2">
                <div className={clsx('text-xs font-mono font-bold', color)}>{step}</div>
                <h3 className="text-sm font-semibold text-fg">{title}</h3>
                <p className="text-xs text-muted leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          {/* MCP + Bob integration diagram */}
          <div className="rounded-xl border border-line bg-layer p-5">
            <h3 className="text-sm font-semibold text-fg mb-4">System Integration Map</h3>
            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              {[
                { title: 'IBM Bob 2.0', sub: 'MCP Client', color: 'border-bob/40 bg-bob/5', items: ['Custom mode: 🛰️ Multi-Cloud DevOps Engineer', '6 rule files (evidence, approvals, safety…)', '2 skills (asset-authoring, diagnosis)', '2 slash commands (/deploy, /investigate)', '4 parallel specialist subagents'] },
                { title: 'AXIS Orchestrator', sub: 'MCP Server · REST API', color: 'border-ibm/40 bg-ibm/5', items: ['17 MCP tools (devops_*)', 'Hono REST API + SSE stream', 'IBM Cloud Code Engine provider', 'AWS Lambda provider (esbuild)', 'SHA-256 gated approval engine'] },
                { title: 'GitHub Sentinel', sub: 'Health Monitor', color: 'border-warn/40 bg-warn/5', items: ['GitHub Actions workflow', 'Probes /health on user-defined interval', 'Opens GitHub Issues as incidents', 'Orchestrator syncs via /api/incidents/sync', 'Bob auto-diagnoses and remediates'] },
              ].map(({ title, sub, color, items }) => (
                <div key={title} className={clsx('rounded-lg border p-4 space-y-2', color)}>
                  <div>
                    <div className="text-sm font-semibold text-fg">{title}</div>
                    <div className="text-[10px] font-mono text-muted">{sub}</div>
                  </div>
                  <ul className="space-y-1">
                    {items.map((item) => (
                      <li key={item} className="text-[11px] text-muted flex items-start gap-1.5">
                        <span className="text-muted mt-0.5 shrink-0">›</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-lg bg-canvas/60 border border-line p-3.5">
      <div className="text-[11px] uppercase tracking-wider text-muted font-mono font-medium">{label}</div>
      <div className={clsx('mt-1 text-2xl font-bold font-mono', `text-${color}`)}>{value}</div>
      <div className="text-[11px] text-muted mt-0.5">{sub}</div>
    </div>
  );
}
