/**
 * @file      apps/control-center/components/approval-queue.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   THE human approval gate UI: pending plan/remediation approvals with hash, risk, comment, Approve/Reject.
 * @depends   react, @bobops/core, @/lib/api, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes This is the only place approvals can be decided (Bob's MCP bridge has no approve tool).
 */
'use client';
import { useState } from 'react';
import type { RunAggregate } from '@bobops/core';
import { MODE, api } from '@/lib/api';
import { errorText } from '@/lib/format';
import { Panel } from './ui';

export function ApprovalQueue({ agg, onDecided }: { agg: RunAggregate; onDecided: () => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = agg.approvals.filter((a) => a.status === 'pending');
  const decided = agg.approvals.filter((a) => a.status !== 'pending').slice(-4).reverse();
  if (!pending.length && !decided.length) return null;

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusy(id + decision);
    setError(null);
    try {
      await api.decide(id, decision, comment || undefined);
      // If this was a remediation approval, also execute the remediation to complete self-healing!
      const targetApproval = pending.find((a) => a.id === id);
      if (decision === 'approved' && targetApproval?.kind === 'remediation') {
        const incident = agg.incidents.find((i) => i.remediation?.approvalId === id);
        if (incident) {
          await api.executeRemediation(incident.id);
        }
      }
      setComment('');
      onDecided();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Approval gates" subtitle="Bob proposes. You decide. Approvals are bound to the exact cryptographic hash of what you reviewed.">
      {pending.map((a) => (
        <div key={a.id} className="mb-4 rounded-lg border border-warn/60 bg-warn/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-warn flex items-center gap-1.5">
              <span>⚑</span> {a.kind === 'deploy_plan' ? 'Deployment Plan Approval' : 'Remediation Approval'}
            </span>
            <span className="font-mono text-[11px] text-muted">
              risk: <span className="text-fg font-medium">{a.risk}</span> · sha256: <span className="text-fg font-medium">{a.subjectHash.slice(0, 12)}…</span>
            </span>
          </div>
          <p className="mt-2.5 text-sm text-fg leading-relaxed">{a.summary}</p>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional note for Bob (e.g. reason for decision or constraint)"
            disabled={MODE === 'replay'}
            className="mt-3 w-full rounded border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none focus:border-ibm transition-colors"
          />
          <div className="mt-3.5 flex gap-2.5">
            <button
              onClick={() => decide(a.id, 'approved')}
              disabled={busy !== null || MODE === 'replay'}
              className="rounded bg-ibm px-4 py-2 text-sm font-medium text-white hover:bg-ibm/90 active:bg-ibm/80 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
            >
              {busy === a.id + 'approved'
                ? (a.kind === 'remediation' ? 'Applying remediation & restoring…' : 'Approving…')
                : (a.kind === 'remediation' ? '⚡ Approve & Restore Service' : 'Approve Plan')}
            </button>
            <button
              onClick={() => decide(a.id, 'rejected')}
              disabled={busy !== null || MODE === 'replay'}
              className="rounded border border-line-strong px-4 py-2 text-sm font-medium text-fg hover:border-bad hover:text-bad active:bg-bad/5 disabled:opacity-50 transition-colors cursor-pointer"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
      {error && <p className="mb-2 text-sm text-bad font-mono">{error}</p>}
      {decided.length > 0 && (
        <ul className="space-y-1.5 text-xs text-muted border-t border-line/60 pt-3 mt-3">
          {decided.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5">
              <span>•</span> {a.kind === 'deploy_plan' ? 'Plan' : 'Remediation'} <b className={a.status === 'approved' ? 'text-ok uppercase font-semibold' : 'text-bad uppercase font-semibold'}>{a.status}</b> by{' '}
              <span className="text-fg font-medium">{a.decidedBy}</span>
              {a.comment ? ` — "${a.comment}"` : ''} <span className="font-mono text-muted">({a.subjectHash.slice(0, 8)})</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
