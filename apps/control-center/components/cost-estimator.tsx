/**
 * @file      apps/control-center/components/cost-estimator.tsx
 * @phase     P11+
 * @owner     Product & Experience
 * @purpose   Interactive multi-cloud cost estimator: sliders for monthly requests, avg response time, uptime hours/day.
 *            Renders a pure-SVG horizontal bar chart comparing IBM Cloud vs AWS for every service tier.
 *            No external chart library — pure React + SVG.
 * @depends   react, clsx, @bobops/core (SERVICE_CATALOG)
 * @usedBy    app/page.tsx (💰 Cost Estimator tab)
 * @agentNotes All maths in one place (PRICING). Sliders are uncontrolled via useState; chart re-renders on every change.
 */
'use client';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { SERVICE_CATALOG } from '@bobops/core';

// ── Pricing model (demo-grade, pub 2025) ──────────────────────────────────────
const PRICING = {
  // IBM Cloud Code Engine
  'code-engine': {
    idlePerHour: 0.0069,       // always-on, 0.25 vCPU / 0.5 GB
    requestPer1M: 0,           // included in instance cost
    coldStartMs: 0,
  },
  'code-engine-scale-to-zero': {
    idlePerHour: 0,
    requestPer1M: 0.41,        // per 1M vCPU-seconds; approx at 100ms avg
    coldStartMs: 800,
  },
  // AWS Lambda
  lambda: {
    idlePerHour: 0,
    requestPer1M: 0.20,        // $0.20 / 1M invocations
    durationPer1M: 1.67,       // $1.67 per 1M GB-seconds @ 256 MB, 100ms avg
    coldStartMs: 400,
  },
  'lambda-provisioned': {
    idlePerHour: 0.0046,       // provisioned concurrency, 1 unit 256 MB
    requestPer1M: 0.20,
    durationPer1M: 0.90,       // reduced rate for provisioned
    coldStartMs: 0,
  },
} as const;

type ServiceKey = keyof typeof PRICING;

function calcMonthlyCost(service: ServiceKey, monthlyReqs: number, avgMs: number, activeHoursPerDay: number): number {
  const p = PRICING[service];
  const idleHoursPerMonth = (24 - activeHoursPerDay) * 30;
  const activeHoursPerMonth = activeHoursPerDay * 30;
  const idle = ('idlePerHour' in p ? p.idlePerHour : 0) * (activeHoursPerMonth + idleHoursPerMonth);
  const reqCost = (monthlyReqs / 1_000_000) * p.requestPer1M;
  const durCost = 'durationPer1M' in p ? ((monthlyReqs / 1_000_000) * (avgMs / 1000) * (256 / 1024)) * (p.durationPer1M / ((256 / 1024) / 1)) : 0;
  return Math.max(0, idle + reqCost + durCost);
}

// ── SVG bar chart ─────────────────────────────────────────────────────────────
interface BarEntry { label: string; cost: number; color: string; kind: 'warm' | 'cost-optimized'; service: ServiceKey }

function BarChart({ bars, max }: { bars: BarEntry[]; max: number }) {
  const W = 420;
  const rowH = 36;
  const labelW = 200;
  const barAreaW = W - labelW - 60;
  const H = bars.length * rowH + 16;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block w-full">
      {bars.map((b, i) => {
        const barW = max > 0 ? Math.max(2, (b.cost / max) * barAreaW) : 2;
        const y = i * rowH + 8;
        const isCheapest = b.cost === Math.min(...bars.map((x) => x.cost));
        return (
          <g key={b.service}>
            {/* Label */}
            <text x={0} y={y + 14} fontSize={10} fill="#a8a8a8" fontFamily="IBM Plex Mono, monospace">
              {b.label.length > 28 ? b.label.slice(0, 26) + '…' : b.label}
            </text>
            {/* Bar */}
            <rect x={labelW} y={y + 2} width={barW} height={20} rx={3} fill={b.color} opacity={0.75} />
            {/* Cost label */}
            <text
              x={labelW + barW + 6}
              y={y + 16}
              fontSize={11}
              fontFamily="IBM Plex Mono, monospace"
              fontWeight="600"
              fill={b.color}
            >
              ${b.cost < 0.01 ? '<0.01' : b.cost < 1 ? b.cost.toFixed(3) : b.cost.toFixed(2)}
            </text>
            {/* Cheapest badge */}
            {isCheapest && (
              <text x={labelW + barW + 50} y={y + 16} fontSize={9} fill="#42be65" fontFamily="IBM Plex Mono, monospace">
                ← cheapest
              </text>
            )}
            {/* Kind dot */}
            <circle
              cx={labelW - 8}
              cy={y + 12}
              r={4}
              fill={b.kind === 'warm' ? '#42be65' : '#4589ff'}
              opacity={0.8}
            />
          </g>
        );
      })}
    </svg>
  );
}

// ── Slider ────────────────────────────────────────────────────────────────────
function Slider({ label, min, max, step, value, onChange, format }: {
  label: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void; format: (v: number) => string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted uppercase tracking-wider font-mono">{label}</label>
        <span className="text-sm font-semibold font-mono text-fg">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-layer-2 accent-ibm"
      />
      <div className="flex justify-between text-[9px] text-muted font-mono">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

// ── Cold start badge ──────────────────────────────────────────────────────────
function ColdStartBadge({ ms }: { ms: number }) {
  if (ms === 0) return <span className="text-[10px] text-ok font-mono">No cold starts</span>;
  return <span className="text-[10px] text-warn font-mono">~{ms}ms cold start</span>;
}

// ── Main component ─────────────────────────────────────────────────────────────
export function CostEstimator() {
  const [monthlyReqs, setMonthlyReqs] = useState(500_000);     // 500K req/month
  const [avgMs, setAvgMs] = useState(120);                      // 120ms avg duration
  const [activeHours, setActiveHours] = useState(8);           // 8 active hours/day

  const bars = useMemo<BarEntry[]>(() => {
    return SERVICE_CATALOG.map((s) => {
      const serviceKey = s.service as ServiceKey;
      const cost = calcMonthlyCost(serviceKey, monthlyReqs, avgMs, activeHours);
      return {
        label: s.label,
        cost,
        color: s.provider === 'ibm-cloud' ? '#78a9ff' : '#ff9900',
        kind: s.kind,
        service: serviceKey,
      };
    }).sort((a, b) => a.cost - b.cost);
  }, [monthlyReqs, avgMs, activeHours]);

  const maxCost = Math.max(...bars.map((b) => b.cost), 0.01);
  const cheapest = bars[0];
  const ibmBars = bars.filter((b) => b.service.startsWith('code-engine'));
  const awsBars = bars.filter((b) => b.service.startsWith('lambda'));
  const cheapestIbm = ibmBars.sort((a, b) => a.cost - b.cost)[0];
  const cheapestAws = awsBars.sort((a, b) => a.cost - b.cost)[0];

  const fmtReqs = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-line bg-layer overflow-hidden">
        <div className="border-b border-line px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-fg flex items-center gap-2">
              💰 Multi-Cloud Cost Estimator
              <span className="text-[10px] font-mono text-muted bg-layer-2 border border-line px-2 py-0.5 rounded">IBM Cloud + AWS</span>
            </h2>
            <p className="text-[11px] text-muted mt-0.5">
              Drag sliders to model your workload. Costs update live across all 4 architecture tiers.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-3 text-[11px] font-mono">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-ok" /> Always warm</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-info" /> Cost-optimized</span>
          </div>
        </div>

        {/* Sliders */}
        <div className="px-6 py-5 grid gap-6 md:grid-cols-3 border-b border-line bg-canvas/40">
          <Slider
            label="Monthly Requests"
            min={10_000}
            max={10_000_000}
            step={10_000}
            value={monthlyReqs}
            onChange={setMonthlyReqs}
            format={fmtReqs}
          />
          <Slider
            label="Avg Response Time"
            min={20}
            max={2000}
            step={10}
            value={avgMs}
            onChange={setAvgMs}
            format={(v) => `${v}ms`}
          />
          <Slider
            label="Active Hours / Day"
            min={1}
            max={24}
            step={1}
            value={activeHours}
            onChange={setActiveHours}
            format={(v) => `${v}h`}
          />
        </div>

        {/* Bar chart */}
        <div className="px-6 py-5">
          <div className="mb-3 text-[10px] uppercase tracking-wider text-muted font-mono font-medium">
            Estimated monthly cost — all 4 architecture tiers
          </div>
          <BarChart bars={bars} max={maxCost} />
        </div>

        {/* Summary cards */}
        <div className="border-t border-line px-6 py-4 grid grid-cols-2 gap-4 md:grid-cols-4 bg-canvas/60">
          {bars.map((b) => (
            <div
              key={b.service}
              className={clsx(
                'rounded-lg border p-3 space-y-1.5 transition-all',
                b.service === cheapest.service
                  ? 'border-ok/50 bg-ok/5 ring-1 ring-ok/20'
                  : 'border-line bg-layer',
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[9px] font-mono font-semibold uppercase tracking-wider"
                  style={{ color: b.color }}
                >
                  {b.service.startsWith('code') ? 'IBM Cloud' : 'AWS Lambda'}
                </span>
                {b.service === cheapest.service && (
                  <span className="text-[9px] font-mono text-ok border border-ok/30 bg-ok/10 px-1.5 py-0.5 rounded">BEST</span>
                )}
              </div>
              <div
                className={clsx('text-xl font-mono font-bold')}
                style={{ color: b.color }}
              >
                ${b.cost < 0.01 ? '<0.01' : b.cost < 1 ? b.cost.toFixed(3) : b.cost.toFixed(2)}
                <span className="text-[10px] text-muted font-normal">/mo</span>
              </div>
              <div className="text-[10px] text-muted leading-snug">{b.label.split('—')[1]?.trim() ?? b.label}</div>
              <ColdStartBadge ms={PRICING[b.service].coldStartMs ?? 0} />
            </div>
          ))}
        </div>
      </div>

      {/* Recommendation box */}
      <div className="rounded-xl border border-bob/30 bg-bob/5 px-6 py-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="h-2 w-2 rounded-full bg-bob animate-pulse" />
          <span className="text-xs font-semibold text-bob uppercase tracking-wider font-mono">IBM Bob · Architecture Recommendation</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-[10px] text-muted uppercase tracking-wider font-mono">IBM Cloud — Bob would choose</div>
            <div className="text-sm font-semibold text-fg">{cheapestIbm?.label ?? '—'}</div>
            <div className="text-xs text-muted leading-relaxed">
              {cheapestIbm?.kind === 'warm'
                ? 'Always-on container with min-scale 1. No cold starts, predictable latency — ideal for latency-sensitive or high-traffic workloads.'
                : 'Scale-to-zero container. Scales down when idle, eliminating idle compute cost — ideal for infrequent or demo-grade traffic.'}
            </div>
            <div className="text-sm font-mono font-bold mt-1" style={{ color: '#78a9ff' }}>
              ${cheapestIbm?.cost.toFixed(2) ?? '—'}/mo
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] text-muted uppercase tracking-wider font-mono">AWS Lambda — Bob would choose</div>
            <div className="text-sm font-semibold text-fg">{cheapestAws?.label ?? '—'}</div>
            <div className="text-xs text-muted leading-relaxed">
              {cheapestAws?.kind === 'warm'
                ? 'Provisioned concurrency — warm instances always ready. Zero cold starts at the cost of idle capacity charges.'
                : 'On-demand Lambda. Pay per invocation only — $0 at zero traffic. Possible cold starts on first request after idle.'}
            </div>
            <div className="text-sm font-mono font-bold mt-1" style={{ color: '#ff9900' }}>
              ${cheapestAws?.cost.toFixed(2) ?? '—'}/mo
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-bob/20 text-[11px] text-muted leading-relaxed">
          Bob makes this exact choice during <span className="text-bob font-medium">UNDERSTAND → PLAN</span> using the
          cloud-architect specialist finding: it reads the deployment objective, traffic pattern, and latency requirements,
          then picks from <span className="font-mono text-fg">SERVICE_CATALOG</span> with a cited{' '}
          <span className="font-mono text-fg">architectureRationale</span>.{' '}
          <span className="text-bob">This estimator mirrors that logic in real-time.</span>
        </div>
      </div>

      {/* Pricing footnote */}
      <p className="text-[10px] text-muted font-mono text-center">
        Estimates based on IBM Cloud Code Engine (0.25 vCPU, 0.5 GB) and AWS Lambda (256 MB, {avgMs}ms avg duration) public pricing.
        Actual costs vary by region, data transfer, and build minutes. IBM Cloud includes 1 vCPU-hour/day free tier.
      </p>
    </div>
  );
}
