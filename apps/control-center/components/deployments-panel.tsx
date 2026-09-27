/**
 * @file      apps/control-center/components/deployments-panel.tsx
 * @phase     P11 (extended P11+)
 * @owner     Product & Experience
 * @purpose   DEPLOY + VERIFY view: live endpoint per cloud, revision, HTTP health + latency, re-verify,
 *            and the 💥 "Inject Vulnerability & Notify" demo control that triggers fault injection,
 *            AI analysis via IBM Granite, and a Resend incident email — all in one button press.
 * @depends   react, clsx, @bobops/core, @/lib/api, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes The collapse button only renders with ?demo=1 in LIVE mode (presenter control, human token).
 *             The result card stays visible until the next action so judges can read the email content.
 */
'use client';
import clsx from 'clsx';
import { useState } from 'react';
import type { Deployment, HealthCheck, ProviderId, RunAggregate } from '@bobops/core';
import { type CollapseResult, MODE, api } from '@/lib/api';
import { errorText, fmtTime } from '@/lib/format';
import { Panel, ProviderBadge } from './ui';

export function DeploymentsPanel({ agg, onChanged, demo }: { agg: RunAggregate; onChanged: () => void; demo: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [collapseResult, setCollapseResult] = useState<CollapseResult | null>(null);

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

  async function doCollapse(provider: ProviderId) {
    setBusy(`collapse-${provider}`);
    setMessage(null);
    setCollapseResult(null);
    try {
      const result = await api.collapse(agg.run.id, provider);
      setCollapseResult(result);
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
          <button
            onClick={() => act('verify', () => api.verify(agg.run.id))}
            className="rounded border border-line-strong px-3 py-1 text-xs text-fg hover:border-ibm hover:text-ibm-soft transition-colors cursor-pointer"
          >
            {busy === 'verify' ? 'Verifying…' : 'Re-verify now'}
          </button>
        ) : undefined
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {[...latest.values()].map((d) => {
          const h = health.get(d.provider);
          const isCollapsing = busy === `collapse-${d.provider}`;
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

              {/* 💥 Collapse button — only in demo + live mode */}
              {demo && MODE === 'live' && d.status === 'succeeded' && (
                <button
                  onClick={() => doCollapse(d.provider)}
                  disabled={isCollapsing}
                  className={clsx(
                    'mt-3.5 w-full rounded border px-3 py-2 text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2',
                    isCollapsing
                      ? 'border-bad/40 bg-bad/5 text-bad/60 cursor-not-allowed'
                      : 'border-bad/60 bg-bad/5 text-bad hover:bg-bad/15 hover:border-bad active:scale-[0.99]',
                  )}
                >
                  {isCollapsing ? (
                    <>
                      <span className="h-3 w-3 rounded-full border-2 border-bad/40 border-t-bad animate-spin" />
                      Injecting vulnerability + probing + composing AI alert…
                    </>
                  ) : (
                    <>
                      💥 Inject Vulnerability &amp; Notify
                      <span className="text-[9px] font-mono text-bad/70 border border-bad/30 px-1.5 py-0.5 rounded">DEMO</span>
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {message && <p className="mt-3 text-sm text-bad font-mono">{message}</p>}

      {/* Collapse result card */}
      {collapseResult && <CollapseResultCard result={collapseResult} onDismiss={() => setCollapseResult(null)} />}
    </Panel>
  );
}

// ── Collapse result card ──────────────────────────────────────────────────────
function CollapseResultCard({ result, onDismiss }: { result: CollapseResult; onDismiss: () => void }) {
  const providerLabel = result.provider === 'ibm-cloud' ? 'IBM Cloud Code Engine' : 'AWS Lambda';
  const providerColor = result.provider === 'ibm-cloud' ? 'text-ibm-soft' : 'text-aws';

  return (
    <div className="mt-5 rounded-xl border border-bad/40 bg-bad/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-bad/30 bg-bad/10">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-bad animate-pulse" />
          <span className="text-sm font-semibold text-bad">💥 Vulnerability Injected</span>
          <span className={clsx('text-xs font-mono font-semibold', providerColor)}>{providerLabel}</span>
        </div>
        <button
          onClick={onDismiss}
          className="text-muted hover:text-fg text-xs font-mono border border-line px-2 py-0.5 rounded transition-colors cursor-pointer"
        >
          dismiss
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* Probe result */}
        {result.probe && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded border border-line bg-canvas p-3">
              <div className="text-[9px] uppercase tracking-wider font-mono text-muted mb-1">HTTP Status</div>
              <div className={clsx('text-xl font-mono font-bold', result.probe.ok ? 'text-ok' : 'text-bad')}>
                {result.probe.statusCode || 'ERR'}
              </div>
            </div>
            <div className="rounded border border-line bg-canvas p-3">
              <div className="text-[9px] uppercase tracking-wider font-mono text-muted mb-1">Latency</div>
              <div className="text-xl font-mono font-bold text-fg">{result.probe.latencyMs}ms</div>
            </div>
            <div className="rounded border border-line bg-canvas p-3">
              <div className="text-[9px] uppercase tracking-wider font-mono text-muted mb-1">Fault</div>
              <div className="text-sm font-mono font-bold text-bad">{result.key} removed</div>
            </div>
          </div>
        )}

        {/* Root cause */}
        <div className="rounded border border-bad/30 bg-bad/5 p-3.5">
          <div className="text-[10px] uppercase tracking-wider font-mono text-bad font-semibold mb-2">Root Cause</div>
          <p className="text-xs text-fg leading-relaxed">{result.rootCause.replace(/\*\*/g, '')}</p>
        </div>

        {/* AI Narrative */}
        <div className="rounded border border-bob/30 bg-bob/5 p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase tracking-wider font-mono text-bob font-semibold">◆ IBM Granite Analysis (watsonx.ai)</span>
          </div>
          <p className="text-xs text-fg/90 leading-relaxed whitespace-pre-line">{result.narrative.replace(/\*\*/g, '')}</p>
        </div>

        {/* Email status */}
        <div className={clsx(
          'rounded border p-3.5',
          result.email.sent ? 'border-ok/40 bg-ok/5' : result.email.skipped ? 'border-line bg-canvas' : 'border-warn/40 bg-warn/5',
        )}>
          <div className="flex items-center gap-2 mb-2">
            <span className={clsx('text-[10px] uppercase tracking-wider font-mono font-semibold',
              result.email.sent ? 'text-ok' : result.email.skipped ? 'text-muted' : 'text-warn',
            )}>
              {result.email.sent ? '✉ Email Alert Sent' : result.email.skipped ? '✉ Email Not Configured' : '✉ Email Failed'}
            </span>
          </div>
          {result.email.sent && (
            <p className="text-xs text-muted">
              Sent to: <span className="font-mono text-fg">{result.email.to.join(', ')}</span>
            </p>
          )}
          {result.email.skipped && (
            <p className="text-xs text-muted">
              Set <code className="font-mono text-fg">RESEND_API_KEY</code> and <code className="font-mono text-fg">RESEND_TO</code> in <code className="font-mono text-fg">.env</code> to enable email alerts.
            </p>
          )}
          <p className="mt-1.5 text-[11px] font-mono text-muted italic truncate" title={result.email.subject}>
            Subject: {result.email.subject}
          </p>
        </div>

        {/* Remediation hint */}
        <div className="rounded border border-warn/30 bg-warn/5 p-3.5">
          <div className="text-[10px] uppercase tracking-wider font-mono text-warn font-semibold mb-1.5">Next Step</div>
          <p className="text-xs text-fg leading-relaxed">{result.remediationHint}</p>
        </div>
      </div>
    </div>
  );
}
