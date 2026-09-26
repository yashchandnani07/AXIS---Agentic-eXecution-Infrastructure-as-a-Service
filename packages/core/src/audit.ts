/**
 * @file      packages/core/src/audit.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Renders a run aggregate as a human-readable Markdown audit trail (committed to evidence/demo-runs/).
 * @depends   ./metrics, ./util, ./schemas (types)
 * @usedBy    orchestrator LifecycleService.exportEvidence
 * @agentNotes Output is judge-facing. Never include env values that are secret (events already carry redacted data).
 */
import { computeMetrics, formatDuration } from './metrics';
import type { RunAggregate } from './schemas';
import { describeAction } from './util';

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderAuditMarkdown(agg: RunAggregate): string {
  const m = computeMetrics(agg);
  const { run } = agg;
  const lines = [
    `# BobOps audit trail — ${run.projectName}`,
    '',
    `- **Run:** \`${run.id}\` · **State:** ${run.state} · **Targets:** ${run.targets.join(', ')}`,
    `- **Objective:** ${run.objective}`,
    `- **Approved plan hash:** \`${run.planHash ?? 'n/a'}\``,
    `- **Run created → verified healthy:** ${m.timeToHealthyMs !== undefined ? formatDuration(m.timeToHealthyMs) : 'n/a'}` +
      ` · **MTTR:** ${m.mttrMs !== undefined ? formatDuration(m.mttrMs) : 'n/a'}` +
      ` · **Human approvals:** ${m.approvals} · **Unsafe actions blocked:** ${m.guardBlocks}`,
    '',
    '## Deployments',
    '| Provider | App | Status | Endpoint | Revision | Note |',
    '|---|---|---|---|---|---|',
    ...agg.deployments.map(
      (d) => `| ${d.provider} | ${d.appName} | ${d.status} | ${d.endpoint ?? ''} | ${d.revision ?? ''} | ${cell(d.note ?? '')} |`,
    ),
    '',
    '## Incidents',
    ...(agg.incidents.length
      ? agg.incidents.map(
          (i) =>
            `- **${i.id}** (${i.provider}, via ${i.source}) — ${i.status}` +
            (i.diagnosis ? ` · root cause: ${i.diagnosis.rootCause}` : '') +
            (i.remediation ? ` · remediation: ${describeAction(i.remediation.action)} (${i.remediation.status})` : '') +
            (i.githubIssueUrl ? ` · ${i.githubIssueUrl}` : ''),
        )
      : ['- none']),
    '',
    '## Timeline',
    '| Time (UTC) | Actor | Kind | Event | Message |',
    '|---|---|---|---|---|',
    ...agg.events.map((e) => `| ${e.at.slice(11, 19)} | ${e.actor} | ${e.kind} | ${e.type} | ${cell(e.message)} |`),
  ];
  return `${lines.join('\n')}\n`;
}
