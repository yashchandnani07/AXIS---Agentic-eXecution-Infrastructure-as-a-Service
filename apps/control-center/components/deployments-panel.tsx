/**
 * @file      apps/control-center/components/deployments-panel.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   DEPLOY + VERIFY view: live endpoint per cloud, revision, HTTP health + latency, re-verify, demo fault control.
 * @depends   react, clsx, @bobops/core, @/lib/api, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes The ⚡ fault button only renders with ?demo=1 in LIVE mode (presenter control, human token).
 */
'use client';
import clsx from 'clsx';
import { useState } from 'react';
import type { Deployment, HealthCheck, ProviderId, RunAggregate } from '@bobops/core';
import { MODE, api } from '@/lib/api';
import { errorText, fmtTime } from '@/lib/format';
import { Panel, ProviderBadge } from './ui';

export function DeploymentsPanel({ agg, onChanged, demo }: { agg: RunAggregate; onChanged: () => void; demo: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const latest = new Map<ProviderId, Deployment>();
  for (const d of agg.deployments) latest.set(d.provider, d);
  const health = new Map<ProviderId, HealthCheck>();
  for (const h of agg.healthChecks) health.set(h.provider, h);
  if (!latest.size) return null;

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="DEPLOY + VERIFY — live environments"
      subtitle="Provider-native status plus independent HTTP health probes"
      right={
        MODE === 'live' ? (
          <button onClick={() => act('verify', () => api.verify(agg.run.id))} className="rounded border border-line-strong px-3 py-1 text-xs text-fg hover:border-ibm hover:text-ibm-soft transition-colors">
            {busy === 'verify' ? 'Verifying…' : 'Re-verify now'}
          </button>
        ) : undefined
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {[...latest.values()].map((d) => {
          const h = health.get(d.provider);
          return (
            <div key={d.provider} className={clsx('rounded-lg border bg-canvas p-4', h ? (h.ok ? 'border-ok/50' : 'border-bad/80 bg-bad/5') : 'border-line')}>
              <div className="flex items-center justify-between">
                <ProviderBadge provider={d.provider} />
                <span className={clsx('font-mono text-xs uppercase font-medium', d.status === 'succeeded' ? 'text-ok' : d.status === 'failed' ? 'text-bad' : 'text-ibm-soft')}>
                  {d.status.replace('_', ' ')}
                </span>
              </div>
              {d.endpoint && (
                <a
                  href={`${d.endpoint.replace(/\/$/, '')}${d.healthPath}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2.5 block truncate font-mono text-xs text-ibm-soft hover:underline"
                >
                  {d.endpoint}
                </a>
              )}
              <dl className="mt-3.5 grid grid-cols-3 gap-2 text-xs border-t border-line/60 pt-2.5">
                <div>
                  <dt className="text-[10px] uppercase text-muted font-medium">Revision</dt>
                  <dd className="truncate font-mono text-fg mt-0.5">{d.revision ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-muted font-medium">Health</dt>
                  <dd className={clsx('font-mono mt-0.5 font-medium', h?.ok ? 'text-ok' : 'text-bad')}>
                    {h ? (h.statusCode ? `HTTP ${h.statusCode}` : 'no response') : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-muted font-medium">Latency</dt>
                  <dd className="font-mono text-fg mt-0.5">{h ? `${h.latencyMs} ms` : '—'}</dd>
                </div>
              </dl>
              {h && <p className="mt-2 text-[10px] text-muted font-mono">probe: {fmtTime(h.checkedAt)}</p>}
              {d.error && <p className="mt-2 text-xs text-bad font-mono">{d.error}</p>}
              {d.note && <p className="mt-1 text-[10px] text-muted font-mono">last change: {d.note}</p>}
              {demo && MODE === 'live' && d.status === 'succeeded' && (
                <button
                  onClick={() => act(`fault-${d.provider}`, () => api.injectFault(agg.run.id, d.provider))}
                  className="mt-3.5 w-full rounded border border-bad/60 bg-bad/5 px-3 py-1.5 text-xs font-medium text-bad hover:bg-bad/15 active:bg-bad/20 transition-colors"
                >
                  {busy === `fault-${d.provider}` ? 'Injecting…' : '⚡ Inject controlled fault (demo)'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {message && <p className="mt-3 text-sm text-bad font-mono">{message}</p>}
    </Panel>
  );
}
