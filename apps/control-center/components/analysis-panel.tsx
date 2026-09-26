/**
 * @file      apps/control-center/components/analysis-panel.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   UNDERSTAND view: Bob's synthesized app profile + one card per parallel specialist subagent (with evidence refs).
 * @depends   @bobops/core, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes Specialist cards are the visible proof of Bob's subagents — keep the evidence line.
 */
import type { RunAggregate, Specialist } from '@bobops/core';
import { Panel } from './ui';

const ICON: Record<Specialist, string> = {
  'application-analyst': '⌘',
  'cloud-architect': '☁',
  'security-reviewer': '⛨',
  'release-verifier': '✓',
  'incident-investigator': '⌕',
};

export function AnalysisPanel({ agg }: { agg: RunAggregate }) {
  const p = agg.run.profile;
  if (!p) {
    return (
      <Panel title="UNDERSTAND — Bob's repository analysis" subtitle="Waiting for Bob's specialist subagents…">
        <p className="text-sm text-muted">No analysis recorded yet.</p>
      </Panel>
    );
  }
  const facts: Array<[string, string]> = [
    ['Runtime', `${p.runtime} ${p.runtimeVersion}`],
    ['Framework', p.framework],
    ['Build', p.buildCommand],
    ['Start', p.startCommand],
    ['Port', String(p.port)],
    ['Health', p.healthPath],
    ['Required env', p.requiredEnv.join(', ') || '—'],
    ['Secrets', p.secretEnv.join(', ') || '—'],
  ];
  return (
    <Panel
      title="UNDERSTAND — Bob's repository analysis"
      subtitle={`${p.specialistFindings.length} specialist subagents ran in parallel · Synthesized by IBM Bob & watsonx.ai`}
      right={<span className="rounded bg-bob/15 border border-bob/30 px-2 py-0.5 font-mono text-[10px] text-bob">IBM Bob 2.0</span>}
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4 border-b border-line pb-4">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10px] uppercase tracking-wider text-muted font-medium">{k}</dt>
            <dd className="font-mono text-xs text-fg mt-0.5">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {p.specialistFindings.map((f) => (
          <article key={f.specialist} className="rounded-md border border-line bg-canvas p-4 flex flex-col justify-between">
            <div>
              <header className="flex items-center justify-between">
                <span className="text-sm font-semibold text-bob flex items-center gap-1.5">
                  <span>{ICON[f.specialist]}</span> {f.specialist}
                </span>
                <span className="font-mono text-[10px] text-muted">confidence: {f.confidence}</span>
              </header>
              <p className="mt-2 text-sm text-fg leading-relaxed">{f.summary}</p>
              <ul className="mt-2.5 list-disc space-y-1 pl-4 text-xs text-muted">
                {f.findings.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            {f.evidence.length > 0 && <p className="mt-3 pt-2 border-t border-line/60 break-all font-mono text-[10px] text-info">{f.evidence.join(' · ')}</p>}
          </article>
        ))}
      </div>
    </Panel>
  );
}
