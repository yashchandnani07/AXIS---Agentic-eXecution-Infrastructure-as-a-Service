/**
 * @file      packages/core/src/sentinel.ts
 * @phase     P2
 * @owner     Product & Experience
 * @purpose   Contract between the GitHub Actions health sentinel and the orchestrator: targets, incident payload,
 *            issue body rendering/parsing, failure-streak logic, job summary.
 * @depends   zod, ./schemas
 * @usedBy    scripts/sentinel/run-sentinel.ts, packages/github, orchestrator incident sync
 * @agentNotes The JSON block after MARKER is machine-read. Keep MARKER and version:1 stable.
 */
import { z } from 'zod';
import { HealthCheckSchema, ProviderIdSchema, type HealthCheck } from './schemas';

export const SENTINEL_LABEL = 'sentinel-incident';
const MARKER = '<!-- bobops-incident:v1 -->';

export const SentinelTargetSchema = z.object({
  runId: z.string(),
  provider: ProviderIdSchema,
  appName: z.string(),
  endpoint: z.string().url(),
  healthPath: z.string().default('/health'),
});
export type SentinelTarget = z.infer<typeof SentinelTargetSchema>;

export const SentinelIncidentPayloadSchema = z.object({
  version: z.literal(1),
  runId: z.string(),
  provider: ProviderIdSchema,
  appName: z.string(),
  endpoint: z.string(),
  threshold: z.number().int(),
  consecutiveFailures: z.number().int(),
  probes: z.array(HealthCheckSchema),
  detectedAt: z.string(),
  workflowRunUrl: z.string().optional(),
  commitSha: z.string().optional(),
});
export type SentinelIncidentPayload = z.infer<typeof SentinelIncidentPayloadSchema>;

export function consecutiveFailures(probes: HealthCheck[]): number {
  let n = 0;
  for (let i = probes.length - 1; i >= 0 && !probes[i]!.ok; i--) n++;
  return n;
}

export function incidentTitle(target: { provider: string; appName: string }): string {
  return `[sentinel] ${target.provider}/${target.appName} is failing health checks`;
}

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\r?\n/g, ' ');

export function renderIssueBody(p: SentinelIncidentPayload): string {
  const rows = p.probes.map(
    (pr) =>
      `| ${pr.checkedAt} | ${pr.statusCode || '—'} | ${pr.latencyMs} ms | ${pr.ok ? '✅' : '❌'} | ${cell(pr.error ?? JSON.stringify(pr.body ?? '').slice(0, 120))} |`,
  );
  return [
    '## 🚨 Health sentinel incident',
    '',
    `**Target:** \`${p.provider}\` / \`${p.appName}\`  `,
    `**Endpoint:** ${p.endpoint}  `,
    `**Consecutive failures:** ${p.consecutiveFailures} (threshold ${p.threshold})  `,
    p.workflowRunUrl ? `**Workflow run:** ${p.workflowRunUrl}  ` : '',
    p.commitSha ? `**Commit:** \`${p.commitSha.slice(0, 7)}\`` : '',
    '',
    '| Checked at | HTTP | Latency | OK | Detail |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    'The BobOps orchestrator imports this issue as an incident. IBM Bob investigates it in the IDE (`/investigate`);',
    'any remediation requires human approval in the Control Center. This issue closes automatically after verified recovery.',
    '',
    MARKER,
    '```json',
    JSON.stringify(p, null, 2),
    '```',
  ].join('\n');
}

export function parseIssueBody(body: string): SentinelIncidentPayload | null {
  const idx = body.indexOf(MARKER);
  if (idx < 0) return null;
  const match = body.slice(idx).match(/```json\s*([\s\S]*?)```/);
  if (!match?.[1]) return null;
  try {
    const parsed = SentinelIncidentPayloadSchema.safeParse(JSON.parse(match[1]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface SentinelResult {
  target: SentinelTarget;
  probes: HealthCheck[];
  incident: boolean;
  issueUrl?: string;
}

export function renderStepSummary(results: SentinelResult[]): string {
  const rows = results.map((r) => {
    const last = r.probes[r.probes.length - 1];
    const verdict = r.incident ? '🚨 INCIDENT' : r.probes.every((p) => p.ok) ? '✅ healthy' : '⚠️ flaky';
    return `| ${r.target.provider} | ${r.target.appName} | ${verdict} | ${r.probes.filter((p) => p.ok).length}/${r.probes.length} | ${last ? `${last.statusCode} / ${last.latencyMs} ms` : '—'} | ${r.issueUrl ?? ''} |`;
  });
  return [
    '## BobOps health sentinel',
    '',
    '| Provider | App | Verdict | OK probes | Last status / latency | Incident |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}
