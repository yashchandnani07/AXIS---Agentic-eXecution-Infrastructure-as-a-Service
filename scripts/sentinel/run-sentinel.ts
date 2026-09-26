/**
 * @file      scripts/sentinel/run-sentinel.ts
 * @phase     P12
 * @owner     Product & Experience
 * @purpose   Independent cross-cloud health sentinel. The workflow's cron always fires every 5 minutes (GitHub's fastest
 *            schedule), but each target is only ACTUALLY PROBED when shouldProbeNow() says its user-chosen
 *            intervalMinutes has elapsed — so "check every 15/30/60 minutes" is a real, user-set cadence, not a fixed 5.
 *            For targets that are due: probes N times; after THRESHOLD consecutive failures opens (or comments on) a
 *            GitHub issue with JSON evidence. Always writes sentinel-report.json and a job summary. Exit code 1 only
 *            when an incident exists (red run = visible); a quiet or skipped tick exits 0.
 * @depends   ../lib/env, @bobops/core (probe + sentinel format), @bobops/github, zod
 * @usedBy    .github/workflows/health-sentinel.yml, `pnpm sentinel` (local dry run)
 * @agentNotes Never close issues here — only the orchestrator closes them after a VERIFIED recovery. shouldProbeNow()
 *             needs no external state — every runner agrees on the same wall-clock tick (see packages/core/src/sentinel.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/env';
import { z } from 'zod';
import {
  SentinelTargetSchema,
  consecutiveFailures,
  incidentTitle,
  probeHealth,
  renderStepSummary,
  shouldProbeNow,
  type HealthCheck,
  type SentinelIncidentPayload,
  type SentinelResult,
  type SentinelTarget,
} from '@bobops/core';
import { GitHubClient, githubConfigFromEnv } from '@bobops/github';

const ATTEMPTS = Number(process.env.SENTINEL_ATTEMPTS ?? 3);
const GAP_MS = Number(process.env.SENTINEL_GAP_MS ?? 10_000);
const THRESHOLD = Number(process.env.SENTINEL_THRESHOLD ?? ATTEMPTS);
const REPORT = process.env.SENTINEL_REPORT_PATH ?? path.join(REPO_ROOT, 'sentinel-report.json');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadTargets(): SentinelTarget[] {
  const fallback = path.join(REPO_ROOT, 'ops', 'sentinel-targets.json');
  const raw = process.env.SENTINEL_TARGETS?.trim() || (fs.existsSync(fallback) ? fs.readFileSync(fallback, 'utf8') : '[]');
  return z.array(SentinelTargetSchema).parse(JSON.parse(raw));
}

async function probeTarget(target: SentinelTarget, gh: GitHubClient | null): Promise<SentinelResult> {
  const probes: HealthCheck[] = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    const probe = await probeHealth({ provider: target.provider, endpoint: target.endpoint, healthPath: target.healthPath, timeoutMs: 10_000 });
    probes.push({ ...probe, runId: target.runId });
    console.log(`[${target.provider}] attempt ${i + 1}/${ATTEMPTS}: ${probe.ok ? 'OK' : 'FAIL'} ${probe.statusCode} ${probe.latencyMs}ms`);
    if (i < ATTEMPTS - 1) await sleep(GAP_MS);
  }
  const streak = consecutiveFailures(probes);
  const incident = streak >= THRESHOLD;
  let issueUrl: string | undefined;
  if (incident && gh) {
    const payload: SentinelIncidentPayload = {
      version: 1,
      runId: target.runId,
      provider: target.provider,
      appName: target.appName,
      endpoint: target.endpoint,
      threshold: THRESHOLD,
      consecutiveFailures: streak,
      probes,
      detectedAt: new Date().toISOString(),
      workflowRunUrl: process.env.WORKFLOW_RUN_URL,
      commitSha: process.env.GITHUB_SHA,
    };
    const title = incidentTitle(target);
    const existing = await gh.findOpenIssueByTitle(title);
    if (existing) {
      await gh.comment(existing.number, `Still failing at ${payload.detectedAt} (${streak} consecutive failures). ${payload.workflowRunUrl ?? ''}`);
      issueUrl = existing.url;
    } else {
      issueUrl = (await gh.openIncidentIssue(title, payload)).url;
    }
    console.log(`🚨 incident for ${target.provider}/${target.appName}: ${issueUrl}`);
  }
  return { target, probes, incident, issueUrl };
}

async function main() {
  const targets = loadTargets();
  if (!targets.length) {
    console.log('No sentinel targets (repo variable SENTINEL_TARGETS is empty). The orchestrator sets it after a healthy deploy.');
    return;
  }
  const ghConfig = githubConfigFromEnv();
  const gh = ghConfig ? new GitHubClient(ghConfig) : null;
  const now = new Date();
  const results: SentinelResult[] = [];

  for (const target of targets) {
    if (!shouldProbeNow(target, now)) {
      console.log(`[${target.provider}/${target.appName}] not due yet (checks in every ${target.intervalMinutes} min) — skipping this tick`);
      results.push({ target, probes: [], incident: false, skipped: true });
      continue;
    }
    results.push(await probeTarget(target, gh));
  }

  fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: now.toISOString(), threshold: THRESHOLD, results }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderStepSummary(results));
  if (results.some((r) => r.incident)) {
    console.error('Sentinel detected at least one incident.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
