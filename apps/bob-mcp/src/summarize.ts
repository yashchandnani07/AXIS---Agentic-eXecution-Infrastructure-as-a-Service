/**
 * @file      apps/bob-mcp/src/summarize.ts
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   Converts a full RunAggregate into the compact, decision-ready JSON Bob reads (saves context + Bobcoins).
 * @depends   @bobops/core
 * @usedBy    ./tools.ts (devops_get_run, devops_wait)
 * @agentNotes Include response bodies ONLY for failing health checks (they carry the diagnosis evidence).
 */
import { describeAction, type Deployment, type HealthCheck, type ProviderId, type RunAggregate } from '@bobops/core';

export function summarizeRun(agg: RunAggregate, uiBase: string) {
  const latestDeploy = new Map<ProviderId, Deployment>();
  for (const d of agg.deployments) latestDeploy.set(d.provider, d);
  const latestHealth = new Map<ProviderId, HealthCheck>();
  for (const h of agg.healthChecks) latestHealth.set(h.provider, h);
  const lastDecision = agg.approvals.filter((a) => a.status !== 'pending').at(-1);

  return {
    runId: agg.run.id,
    state: agg.run.state,
    objective: agg.run.objective,
    repoPath: agg.run.repoPath,
    controlCenterUrl: `${uiBase}/run?id=${agg.run.id}`,
    planHash: agg.run.planHash?.slice(0, 12),
    targets: (agg.run.plan?.targets ?? []).map((t) => ({
      provider: t.provider,
      service: t.service,
      architectureRationale: t.architectureRationale,
      appName: t.appName,
      region: t.region,
      env: t.env,
    })),
    deployments: [...latestDeploy.values()].map((d) => ({
      provider: d.provider,
      service: d.service,
      status: d.status,
      endpoint: d.endpoint,
      revision: d.revision,
      error: d.error,
      note: d.note,
    })),
    health: [...latestHealth.values()].map((h) => ({
      provider: h.provider,
      ok: h.ok,
      statusCode: h.statusCode,
      latencyMs: h.latencyMs,
      revision: h.revision,
      checkedAt: h.checkedAt,
      body: h.ok ? undefined : h.body,
      error: h.error,
    })),
    pendingApprovals: agg.approvals
      .filter((a) => a.status === 'pending')
      .map((a) => ({ id: a.id, kind: a.kind, summary: a.summary, risk: a.risk })),
    lastDecision: lastDecision ? { kind: lastDecision.kind, status: lastDecision.status, by: lastDecision.decidedBy, comment: lastDecision.comment } : null,
    openIncidents: agg.incidents
      .filter((i) => i.status !== 'resolved')
      .map((i) => ({
        id: i.id,
        provider: i.provider,
        status: i.status,
        source: i.source,
        githubIssueUrl: i.githubIssueUrl,
        diagnosed: Boolean(i.diagnosis),
        remediation: i.remediation ? { action: describeAction(i.remediation.action), status: i.remediation.status } : null,
      })),
    recentEvents: agg.events.slice(-12).map((e) => `${e.at.slice(11, 19)} [${e.actor}/${e.kind}] ${e.type}: ${e.message}`),
  };
}
