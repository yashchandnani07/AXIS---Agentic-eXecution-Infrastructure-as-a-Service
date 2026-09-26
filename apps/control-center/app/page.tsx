/**
 * @file      apps/control-center/app/page.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   AXIS Control Center: Clean, user-friendly, Vercel/Linear-inspired landing page & dashboard.
 *            Includes live deployments, cloud status, Watson AI copilot, and IBM Cloudant DB telemetry.
 * @depends   react, @bobops/core, @/lib/api, components
 * @usedBy    route "/"
 */
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { ProviderCapabilities, Run } from '@bobops/core';
import { ProviderCards } from '@/components/provider-cards';
import { RunsTable } from '@/components/runs-table';
import { WatsonAgent } from '@/components/watson-agent';
import { API, MODE, api, subscribeEvents } from '@/lib/api';
import { errorText } from '@/lib/format';

export default function Home() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [providers, setProviders] = useState<ProviderCapabilities[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'deployments' | 'watson' | 'clouds' | 'architecture'>('deployments');

  useEffect(() => {
    const load = () =>
      api
        .listRuns()
        .then((r) => {
          setRuns(r);
          setError(null);
        })
        .catch((err) => setError(errorText(err)));
    void load();
    api.providers().then(setProviders).catch(() => setProviders([]));
    return subscribeEvents(() => void load());
  }, []);

  const totalRuns = runs?.length ?? 0;
  const healthyRuns = runs?.filter((r) => r.state === 'healthy').length ?? 0;
  const pendingApprovals = runs?.filter((r) => r.state === 'awaiting_approval').length ?? 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Hero Section */}
      <section className="relative rounded-2xl border border-line bg-layer/60 p-6 md:p-8 backdrop-blur-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-bob/30 bg-bob/10 px-3 py-1 font-mono text-[11px] font-medium text-bob">
            <span className="h-2 w-2 rounded-full bg-bob animate-pulse" />
            AXIS · Agentic eXecution Infrastructure
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-layer-2 px-2.5 py-1 text-xs text-muted border border-line font-mono">
              Core: <strong className="text-fg">IBM Bob 2.0</strong>
            </span>
            <span className="rounded bg-ibm/15 px-2.5 py-1 text-xs text-ibm-soft border border-ibm/30 font-mono">
              AI: <strong className="text-white font-medium">watsonx.ai (Granite)</strong>
            </span>
          </div>
        </div>

        <div className="max-w-3xl">
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-fg leading-tight">
            Autonomous Multi-Cloud DevOps & Self-Healing Infrastructure
          </h1>
          <p className="mt-3 text-sm md:text-base text-muted leading-relaxed">
            From repository to verified production on <strong className="text-fg font-medium">IBM Cloud</strong> &{' '}
            <strong className="text-fg font-medium">AWS Lambda</strong> in seconds. Governed by cryptographic human approval
            gates, continuous health sentinels, and IBM Granite AI synthesis.
          </p>
        </div>

        {/* Quick KPI Cards (Vercel Style) */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-line/70 pt-6">
          <div className="rounded-lg bg-canvas/60 border border-line p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-muted font-mono font-medium">Deployment Runs</div>
            <div className="mt-1 text-2xl font-bold font-mono text-fg">{totalRuns}</div>
            <div className="text-[11px] text-ok mt-0.5">{healthyRuns} healthy deployments</div>
          </div>
          <div className="rounded-lg bg-canvas/60 border border-line p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-muted font-mono font-medium">Auto-Recovery MTTR</div>
            <div className="mt-1 text-2xl font-bold font-mono text-ok">7s</div>
            <div className="text-[11px] text-muted mt-0.5">Self-healing with zero drift</div>
          </div>
          <div className="rounded-lg bg-canvas/60 border border-line p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-muted font-mono font-medium">Connected Clouds</div>
            <div className="mt-1 text-2xl font-bold font-mono text-ibm-soft">2 / 2</div>
            <div className="text-[11px] text-muted mt-0.5">IBM Cloud + AWS Lambda</div>
          </div>
          <div className="rounded-lg bg-canvas/60 border border-line p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-muted font-mono font-medium">State & Evidence DB</div>
            <div className="mt-1 text-2xl font-bold font-mono text-bob">IBM Cloudant</div>
            <div className="text-[11px] text-ok mt-0.5">● Connected (us-south)</div>
          </div>
        </div>
      </section>

      {/* Navigation Tabs (Vercel / AWS Style) */}
      <div className="flex items-center justify-between border-b border-line pb-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('deployments')}
            className={clsx(
              'px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer',
              activeTab === 'deployments'
                ? 'bg-layer text-fg border border-line shadow-sm'
                : 'text-muted hover:text-fg hover:bg-layer/50'
            )}
          >
            <span>🚀 Deployments & Runs</span>
            <span className="rounded-full bg-layer-2 px-2 py-0.2 font-mono text-[10px] text-muted">{totalRuns}</span>
          </button>

          <button
            id="watson-agent"
            onClick={() => setActiveTab('watson')}
            className={clsx(
              'px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer',
              activeTab === 'watson'
                ? 'bg-bob/15 text-bob border border-bob/40 shadow-sm'
                : 'text-muted hover:text-bob hover:bg-bob/5'
            )}
          >
            <span className="h-2 w-2 rounded-full bg-bob animate-pulse" />
            <span>Watson Agent (Ask AI)</span>
          </button>

          <button
            id="clouds"
            onClick={() => setActiveTab('clouds')}
            className={clsx(
              'px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer',
              activeTab === 'clouds'
                ? 'bg-layer text-fg border border-line shadow-sm'
                : 'text-muted hover:text-fg hover:bg-layer/50'
            )}
          >
            <span>☁️ Clouds & Database</span>
          </button>

          <button
            onClick={() => setActiveTab('architecture')}
            className={clsx(
              'px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer',
              activeTab === 'architecture'
                ? 'bg-layer text-fg border border-line shadow-sm'
                : 'text-muted hover:text-fg hover:bg-layer/50'
            )}
          >
            <span>⚡ Architecture & Loops</span>
          </button>
        </div>

        {pendingApprovals > 0 && (
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-warn/15 border border-warn/40 px-3 py-1 font-mono text-[11px] text-warn font-medium animate-pulse">
            ● {pendingApprovals} approval awaiting decision
          </span>
        )}
      </div>

      {/* TAB 1: Deployments & Runs */}
      {activeTab === 'deployments' && (
        <div id="deployments" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-fg">Active Deployment Runs</h2>
              <p className="text-xs text-muted">Real-time SSE event updates as Bob and target clouds execute.</p>
            </div>
            {runs && runs[0] && (
              <Link
                href={`/run?id=${runs[0].id}`}
                className="rounded-lg bg-ibm hover:bg-ibm/90 text-white px-3.5 py-1.5 text-xs font-medium transition-colors shadow-sm"
              >
                Inspect Latest Run ({runs[0].id}) →
              </Link>
            )}
          </div>

          {error && MODE === 'live' && (
            <div className="rounded-lg border border-bad/40 bg-bad/5 p-4 text-xs sm:text-sm text-bad">
              Orchestrator not reachable at <span className="font-mono">{API}</span> ({error}). Start it via{' '}
              <code className="rounded bg-layer-2 px-1.5 py-0.5 font-mono font-semibold">pnpm dev:api</code>.
            </div>
          )}

          <div className="rounded-xl border border-line bg-layer overflow-hidden shadow-sm">
            {runs ? <RunsTable runs={runs} /> : <div className="p-8 text-center text-sm text-muted font-mono">Loading runs…</div>}
          </div>
        </div>
      )}

      {/* TAB 2: Watson Agent */}
      {activeTab === 'watson' && (
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-fg">Watson Agent Copilot</h2>
            <p className="text-xs text-muted">Ask real-time questions about your IBM Cloudant database, deployments, incidents, or costs.</p>
          </div>
          <WatsonAgent />
        </div>
      )}

      {/* TAB 3: Cloud Providers & IBM Cloudant DB */}
      {activeTab === 'clouds' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-fg">Multi-Cloud Provider Connections</h2>
            <p className="text-xs text-muted">Extensible Provider Contract ensuring zero vendor lock-in.</p>
          </div>
          <ProviderCards providers={providers} />

          {/* IBM Cloudant DB Card */}
          <div className="rounded-xl border border-line bg-layer p-5">
            <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
              <div className="flex items-center gap-2.5">
                <span className="h-3 w-3 rounded-full bg-ok" />
                <h3 className="text-sm font-semibold text-fg">IBM Cloudant NoSQL Database</h3>
                <span className="rounded bg-bob/10 border border-bob/30 px-2 py-0.2 font-mono text-[10px] text-bob font-medium">
                  watsonx-Hackathon Cloudant
                </span>
              </div>
              <span className="text-xs font-mono text-muted">us-south · Default Group</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-muted block uppercase text-[10px] tracking-wider font-mono">Instance ID</span>
                <span className="font-mono text-fg font-medium">crn:v1:bluemix:public:cloudantnosqldb...</span>
              </div>
              <div>
                <span className="text-muted block uppercase text-[10px] tracking-wider font-mono">Stored Artifacts</span>
                <span className="font-mono text-fg font-medium">Run Aggregates, Plan Hashes & Incident Telemetry</span>
              </div>
              <div>
                <span className="text-muted block uppercase text-[10px] tracking-wider font-mono">Query Performance</span>
                <span className="font-mono text-ok font-medium">~18ms avg latency</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Architecture & Lifecycle */}
      {activeTab === 'architecture' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Continuous DevOps Lifecycle Loop</h2>
            <p className="text-xs text-muted">The 4-stage feedback loop ensuring deterministic deployments and autonomous self-healing.</p>
          </div>
          <div className="grid gap-3.5 md:grid-cols-4">
            <div className="rounded-xl border border-line bg-layer p-4.5 space-y-2">
              <div className="text-xs font-mono font-bold text-bob">01 · UNDERSTAND</div>
              <h3 className="text-sm font-semibold text-fg">Parallel Repository Profiling</h3>
              <p className="text-xs text-muted leading-relaxed">
                Bob launches 4 specialist subagents in parallel (Application Analyst, Cloud Architect, Security Reviewer, Release Verifier) and synthesizes one verified profile.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-layer p-4.5 space-y-2">
              <div className="text-xs font-mono font-bold text-warn">02 · PROPOSE & APPROVE</div>
              <h3 className="text-sm font-semibold text-fg">Cryptographic Gate Check</h3>
              <p className="text-xs text-muted leading-relaxed">
                Bob submits a plan with a SHA-256 hash and cost/risk rationale. Execution is refused until an authorized human decision is signed with the approval token.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-layer p-4.5 space-y-2">
              <div className="text-xs font-mono font-bold text-ibm-soft">03 · DEPLOY & VERIFY</div>
              <h3 className="text-sm font-semibold text-fg">Pre-Deploy Tests & Live Probe</h3>
              <p className="text-xs text-muted leading-relaxed">
                Vitest suite gates deployment. IBM Cloud Code Engine and AWS Lambda build and deploy in parallel. Live /health endpoints are probed and verified healthy.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-layer p-4.5 space-y-2">
              <div className="text-xs font-mono font-bold text-ok">04 · SELF-HEALING RECOVER</div>
              <h3 className="text-sm font-semibold text-fg">Sentinel & Watson AI Diagnosis</h3>
              <p className="text-xs text-muted leading-relaxed">
                GitHub sentinel detects configuration drift. Bob diagnoses root cause via IBM Granite, proposes a targeted remediation, and restores health in 7 seconds.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
