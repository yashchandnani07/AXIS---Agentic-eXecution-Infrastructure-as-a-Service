/**
 * @file      apps/control-center/components/provider-cards.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Provider connection cards (IBM Cloud, AWS live) + V2 roadmap slots (Vercel, Railway) — the "provider contract" story.
 * @depends   clsx, @bobops/core, ./ui
 * @usedBy    app/page.tsx
 * @agentNotes V2 cards are intentionally disabled — V1 must not claim simulated support (PRD §5).
 */
import clsx from 'clsx';
import type { ProviderCapabilities } from '@bobops/core';
import { ProviderBadge } from './ui';

const V2 = ['Vercel', 'Railway'];

export function ProviderCards({ providers }: { providers: ProviderCapabilities[] | null }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {providers === null && <div className="rounded-lg border border-line bg-layer p-4 text-xs text-muted">Checking cloud connections…</div>}
      {(providers ?? []).map((p) => (
        <div key={p.provider} className="rounded-lg border border-line bg-layer p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <ProviderBadge provider={p.provider} />
              <span className={clsx('font-mono text-[10px] font-medium', p.authenticated ? 'text-ok' : 'text-bad')}>
                {p.authenticated ? '● connected' : '● not connected'}
              </span>
            </div>
            <p className="mt-2 text-sm font-medium">{p.displayName}</p>
            <p className="text-xs text-muted">
              {p.region}
              {p.account ? ` · ${p.account}` : ''}
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-line/60">
            <p className="text-[10px] text-muted font-mono">{p.services.join(' · ')}</p>
            {!p.authenticated && p.notes[0] && <p className="mt-1 text-[10px] text-bad truncate" title={p.notes[0]}>{p.notes[0]}</p>}
          </div>
        </div>
      ))}
      {V2.map((name) => (
        <div key={name} className="rounded-lg border border-dashed border-line p-4 opacity-50 flex flex-col justify-between">
          <div>
            <span className="text-sm font-semibold text-muted">{name}</span>
            <p className="mt-2 text-xs text-muted">V2 adapter · same provider contract, no workflow changes</p>
          </div>
          <span className="mt-3 font-mono text-[10px] text-muted uppercase">Roadmap</span>
        </div>
      ))}
    </div>
  );
}
