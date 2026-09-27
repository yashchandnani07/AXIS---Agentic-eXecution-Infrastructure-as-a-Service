/**
 * @file      apps/control-center/components/cost-timeline.tsx
 * @phase     P11+
 * @owner     Product & Experience
 * @purpose   Cost & uptime timeline: SVG sparkline of health probes over time + per-provider cost accrual.
 *            Shows judges at a glance the deployment lifespan and self-healing recovery dip.
 * @depends   react, @bobops/core (types)
 * @usedBy    analytics-tab in app/run/page.tsx
 * @agentNotes Pure SVG — no external chart dependency. Cost model is linear ($5/month IBM, $0.20/million req AWS).
 */
'use client';
import { useMemo } from 'react';
import type { Deployment, HealthCheck, Incident, ProviderId, RunAggregate } from '@bobops/core';

// ── Cost constants (demo-grade estimates) ─────────────────────────────────────
const HOURLY: Record<string, number> = {
  'code-engine': 0.0069,               // ~$5/month always-on
  'code-engine-scale-to-zero': 0.0028, // ~$2/month scale-to-zero
  lambda: 0.0001,                      // micro — pay per request, near zero idle
  'lambda-provisioned': 0.0046,        // ~$3.30/month provisioned concurrency
};

interface TimePoint {
  t: number;
  ok: boolean;
  latencyMs: number;
}

interface ProviderSeries {
  provider: ProviderId;
  service: string;
  label: string;
  color: string;
  points: TimePoint[];
  deployment?: Deployment;
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
const W = 520;
const H = 64;
const PAD = { l: 6, r: 6, t: 8, b: 8 };

function sparkline(points: TimePoint[], minT: number, maxT: number, maxLatency: number): string {
  if (points.length < 2) return '';
  const xs = points.map((p) => PAD.l + ((p.t - minT) / (maxT - minT)) * (W - PAD.l - PAD.r));
  const ys = points.map((p) => PAD.t + ((1 - p.latencyMs / Math.max(maxLatency, 1)) * (H - PAD.t - PAD.b)));
  return points.map((_, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
}

function uptimeBars(
  points: TimePoint[],
  minT: number,
  maxT: number,
  color: string,
  incidentRanges: Array<{ from: number; to: number }>,
): React.ReactNode {
  const span = maxT - minT || 1;
  // Segment into windows of ~6px width
  const segCount = Math.floor((W - PAD.l - PAD.r) / 6);
  const segMs = span / segCount;
  const segments = Array.from({ length: segCount }, (_, i) => {
    const from = minT + i * segMs;
    const to = from + segMs;
    const inWindow = points.filter((p) => p.t >= from && p.t < to);
    const inIncident = incidentRanges.some((r) => r.from < to && r.to > from);
    if (inWindow.length === 0 && !inIncident) return null;
    const okRatio = inWindow.length ? inWindow.filter((p) => p.ok).length / inWindow.length : (inIncident ? 0 : 1);
    return { i, okRatio, inIncident };
  });

  return segments.map((seg) => {
    if (!seg) return null;
    const x = PAD.l + seg.i * 6;
    const barH = 10;
    const y = H - PAD.b - barH;
    const fill = seg.inIncident ? '#fa4d56' : seg.okRatio > 0.8 ? color : seg.okRatio > 0.4 ? '#f1c21b' : '#fa4d56';
    const opacity = seg.inIncident ? 0.9 : 0.7 + seg.okRatio * 0.3;
    return <rect key={seg.i} x={x} y={y} width={5} height={barH} rx={1} fill={fill} opacity={opacity} />;
  });
}

// ── Cost accrual line (normalized cumulative cost) ────────────────────────────
function costLine(deployment: Deployment | undefined, service: string, minT: number, maxT: number): string {
  if (!deployment) return '';
  const startMs = Date.parse(deployment.startedAt);
  const endMs = deployment.finishedAt ? Date.parse(deployment.finishedAt) : maxT;
  const hourly = HOURLY[service] ?? 0.004;
  const totalHours = (endMs - startMs) / 3_600_000;
  const totalCost = totalHours * hourly;
  if (totalCost <= 0) return '';
  // 10 interpolated points
  return Array.from({ length: 11 }, (_, i) => {
    const frac = i / 10;
    const t = startMs + frac * (endMs - startMs);
    const cost = frac * totalCost;
    const x = PAD.l + Math.min(1, (t - minT) / Math.max(maxT - minT, 1)) * (W - PAD.l - PAD.r);
    // cost line sits in upper 40% of chart
    const y = PAD.t + (1 - Math.min(cost / (totalCost || 1), 1)) * ((H - PAD.t - PAD.b) * 0.4);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function computeCost(deployment: Deployment | undefined, service: string, nowMs: number): string {
  if (!deployment) return '—';
  const startMs = Date.parse(deployment.startedAt);
  const endMs = deployment.finishedAt ? Date.parse(deployment.finishedAt) : nowMs;
  const hours = Math.max(0, (endMs - startMs) / 3_600_000);
  const cost = hours * (HOURLY[service] ?? 0.004);
  return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(3)}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ── Main component ─────────────────────────────────────────────────────────────
export function CostTimeline({ agg }: { agg: RunAggregate }) {
  const now = Date.now();

  const series = useMemo<ProviderSeries[]>(() => {
    const latestDeploy = new Map<ProviderId, Deployment>();
    for (const d of agg.deployments) latestDeploy.set(d.provider, d);

    const result: ProviderSeries[] = [];
    for (const provider of agg.run.targets) {
      const d = latestDeploy.get(provider);
      const checks = agg.healthChecks.filter((h) => h.provider === provider);
      const points: TimePoint[] = checks.map((h) => ({
        t: Date.parse(h.checkedAt),
        ok: h.ok,
        latencyMs: h.latencyMs,
      }));
      points.sort((a, b) => a.t - b.t);
      result.push({
        provider,
        service: d?.service ?? (provider === 'ibm-cloud' ? 'code-engine' : 'lambda'),
        label: provider === 'ibm-cloud' ? 'IBM Cloud' : 'AWS Lambda',
        color: provider === 'ibm-cloud' ? '#78a9ff' : '#ff9900',
        points,
        deployment: d,
      });
    }
    return result;
  }, [agg]);

  if (!series.some((s) => s.points.length > 0) && !series.some((s) => s.deployment)) {
    return (
      <div className="rounded-xl border border-line bg-layer p-5 text-sm text-muted text-center font-mono">
        No deployment telemetry yet — data appears once the first health probe runs.
      </div>
    );
  }

  const allTimes = series.flatMap((s) => s.points.map((p) => p.t));
  for (const s of series) {
    if (s.deployment) allTimes.push(Date.parse(s.deployment.startedAt));
    if (s.deployment?.finishedAt) allTimes.push(Date.parse(s.deployment.finishedAt));
  }
  allTimes.push(now);

  const minT = Math.min(...allTimes);
  const maxT = Math.max(...allTimes);
  const maxLatency = Math.max(...series.flatMap((s) => s.points.map((p) => p.latencyMs)), 500);

  // Incident ranges
  const incidentRanges = agg.incidents.map((i) => ({
    from: Date.parse(i.openedAt),
    to: i.resolvedAt ? Date.parse(i.resolvedAt) : now,
  }));

  // Time axis labels (4 labels)
  const timeLabels = [0, 0.33, 0.66, 1].map((frac) => {
    const t = new Date(minT + frac * (maxT - minT));
    return { frac, label: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
  });

  return (
    <div className="rounded-xl border border-line bg-layer overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">📊 Cost & Uptime Timeline</h3>
          <p className="text-[11px] text-muted mt-0.5">Health probe history · cost accrual · incident windows · per provider</p>
        </div>
        <div className="flex gap-3 text-[11px] font-mono text-muted">
          {incidentRanges.length > 0 && (
            <span className="flex items-center gap-1 text-bad">
              <span className="inline-block w-3 h-2 rounded-sm bg-bad opacity-70" />
              {incidentRanges.length} incident window{incidentRanges.length > 1 ? 's' : ''}
            </span>
          )}
          <span className="flex items-center gap-1 text-ok">
            <span className="inline-block w-3 h-1.5 rounded-sm bg-ok opacity-70" />
            healthy
          </span>
          <span className="flex items-center gap-1 text-ibm-soft">
            <span className="inline-block w-3 h-px border-t border-ibm-soft border-dashed" />
            latency
          </span>
        </div>
      </div>

      {/* Per-provider chart rows */}
      <div className="divide-y divide-line">
        {series.map((s) => {
          const uptimePct = s.points.length
            ? s.points.filter((p) => p.ok).length / s.points.length
            : s.deployment?.status === 'succeeded' ? 1 : 0;
          const avgLatency = s.points.length
            ? Math.round(s.points.reduce((a, p) => a + p.latencyMs, 0) / s.points.length)
            : null;
          const cost = computeCost(s.deployment, s.service, now);
          const line = sparkline(s.points, minT, maxT, maxLatency);
          const cLine = costLine(s.deployment, s.service, minT, maxT);

          return (
            <div key={s.provider} className="px-5 py-4">
              {/* Row header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-sm font-semibold text-fg">{s.label}</span>
                  <span className="text-[10px] font-mono text-muted border border-line bg-layer-2 px-1.5 py-0.5 rounded">
                    {s.service}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-muted">
                    Uptime: <strong className={uptimePct > 0.95 ? 'text-ok' : uptimePct > 0.7 ? 'text-warn' : 'text-bad'}>
                      {s.points.length ? pct(uptimePct) : '—'}
                    </strong>
                  </span>
                  <span className="text-muted">
                    Avg latency: <strong className="text-fg">{avgLatency !== null ? `${avgLatency}ms` : '—'}</strong>
                  </span>
                  <span className="text-muted">
                    Cost accrued: <strong className="text-warn">{cost}</strong>
                  </span>
                </div>
              </div>

              {/* SVG chart */}
              <div className="relative rounded-lg bg-canvas border border-line/50 overflow-hidden">
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-16">
                  {/* Incident bands */}
                  {incidentRanges.map((r, idx) => {
                    const x1 = PAD.l + ((r.from - minT) / (maxT - minT)) * (W - PAD.l - PAD.r);
                    const x2 = PAD.l + ((r.to - minT) / (maxT - minT)) * (W - PAD.l - PAD.r);
                    return (
                      <rect key={idx} x={x1} y={0} width={Math.max(x2 - x1, 2)} height={H} fill="#fa4d56" opacity={0.08} />
                    );
                  })}
                  {/* Grid lines */}
                  {[0.25, 0.5, 0.75].map((f) => (
                    <line
                      key={f}
                      x1={PAD.l + f * (W - PAD.l - PAD.r)}
                      y1={PAD.t}
                      x2={PAD.l + f * (W - PAD.l - PAD.r)}
                      y2={H - PAD.b}
                      stroke="#393939"
                      strokeWidth={0.5}
                    />
                  ))}
                  {/* Uptime bars */}
                  {uptimeBars(s.points, minT, maxT, s.color, incidentRanges)}
                  {/* Cost accrual line (dashed) */}
                  {cLine && (
                    <path d={cLine} fill="none" stroke={s.color} strokeWidth={1} strokeDasharray="3 2" opacity={0.5} />
                  )}
                  {/* Latency sparkline */}
                  {line && (
                    <path d={line} fill="none" stroke={s.color} strokeWidth={1.5} opacity={0.85} />
                  )}
                  {/* Latest point dot */}
                  {s.points.length > 0 && (() => {
                    const last = s.points[s.points.length - 1];
                    const x = PAD.l + ((last.t - minT) / (maxT - minT)) * (W - PAD.l - PAD.r);
                    const y = PAD.t + ((1 - last.latencyMs / Math.max(maxLatency, 1)) * (H - PAD.t - PAD.b));
                    return <circle cx={x} cy={y} r={3} fill={s.color} opacity={0.9} />;
                  })()}
                </svg>
              </div>

              {/* Time axis */}
              <div className="mt-1 flex justify-between text-[9px] text-muted font-mono px-1">
                {timeLabels.map(({ frac, label }) => (
                  <span key={frac}>{label}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cost summary footer */}
      <div className="border-t border-line bg-canvas/60 px-5 py-3 flex flex-wrap items-center gap-6">
        <div className="text-[11px] text-muted uppercase tracking-wider font-mono font-medium">Cost Summary</div>
        {series.map((s) => (
          <div key={s.provider} className="flex items-center gap-2 text-xs font-mono">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-muted">{s.label}</span>
            <span className="text-warn font-medium">{computeCost(s.deployment, s.service, now)}</span>
            <span className="text-muted text-[10px]">
              (est. ${((HOURLY[s.service] ?? 0.004) * 720).toFixed(2)}/mo if live 24/7)
            </span>
          </div>
        ))}
        {agg.run.plan?.estimatedMonthlyCostUsd !== undefined && (
          <div className="ml-auto text-xs font-mono text-muted">
            Plan estimate: <span className="text-warn font-semibold">${agg.run.plan.estimatedMonthlyCostUsd}/mo</span>
          </div>
        )}
      </div>
    </div>
  );
}
