/**
 * @file      apps/control-center/components/logs-panel.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Runtime logs per provider (Code Engine / CloudWatch), fetched on demand.
 * @depends   react, clsx, @bobops/core, @/lib/api, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes Hidden in replay mode (logs are live-only).
 */
'use client';
import clsx from 'clsx';
import { useState } from 'react';
import type { ProviderId, RunAggregate } from '@bobops/core';
import { MODE, api } from '@/lib/api';
import { errorText } from '@/lib/format';
import { Panel } from './ui';

export function LogsPanel({ agg }: { agg: RunAggregate }) {
  const [active, setActive] = useState<ProviderId | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providers = [...new Set(agg.deployments.filter((d) => d.status === 'succeeded').map((d) => d.provider))];
  if (!providers.length || MODE === 'replay') return null;

  async function load(provider: ProviderId) {
    setActive(provider);
    setLoading(true);
    setError(null);
    try {
      setLines((await api.logs(agg.run.id, provider)).lines);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      title="Runtime logs"
      subtitle="Fetched live from Code Engine / CloudWatch"
      right={
        <div className="flex gap-2">
          {providers.map((p) => (
            <button
              key={p}
              onClick={() => load(p)}
              className={clsx('rounded px-3 py-1 text-xs font-mono font-medium transition-colors', active === p ? 'bg-ibm text-white' : 'border border-line-strong text-fg hover:border-ibm')}
            >
              {p}
            </button>
          ))}
        </div>
      }
    >
      {loading ? (
        <p className="text-xs text-muted font-mono">Fetching latest runtime logs…</p>
      ) : error ? (
        <p className="text-xs text-bad font-mono">{error}</p>
      ) : active ? (
        <pre className="max-h-72 overflow-auto rounded border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-fg select-text">{lines.join('\n') || '(no log lines)'}</pre>
      ) : (
        <p className="text-xs text-muted">Choose a provider above to load its real-time runtime logs.</p>
      )}
    </Panel>
  );
}
