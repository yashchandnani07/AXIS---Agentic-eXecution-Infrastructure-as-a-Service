/**
 * @file      apps/control-center/components/cost-estimator.tsx
 * @phase     P11+ / Extension
 * @owner     Product & Experience
 * @purpose   Interactive Multi-Cloud Cost Estimator for AXIS Control Center.
 *            Estimates real monthly cloud expenditure across IBM Cloud Code Engine and AWS Lambda,
 *            comparing always-warm vs scale-to-zero/on-demand architectures with free-tier deductions,
 *            SVG horizontal tier visualization, and traditional VM savings analysis.
 * @depends   react, clsx, @bobops/core
 * @usedBy    apps/control-center/components/plan-panel.tsx, apps/control-center/app/page.tsx
 */
'use client';

import clsx from 'clsx';
import { useId, useMemo, useState } from 'react';
import type { DeploymentPlan } from '@bobops/core';

interface CostEstimatorProps {
  plan?: DeploymentPlan;
}

// ── SVG Bar Chart Entry ───────────────────────────────────────────────────────
interface BarEntry {
  label: string;
  cost: number;
  color: string;
  kind: 'warm' | 'cost-optimized';
  tierKey: string;
}

function SvgTierChart({ bars, max }: { bars: BarEntry[]; max: number }) {
  const W = 420;
  const rowH = 34;
  const labelW = 180;
  const barAreaW = W - labelW - 75;
  const H = bars.length * rowH + 16;
  const minCost = Math.min(...bars.map((x) => x.cost));

  return (
    <div className="w-full overflow-x-auto min-w-0 py-1">
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full min-w-[340px] max-w-full"
        preserveAspectRatio="xMinYMid meet"
      >
        {bars.map((b, i) => {
          const barW = max > 0 ? Math.max(3, (b.cost / max) * barAreaW) : 3;
          const y = i * rowH + 8;
          const isCheapest = b.cost === minCost;
          return (
            <g key={b.tierKey}>
              {/* Label */}
              <text x={12} y={y + 14} fontSize={10} fill="#94a3b8" fontFamily="IBM Plex Mono, monospace">
                {b.label.length > 25 ? b.label.slice(0, 23) + '…' : b.label}
              </text>
              {/* Kind dot */}
              <circle
                cx={4}
                cy={y + 11}
                r={3}
                fill={b.kind === 'warm' ? '#22c55e' : '#38bdf8'}
                opacity={0.85}
              />
              {/* Bar */}
              <rect x={labelW} y={y + 2} width={barW} height={18} rx={3} fill={b.color} opacity={0.8} />
              {/* Cost label */}
              <text
                x={labelW + barW + 6}
                y={y + 15}
                fontSize={10.5}
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="600"
                fill={b.color}
              >
                ${b.cost < 0.01 ? '<0.01' : b.cost.toFixed(2)}/mo
              </text>
              {/* Cheapest badge */}
              {isCheapest && (
                <text x={labelW + barW + 60} y={y + 15} fontSize={8.5} fill="#22c55e" fontFamily="IBM Plex Mono, monospace">
                  ← best
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function CostEstimator({ plan }: CostEstimatorProps) {
  // Initial architecture detection from plan if available
  const initialIbmScaleToZero = plan?.targets.some((t) => t.provider === 'ibm-cloud' && t.service === 'code-engine-scale-to-zero') ?? true;
  const initialAwsProvisioned = plan?.targets.some((t) => t.provider === 'aws' && t.service === 'lambda-provisioned') ?? false;

  const [monthlyRequests, setMonthlyRequests] = useState<number>(500_000);
  const [avgDurationMs, setAvgDurationMs] = useState<number>(120);
  const [memoryMb, setMemoryMb] = useState<number>(512);
  const [ibmScaleToZero, setIbmScaleToZero] = useState<boolean>(initialIbmScaleToZero);
  const [awsProvisioned, setAwsProvisioned] = useState<boolean>(initialAwsProvisioned);
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [showTierBreakdown, setShowTierBreakdown] = useState<boolean>(true);

  const reqSliderId = useId();
  const durSliderId = useId();
  const memSelectId = useId();

  // --- Calculations ---
  // Memory in GB
  const memoryGb = memoryMb / 1024;
  const vCpu = Math.max(0.25, memoryGb * 0.5);

  // Total execution compute seconds per month
  const totalExecSeconds = monthlyRequests * (avgDurationMs / 1000);
  const totalGbSeconds = totalExecSeconds * memoryGb;
  const totalVcpuSeconds = totalExecSeconds * vCpu;

  // 1. IBM Cloud Code Engine Pricing (us-south)
  // vCPU: $0.000034 / vCPU-sec, Memory: $0.0000045 / GB-sec
  // Free tier: 100,000 vCPU-sec and 200,000 memory GB-sec free monthly
  const ibmBillableVcpuSec = Math.max(0, totalVcpuSeconds - 100_000);
  const ibmBillableMemSec = Math.max(0, totalGbSeconds - 200_000);
  const ibmRequestActiveCost = ibmBillableVcpuSec * 0.000034 + ibmBillableMemSec * 0.0000045;
  // Always-on baseline (730 hours / month * 3600 sec) if min-scale: 1
  const ibmAlwaysOnBaseline = ibmScaleToZero ? 0 : 730 * 3600 * vCpu * 0.000034 + 730 * 3600 * memoryGb * 0.0000045;
  const ibmTotalMonthly = Math.max(0, ibmRequestActiveCost + ibmAlwaysOnBaseline);

  // Alternative IBM cost for tier comparison
  const ibmScaleToZeroCost = Math.max(0, ibmRequestActiveCost);
  const ibmAlwaysWarmCost = Math.max(0, ibmRequestActiveCost + (730 * 3600 * vCpu * 0.000034 + 730 * 3600 * memoryGb * 0.0000045));

  // 2. AWS Lambda Pricing (us-east-1)
  // Requests: $0.20 per 1M requests (1M free tier)
  // Compute: $0.0000166667 per GB-second (400,000 GB-seconds free tier)
  const awsBillableRequests = Math.max(0, monthlyRequests - 1_000_000);
  const awsRequestCost = (awsBillableRequests / 1_000_000) * 0.20;
  const awsBillableGbSec = Math.max(0, totalGbSeconds - 400_000);
  const awsComputeCost = awsBillableGbSec * 0.0000166667;
  // Provisioned Concurrency baseline (1 warm instance): $0.0000041667 per GB-sec * 730 hours
  const awsProvisionedBaseline = awsProvisioned ? 730 * 3600 * memoryGb * 0.0000041667 : 0;
  const awsTotalMonthly = Math.max(0, awsRequestCost + awsComputeCost + awsProvisionedBaseline);

  // Alternative AWS cost for tier comparison
  const awsOnDemandCost = Math.max(0, awsRequestCost + awsComputeCost);
  const awsProvisionedCost = Math.max(0, awsRequestCost + awsComputeCost + (730 * 3600 * memoryGb * 0.0000041667));

  // Combined Multi-Cloud Total
  const totalCombinedMonthly = ibmTotalMonthly + awsTotalMonthly;

  // Comparison vs Traditional Dual Fixed Cloud VMs ($45/mo IBM VSI + $42/mo AWS EC2)
  const traditionalVmBaseline = 87.0;
  const savingsPercent = Math.max(0, Math.round(((traditionalVmBaseline - totalCombinedMonthly) / traditionalVmBaseline) * 100));

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(0)}k`;
    return num.toString();
  };

  // 4 Tiers Comparison for SVG Bar Chart
  const tierBars = useMemo<BarEntry[]>(() => {
    return [
      {
        label: 'IBM Code Engine (Scale-to-Zero)',
        cost: ibmScaleToZeroCost,
        color: '#60a5fa',
        kind: 'cost-optimized' as const,
        tierKey: 'ibm-stz',
      },
      {
        label: 'IBM Code Engine (Always-Warm)',
        cost: ibmAlwaysWarmCost,
        color: '#3b82f6',
        kind: 'warm' as const,
        tierKey: 'ibm-warm',
      },
      {
        label: 'AWS Lambda (On-Demand)',
        cost: awsOnDemandCost,
        color: '#f59e0b',
        kind: 'cost-optimized' as const,
        tierKey: 'aws-ondemand',
      },
      {
        label: 'AWS Lambda (Provisioned)',
        cost: awsProvisionedCost,
        color: '#d97706',
        kind: 'warm' as const,
        tierKey: 'aws-prov',
      },
    ].sort((a, b) => a.cost - b.cost);
  }, [ibmScaleToZeroCost, ibmAlwaysWarmCost, awsOnDemandCost, awsProvisionedCost]);

  const maxTierCost = Math.max(...tierBars.map((b) => b.cost), 0.01);

  return (
    <div className={clsx('rounded-xl border border-line bg-canvas/80 p-5 shadow-sm w-full max-w-full min-w-0 overflow-hidden', plan ? 'mt-5' : 'space-y-6')}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3.5 min-w-0">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span className="text-sm font-semibold text-fg flex items-center gap-1.5">
            <span>💰</span> Multi-Cloud Cost Estimator
          </span>
          <span className="rounded border border-ok/30 bg-ok/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-ok">
            {savingsPercent}% savings vs fixed VMs
          </span>
          <span className="rounded border border-line bg-layer-2 px-2 py-0.5 font-mono text-[10px] text-muted">
            IBM Cloud + AWS
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowTierBreakdown(!showTierBreakdown)}
            className="text-[11px] font-mono text-muted hover:text-fg transition-colors cursor-pointer"
          >
            {showTierBreakdown ? 'Hide SVG Chart ▲' : 'Show SVG Chart ▼'}
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="font-mono text-xs text-muted hover:text-fg transition-colors cursor-pointer"
          >
            {isOpen ? 'Collapse Controls ▲' : 'Expand Controls ▼'}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="mt-4 space-y-5 min-w-0">
          {/* Sliders & Parameters */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-3 min-w-0">
            <div className="min-w-0">
              <label htmlFor={reqSliderId} className="flex justify-between text-xs text-muted">
                <span>Monthly Invocations</span>
                <span className="font-mono font-medium text-fg">{formatNumber(monthlyRequests)} req</span>
              </label>
              <input
                id={reqSliderId}
                type="range"
                min="50000"
                max="5000000"
                step="50000"
                value={monthlyRequests}
                aria-label="Monthly Invocations"
                onChange={(e) => setMonthlyRequests(Number(e.target.value))}
                className="mt-2 w-full accent-ibm cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-muted font-mono mt-1">
                <span>50k</span>
                <span>5M</span>
              </div>
            </div>

            <div className="min-w-0">
              <label htmlFor={durSliderId} className="flex justify-between text-xs text-muted">
                <span>Avg Duration</span>
                <span className="font-mono font-medium text-fg">{avgDurationMs} ms</span>
              </label>
              <input
                id={durSliderId}
                type="range"
                min="30"
                max="1000"
                step="10"
                value={avgDurationMs}
                aria-label="Average Request Duration in milliseconds"
                onChange={(e) => setAvgDurationMs(Number(e.target.value))}
                className="mt-2 w-full accent-aws cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-muted font-mono mt-1">
                <span>30ms</span>
                <span>1000ms</span>
              </div>
            </div>

            <div className="min-w-0">
              <label htmlFor={memSelectId} className="flex justify-between text-xs text-muted">
                <span>Memory Allocation</span>
                <span className="font-mono font-medium text-fg">{memoryMb} MB</span>
              </label>
              <select
                id={memSelectId}
                value={memoryMb}
                aria-label="Memory Allocation"
                onChange={(e) => setMemoryMb(Number(e.target.value))}
                className="mt-1.5 w-full rounded border border-line bg-layer px-2.5 py-1.5 text-xs font-mono text-fg focus:border-ibm focus:outline-none"
              >
                <option value={256}>256 MB (0.25 vCPU)</option>
                <option value={512}>512 MB (0.25 vCPU)</option>
                <option value={1024}>1024 MB (0.50 vCPU)</option>
                <option value={2048}>2048 MB (1.00 vCPU)</option>
              </select>
              <p className="text-[10px] text-muted mt-1 font-mono">{(memoryGb * 0.5).toFixed(2)} vCPU provisioned</p>
            </div>
          </div>

          {/* Architecture Variant Toggles */}
          <div className="grid gap-3 pt-1 grid-cols-1 md:grid-cols-2 min-w-0">
            <div className="rounded-lg border border-line bg-layer p-3.5 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ibm-soft">IBM Code Engine Architecture</span>
                <button
                  type="button"
                  onClick={() => setIbmScaleToZero(!ibmScaleToZero)}
                  className={`rounded px-2.5 py-1 font-mono text-[10px] font-semibold transition-colors cursor-pointer ${
                    ibmScaleToZero ? 'bg-info/20 text-info border border-info/40' : 'bg-ok/20 text-ok border border-ok/40'
                  }`}
                >
                  {ibmScaleToZero ? 'Scale-to-Zero (min:0)' : 'Always-Warm (min:1)'}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted leading-relaxed">
                {ibmScaleToZero
                  ? 'Zero baseline cost when idle. Fast cold starts for microservices.'
                  : 'Pre-warmed instance running 24/7. Eliminates cold starts completely for critical traffic.'}
              </p>
            </div>

            <div className="rounded-lg border border-line bg-layer p-3.5 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-aws">AWS Lambda Architecture</span>
                <button
                  type="button"
                  onClick={() => setAwsProvisioned(!awsProvisioned)}
                  className={`rounded px-2.5 py-1 font-mono text-[10px] font-semibold transition-colors cursor-pointer ${
                    !awsProvisioned ? 'bg-info/20 text-info border border-info/40' : 'bg-ok/20 text-ok border border-ok/40'
                  }`}
                >
                  {awsProvisioned ? 'Provisioned Concurrency' : 'On-Demand Serverless'}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted leading-relaxed">
                {awsProvisioned
                  ? 'Maintains 1 initialized execution environment for sub-millisecond latency.'
                  : 'Pure pay-per-request model. 1M free requests and 400k GB-sec free monthly.'}
              </p>
            </div>
          </div>

          {/* Cost Output Cards */}
          <div className="grid gap-3.5 pt-1 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
            <div className="rounded-xl border border-ibm/40 bg-ibm/5 p-4 transition-all min-w-0">
              <p className="text-[11px] font-medium text-ibm-soft">IBM Cloud Code Engine</p>
              <p className="mt-1 font-mono text-xl font-bold text-fg">
                ${ibmTotalMonthly.toFixed(2)}
                <span className="text-xs font-normal text-muted">/mo</span>
              </p>
              <p className="mt-1 text-[10px] text-muted">
                {ibmScaleToZero ? 'Includes 100k vCPU-s free tier' : 'Includes 24/7 warm container baseline'}
              </p>
            </div>

            <div className="rounded-xl border border-aws/40 bg-aws/5 p-4 transition-all min-w-0">
              <p className="text-[11px] font-medium text-aws">AWS Lambda + Function URL</p>
              <p className="mt-1 font-mono text-xl font-bold text-fg">
                ${awsTotalMonthly.toFixed(2)}
                <span className="text-xs font-normal text-muted">/mo</span>
              </p>
              <p className="mt-1 text-[10px] text-muted">
                {awsProvisioned ? 'Includes 1 warm instance baseline' : 'Includes AWS Free Tier allowance'}
              </p>
            </div>

            <div className="rounded-xl border border-ok/40 bg-ok/5 p-4 transition-all min-w-0 sm:col-span-2 lg:col-span-1">
              <p className="text-[11px] font-medium text-ok">Total Dual-Cloud Deployment</p>
              <p className="mt-1 font-mono text-2xl font-bold text-fg">
                ${totalCombinedMonthly.toFixed(2)}
                <span className="text-xs font-normal text-muted">/mo</span>
              </p>
              <p className="mt-1 text-[10px] text-muted">
                vs ~${traditionalVmBaseline}/mo on fixed VMs ({savingsPercent}% saved)
              </p>
            </div>
          </div>

          {/* SVG Tier Breakdown Visualization */}
          {showTierBreakdown && (
            <div className="rounded-xl border border-line bg-layer/60 p-4 w-full min-w-0 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3 min-w-0">
                <span className="text-[11px] uppercase tracking-wider text-muted font-mono font-medium">
                  Architecture Tier Comparison (Live Model)
                </span>
                <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-muted">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-ok" /> Always warm</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-info" /> Cost-optimized</span>
                </div>
              </div>
              <SvgTierChart bars={tierBars} max={maxTierCost} />
            </div>
          )}

          {/* Bob AI Architectural Rationale Explanation */}
          <div className="rounded-lg border border-bob/30 bg-bob/5 p-3 text-[11px] text-muted leading-relaxed">
            <span className="font-semibold text-bob">How IBM Bob Decides: </span>
            During <span className="text-bob font-medium">UNDERSTAND → PLAN</span>, Bob&apos;s cloud-architect specialist
            analyzes your traffic patterns, memory requirements, and cold start tolerance to select either{' '}
            <span className="font-mono text-fg">Always-Warm</span> or{' '}
            <span className="font-mono text-fg">Scale-to-Zero / On-Demand</span> with a schema-validated rationale.
          </div>
        </div>
      )}
    </div>
  );
}
