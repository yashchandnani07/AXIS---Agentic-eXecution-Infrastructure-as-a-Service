/**
 * @file      apps/control-center/components/cost-estimator.tsx
 * @phase     P11+ / Extension
 * @owner     Product & Experience
 * @purpose   Interactive Multi-Cloud Cost Estimator for AXIS Control Center.
 *            Estimates real monthly cloud expenditure across IBM Cloud Code Engine and AWS Lambda,
 *            comparing always-warm vs scale-to-zero/on-demand architectures with free-tier deductions.
 * @depends   react, clsx, @bobops/core
 * @usedBy    apps/control-center/components/plan-panel.tsx
 */
'use client';

import { useId, useState } from 'react';
import type { DeploymentPlan } from '@bobops/core';

interface CostEstimatorProps {
  plan?: DeploymentPlan;
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

  const reqSliderId = useId();
  const durSliderId = useId();
  const memSelectId = useId();

  // --- Calculations ---
  // Memory in GB
  const memoryGb = memoryMb / 1024;
  const vCpu = Math.max(0.25, memoryGb * 0.5);

  // Total execution compute seconds per month
  const totalExecSeconds = (monthlyRequests * (avgDurationMs / 1000));
  const totalGbSeconds = totalExecSeconds * memoryGb;
  const totalVcpuSeconds = totalExecSeconds * vCpu;

  // 1. IBM Cloud Code Engine Pricing (us-south)
  // vCPU: $0.000034 / vCPU-sec, Memory: $0.0000045 / GB-sec
  // Free tier: 100,000 vCPU-sec and 200,000 memory GB-sec free monthly
  const ibmBillableVcpuSec = Math.max(0, totalVcpuSeconds - 100_000);
  const ibmBillableMemSec = Math.max(0, totalGbSeconds - 200_000);
  const ibmRequestActiveCost = (ibmBillableVcpuSec * 0.000034) + (ibmBillableMemSec * 0.0000045);
  // Always-on baseline (730 hours / month * 3600 sec) if min-scale: 1
  const ibmAlwaysOnBaseline = ibmScaleToZero ? 0 : (730 * 3600 * vCpu * 0.000034) + (730 * 3600 * memoryGb * 0.0000045);
  const ibmTotalMonthly = Math.max(0, ibmRequestActiveCost + ibmAlwaysOnBaseline);

  // 2. AWS Lambda Pricing (us-east-1)
  // Requests: $0.20 per 1M requests (1M free tier)
  // Compute: $0.0000166667 per GB-second (400,000 GB-seconds free tier)
  const awsBillableRequests = Math.max(0, monthlyRequests - 1_000_000);
  const awsRequestCost = (awsBillableRequests / 1_000_000) * 0.20;
  const awsBillableGbSec = Math.max(0, totalGbSeconds - 400_000);
  const awsComputeCost = awsBillableGbSec * 0.0000166667;
  // Provisioned Concurrency baseline (1 warm instance): $0.0000041667 per GB-sec * 730 hours
  const awsProvisionedBaseline = awsProvisioned ? (730 * 3600 * memoryGb * 0.0000041667) : 0;
  const awsTotalMonthly = Math.max(0, awsRequestCost + awsComputeCost + awsProvisionedBaseline);

  // Combined Multi-Cloud Total
  const totalCombinedMonthly = ibmTotalMonthly + awsTotalMonthly;

  // Comparison vs Traditional Dual Fixed Cloud VMs ($45/mo IBM VSI + $42/mo AWS EC2)
  const traditionalVmBaseline = 87.00;
  const savingsPercent = Math.max(0, Math.round(((traditionalVmBaseline - totalCombinedMonthly) / traditionalVmBaseline) * 100));

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(0)}k`;
    return num.toString();
  };

  return (
    <div className="mt-5 rounded-lg border border-line bg-canvas/80 p-4">
      <div className="flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">💰 Multi-Cloud Cost Estimator</span>
          <span className="rounded border border-ok/30 bg-ok/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-ok">
            {savingsPercent}% savings vs VMs
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="font-mono text-xs text-muted hover:text-fg transition-colors"
        >
          {isOpen ? 'Hide Controls ▲' : 'Show Estimator ▼'}
        </button>
      </div>

      {isOpen && (
        <div className="mt-4 space-y-4">
          {/* Sliders & Parameters */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
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
            </div>

            <div>
              <label htmlFor={durSliderId} className="flex justify-between text-xs text-muted">
                <span>Avg Duration</span>
                <span className="font-mono font-medium text-fg">{avgDurationMs} ms</span>
              </label>
              <input
                id={durSliderId}
                type="range"
                min="30"
                max="500"
                step="10"
                value={avgDurationMs}
                aria-label="Average Request Duration in milliseconds"
                onChange={(e) => setAvgDurationMs(Number(e.target.value))}
                className="mt-2 w-full accent-aws cursor-pointer"
              />
            </div>

            <div>
              <label htmlFor={memSelectId} className="flex justify-between text-xs text-muted">
                <span>Memory Allocation</span>
                <span className="font-mono font-medium text-fg">{memoryMb} MB</span>
              </label>
              <select
                id={memSelectId}
                value={memoryMb}
                aria-label="Memory Allocation"
                onChange={(e) => setMemoryMb(Number(e.target.value))}
                className="mt-1.5 w-full rounded border border-line bg-layer px-2.5 py-1 text-xs font-mono text-fg focus:border-ibm focus:outline-none"
              >
                <option value={256}>256 MB (0.25 vCPU)</option>
                <option value={512}>512 MB (0.25 vCPU)</option>
                <option value={1024}>1024 MB (0.50 vCPU)</option>
                <option value={2048}>2048 MB (1.00 vCPU)</option>
              </select>
            </div>
          </div>

          {/* Architecture Variant Toggles */}
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <div className="rounded border border-line bg-layer p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ibm-soft">IBM Code Engine Architecture</span>
                <button
                  type="button"
                  onClick={() => setIbmScaleToZero(!ibmScaleToZero)}
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                    ibmScaleToZero ? 'bg-info/20 text-info border border-info/40' : 'bg-ok/20 text-ok border border-ok/40'
                  }`}
                >
                  {ibmScaleToZero ? 'Scale-to-Zero (min:0)' : 'Always-Warm (min:1)'}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                {ibmScaleToZero
                  ? 'Zero baseline cost when idle. Fast cold starts for microservices.'
                  : 'Pre-warmed instance running 24/7. Eliminates cold starts completely.'}
              </p>
            </div>

            <div className="rounded border border-line bg-layer p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-aws">AWS Lambda Architecture</span>
                <button
                  type="button"
                  onClick={() => setAwsProvisioned(!awsProvisioned)}
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                    !awsProvisioned ? 'bg-info/20 text-info border border-info/40' : 'bg-ok/20 text-ok border border-ok/40'
                  }`}
                >
                  {awsProvisioned ? 'Provisioned Concurrency' : 'On-Demand Serverless'}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                {awsProvisioned
                  ? 'Maintains 1 initialized execution environment for sub-millisecond latency.'
                  : 'Pure pay-per-request model. 1M free requests and 400k GB-sec free monthly.'}
              </p>
            </div>
          </div>

          {/* Cost Output Cards */}
          <div className="grid gap-3 pt-1 sm:grid-cols-3">
            <div className="rounded border border-ibm/40 bg-ibm/5 p-3">
              <p className="text-[11px] font-medium text-ibm-soft">IBM Cloud Code Engine</p>
              <p className="mt-1 font-mono text-lg font-bold text-fg">
                ${ibmTotalMonthly.toFixed(2)}
                <span className="text-xs font-normal text-muted">/mo</span>
              </p>
              <p className="mt-0.5 text-[10px] text-muted">
                {ibmScaleToZero ? 'Includes 100k vCPU-s free tier' : 'Includes 24/7 warm container baseline'}
              </p>
            </div>

            <div className="rounded border border-aws/40 bg-aws/5 p-3">
              <p className="text-[11px] font-medium text-aws">AWS Lambda + Function URL</p>
              <p className="mt-1 font-mono text-lg font-bold text-fg">
                ${awsTotalMonthly.toFixed(2)}
                <span className="text-xs font-normal text-muted">/mo</span>
              </p>
              <p className="mt-0.5 text-[10px] text-muted">
                {awsProvisioned ? 'Includes 1 warm instance baseline' : 'Includes AWS Free Tier allowance'}
              </p>
            </div>

            <div className="rounded border border-ok/40 bg-ok/5 p-3">
              <p className="text-[11px] font-medium text-ok">Total Dual-Cloud Deployment</p>
              <p className="mt-1 font-mono text-xl font-bold text-fg">
                ${totalCombinedMonthly.toFixed(2)}
                <span className="text-xs font-normal text-muted">/mo</span>
              </p>
              <p className="mt-0.5 text-[10px] text-muted">
                vs ~${traditionalVmBaseline}/mo on fixed VMs
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
