/**
 * @file      apps/control-center/components/deployment-comparison.tsx
 * @phase     P11+
 * @owner     Product & Experience
 * @purpose   Side-by-side IBM Cloud vs AWS scorecard: latency, uptime %, service type, architecture rationale,
 *            cost posture. Shows judges that two real clouds are live with genuine architectural difference.
 * @depends   react, clsx, @bobops/core
 * @usedBy    app/run/page.tsx analytics tab
 * @agentNotes If only one provider is deployed, renders a single-column "deployed" vs "not deployed" card.
 */
import clsx from 'clsx';
import { describeService, type Deployment, type HealthCheck, type ProviderId, type RunAggregate } from '@bobops/core';

interface ProviderStats {
  provider: ProviderId;
  deployment?: Deployment;
  latestHealth?: HealthCheck;
  healthHistory: HealthCheck[];
  plan?: { architectureRationale?: string; service?: string };
}

function uptimePct(history: HealthCheck[]): number | null {
  if (!history.length) return null;
  return history.filter((h) => h.ok).length / history.length;
}

function p50(latencies: number[]): number | null {
  if (!latencies.length) return null;
  const sorted = [...latencies].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.5)];
}

function StatCell({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: 'ok' | 'warn' | 'bad' | 'ibm' | 'aws' }) {
  const valueClass = {
    ok: 'text-ok',
    warn: 'text-warn',
    bad: 'text-bad',
    ibm: 'text-ibm-soft',
    aws: 'text-aws',
  }[highlight ?? 'ok'] ?? 'text-fg';

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider font-mono text-muted">{label}</span>
      <span className={clsx('text-lg font-mono font-semibold', valueClass)}>{value}</span>
      {sub && <span className="text-[10px] text-muted">{sub}</span>}
    </div>
  );
}

function ProviderCard({ stats, color }: { stats: ProviderStats; color: string }) {
  const uptime = uptimePct(stats.healthHistory);
  const latencies = stats.healthHistory.filter((h) => h.ok && h.latencyMs > 0).map((h) => h.latencyMs);
  const median = p50(latencies);
  const latest = stats.latestHealth;
  const d = stats.deployment;
  const service = d ? describeService(d.service) : null;
  const isIbm = stats.provider === 'ibm-cloud';

  const statusColor =
    latest?.ok ? 'border-ok/60 bg-ok/5' :
    latest ? 'border-bad/60 bg-bad/5' :
    'border-line bg-canvas';

  return (
    <div className={clsx('rounded-xl border p-5 space-y-4 flex-1', statusColor)}>
      {/* Provider header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-semibold text-fg">{isIbm ? 'IBM Cloud Code Engine' : 'AWS Lambda'}</span>
        </div>
        {latest && (
          <span className={clsx('text-[10px] font-mono font-medium rounded-full border px-2 py-0.5',
            latest.ok ? 'text-ok border-ok/40 bg-ok/10' : 'text-bad border-bad/40 bg-bad/10'
          )}>
            {latest.ok ? '● Live' : '● Degraded'}
          </span>
        )}
        {!latest && d && (
          <span className="text-[10px] font-mono text-muted border border-line px-2 py-0.5 rounded-full">Deploying</span>
        )}
        {!d && (
          <span className="text-[10px] font-mono text-muted border border-line px-2 py-0.5 rounded-full">Not deployed</span>
        )}
      </div>

      {/* Service type */}
      {service && (
        <div className="rounded-lg border border-line bg-canvas/60 p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={clsx('rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              service.kind === 'warm' ? 'bg-ok/15 text-ok border-ok/30' : 'bg-info/15 text-info border-info/30'
            )}>
              {service.kind === 'warm' ? '● Always warm' : '◐ Cost-optimized'}
            </span>
            <span className="text-xs font-mono text-fg">{service.label}</span>
          </div>
          <p className="text-[11px] text-muted leading-relaxed">{service.description}</p>
        </div>
      )}

      {/* Architecture rationale */}
      {stats.plan?.architectureRationale && (
        <div className="rounded border border-bob/20 bg-bob/5 p-2.5">
          <span className="text-[10px] text-bob font-semibold uppercase tracking-wider">Why Bob chose this: </span>
          <span className="text-[11px] text-fg leading-relaxed">{stats.plan.architectureRationale}</span>
        </div>
      )}

      {/* Stats grid */}
      {d && (
        <div className="grid grid-cols-3 gap-3 border-t border-line/60 pt-3">
          <StatCell
            label="Uptime"
            value={uptime !== null ? `${Math.round(uptime * 100)}%` : '—'}
            sub={`${stats.healthHistory.filter((h) => h.ok).length}/${stats.healthHistory.length} probes`}
            highlight={uptime === null ? undefined : uptime > 0.95 ? 'ok' : uptime > 0.7 ? 'warn' : 'bad'}
          />
          <StatCell
            label="P50 latency"
            value={median !== null ? `${median}ms` : '—'}
            sub={latencies.length ? `${latencies.length} samples` : 'no data'}
            highlight={median === null ? undefined : median < 100 ? 'ok' : median < 500 ? 'warn' : 'bad'}
          />
          <StatCell
            label="Last HTTP"
            value={latest?.statusCode ? `${latest.statusCode}` : '—'}
            sub={latest ? `${latest.latencyMs}ms` : undefined}
            highlight={latest?.ok ? 'ok' : latest ? 'bad' : undefined}
          />
        </div>
      )}

      {/* Endpoint */}
      {d?.endpoint && (
        <a
          href={d.endpoint}
          target="_blank"
          rel="noreferrer"
          className="block truncate font-mono text-[11px] text-ibm-soft hover:underline border-t border-line/40 pt-2"
        >
          {d.endpoint}
        </a>
      )}

      {/* Region + revision */}
      {d && (
        <div className="flex gap-4 text-[10px] font-mono text-muted">
          <span>Region: <span className="text-fg">{d.region}</span></span>
          {d.revision && <span>Rev: <span className="text-fg">{d.revision.slice(0, 16)}{d.revision.length > 16 ? '…' : ''}</span></span>}
        </div>
      )}
    </div>
  );
}

// ── Winner badge ──────────────────────────────────────────────────────────────
function WinnerBadge({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-warn/30 bg-warn/5 min-w-24">
      <span className="text-[10px] text-muted font-mono uppercase tracking-wider">Fastest</span>
      <span className="text-sm font-semibold text-warn">{label}</span>
      <span className="text-[9px] text-muted text-center leading-snug">{reason}</span>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export function DeploymentComparison({ agg }: { agg: RunAggregate }) {
  const deployed = agg.deployments.length > 0;
  if (!deployed) return null;

  // Build per-provider stats
  const statsMap = new Map<ProviderId, ProviderStats>();
  for (const provider of agg.run.targets) {
    const providerDeployments = agg.deployments.filter((d) => d.provider === provider);
    const latestDeploy = providerDeployments[providerDeployments.length - 1];
    const healthHistory = agg.healthChecks.filter((h) => h.provider === provider);
    const latestHealth = healthHistory[healthHistory.length - 1];
    const planTarget = agg.run.plan?.targets.find((t) => t.provider === provider);
    statsMap.set(provider, {
      provider,
      deployment: latestDeploy,
      latestHealth,
      healthHistory,
      plan: planTarget ? { architectureRationale: planTarget.architectureRationale, service: planTarget.service } : undefined,
    });
  }

  const all = agg.run.targets.map((p) => statsMap.get(p)!);
  const ibm = statsMap.get('ibm-cloud');
  const aws = statsMap.get('aws');

  // Winner logic
  const ibmLatency = ibm ? p50(ibm.healthHistory.filter((h) => h.ok).map((h) => h.latencyMs)) : null;
  const awsLatency = aws ? p50(aws.healthHistory.filter((h) => h.ok).map((h) => h.latencyMs)) : null;
  let winner: { label: string; reason: string } | null = null;
  if (ibmLatency !== null && awsLatency !== null) {
    if (ibmLatency < awsLatency) {
      winner = { label: 'IBM Cloud', reason: `${ibmLatency}ms vs ${awsLatency}ms` };
    } else if (awsLatency < ibmLatency) {
      winner = { label: 'AWS Lambda', reason: `${awsLatency}ms vs ${ibmLatency}ms` };
    } else {
      winner = { label: 'Tied!', reason: `Both at ${ibmLatency}ms` };
    }
  }

  return (
    <div className="rounded-xl border border-line bg-layer overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">⚡ Multi-Cloud Comparison</h3>
          <p className="text-[11px] text-muted mt-0.5">Live side-by-side performance, uptime & architecture rationale per provider</p>
        </div>
        {winner && (
          <WinnerBadge label={winner.label} reason={winner.reason} />
        )}
      </div>

      {/* Cards */}
      <div className="p-5 flex gap-4 flex-wrap">
        {all.map((s) => (
          <ProviderCard
            key={s.provider}
            stats={s}
            color={s.provider === 'ibm-cloud' ? '#78a9ff' : '#ff9900'}
          />
        ))}
      </div>

      {/* Bottom note */}
      <div className="border-t border-line bg-canvas/60 px-5 py-2.5 text-[10px] text-muted font-mono">
        Architecture choice is Bob&apos;s inference from the specialist analysis — the rationale above is Bob&apos;s actual output, not a preset.
      </div>
    </div>
  );
}
