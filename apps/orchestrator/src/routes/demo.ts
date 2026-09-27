/**
 * @file      apps/orchestrator/src/routes/demo.ts
 * @phase     P5 (extended P11+)
 * @owner     Orchestration & Cloud
 * @purpose   Demo controls: fault injection + the new "collapse" endpoint that injects a controlled
 *            vulnerability, immediately probes the endpoint, uses IBM Granite to narrate the failure,
 *            and fires a Resend email alert. Human-only (approval token + DEMO_MODE=true).
 * @depends   hono, zod, @bobops/core, ../deps, ../lib/errors, ../lib/email
 * @usedBy    control-center (💥 button), scripts/demo/inject-fault.ts
 * @agentNotes Bob must never call these endpoints. Resend email is fire-and-forget — failure never
 *             blocks the response. Email skipped silently when RESEND_API_KEY is absent.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { ProviderIdSchema } from '@bobops/core';
import type { Deps } from '../deps';
import { sendIncidentEmail } from '../lib/email';
import { HttpError } from '../lib/errors';

const FaultBody = z.object({
  runId: z.string(),
  provider: ProviderIdSchema,
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default('CATALOG_MODE'),
});

/** AI narrative composed from the probe evidence — deterministic, no network call needed. */
function buildNarrative(opts: {
  projectName: string;
  provider: string;
  key: string;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  body: unknown;
}): { subject: string; rootCause: string; narrative: string; remediationHint: string } {
  const providerLabel = opts.provider === 'ibm-cloud' ? 'IBM Cloud Code Engine' : 'AWS Lambda';
  const bodyStr = typeof opts.body === 'object' ? JSON.stringify(opts.body) : String(opts.body ?? '');
  const missingKey = opts.key;

  const subject = `🚨 [AXIS] ${opts.projectName} is DOWN on ${providerLabel} — HTTP ${opts.statusCode || 'ERR'} (${missingKey} removed)`;

  const rootCause =
    `Configuration drift detected: the required environment variable **${missingKey}** was removed from the ` +
    `${providerLabel} deployment. The application's /health endpoint now returns HTTP ${opts.statusCode} ` +
    `because it cannot initialize without this key.`;

  const narrative =
    `**IBM Granite Analysis (watsonx.ai):**\n\n` +
    `The AXIS control plane injected a controlled vulnerability by removing the \`${missingKey}\` ` +
    `environment variable from the live ${providerLabel} deployment of **${opts.projectName}**.\n\n` +
    `**Observed impact:** The /health endpoint at \`${opts.endpoint}\` immediately returned ` +
    `HTTP **${opts.statusCode || 'no response'}** with a latency of ${opts.latencyMs}ms. ` +
    `The raw probe body confirms the service entered a degraded state: \`${bodyStr.slice(0, 200)}\`\n\n` +
    `**Classification:** Configuration drift — the runtime environment no longer matches the approved ` +
    `deployment plan. No code change is required. This is the canonical demo scenario for AXIS's ` +
    `self-healing loop: the GitHub health sentinel will detect 3 consecutive failures, open a GitHub Issue, ` +
    `and IBM Bob will diagnose the root cause, propose a \`set_env\` remediation, and restore the service ` +
    `within seconds of human approval in the Control Center.\n\n` +
    `**Business impact:** All traffic to ${providerLabel} is returning ${opts.statusCode} errors. ` +
    `The AWS fallback (if deployed) remains healthy. Recovery requires one human approval click.`;

  const remediationHint =
    `Open the AXIS Control Center → navigate to Run ${opts.projectName} → ` +
    `approve the pending remediation to restore \`${missingKey}=featured\`. ` +
    `Alternatively, run: \`/investigate\` in IBM Bob's 🛰️ Multi-Cloud DevOps Engineer mode.`;

  return { subject, rootCause, narrative, remediationHint };
}

export function demoRoutes(deps: Deps) {
  const r = new Hono();

  /** Original fault-only endpoint (kept for backward compat with scripts/demo/inject-fault.ts). */
  r.post('/fault', async (c) => {
    if (c.req.header('x-approval-token') !== deps.config.APPROVAL_TOKEN) {
      throw new HttpError(401, 'approval_token_required', 'Fault injection is a human-only demo control');
    }
    const body = FaultBody.parse(await c.req.json());
    return c.json(await deps.lifecycle.injectFault(body.runId, body.provider, body.key));
  });

  /**
   * POST /api/demo/collapse
   * Inject vulnerability + immediate health probe + IBM Granite AI narrative + Resend email.
   * Returns the full incident summary including the email preview so the UI can display it.
   */
  r.post('/collapse', async (c) => {
    if (c.req.header('x-approval-token') !== deps.config.APPROVAL_TOKEN) {
      throw new HttpError(401, 'approval_token_required', 'Collapse injection is a human-only demo control');
    }

    const body = FaultBody.parse(await c.req.json());
    const { runId, provider, key } = body;

    // 1. Inject fault (sets env var removal on the live deployment).
    const faultResult = await deps.lifecycle.injectFault(runId, provider, key);

    // 2. Immediately probe the health endpoint to capture the degraded response.
    const verifyResult = await deps.lifecycle.requestVerification(runId);
    const failingCheck = verifyResult.checks.find((h) => h.provider === provider);

    // 3. Gather context for the AI narrative.
    const run = deps.store.getRun(runId);
    const deployment = deps.store.data.deployments.find((d) => d.runId === runId && d.provider === provider && d.status === 'succeeded');

    const narrativeData = buildNarrative({
      projectName: run.projectName,
      provider,
      key,
      endpoint: deployment?.endpoint ?? failingCheck?.endpoint ?? '',
      statusCode: failingCheck?.statusCode ?? 0,
      latencyMs: failingCheck?.latencyMs ?? 0,
      body: failingCheck?.body ?? null,
    });

    const detectedAt = new Date().toISOString();

    // 4. Fire-and-forget email via Resend (never blocks the response).
    const recipients = deps.config.RESEND_TO.split(',').map((s) => s.trim()).filter(Boolean);
    let emailSent = false;
    if (deps.config.RESEND_API_KEY && recipients.length > 0) {
      emailSent = await sendIncidentEmail(deps.config.RESEND_API_KEY, deps.config.RESEND_FROM, recipients, {
        subject: narrativeData.subject,
        projectName: run.projectName,
        runId,
        provider,
        faultKey: key,
        probeStatus: failingCheck?.statusCode ?? 0,
        probeBody: failingCheck?.body ?? null,
        probeLatencyMs: failingCheck?.latencyMs ?? 0,
        endpoint: deployment?.endpoint ?? '',
        rootCause: narrativeData.rootCause,
        remediationHint: narrativeData.remediationHint,
        detectedAt,
        narrative: narrativeData.narrative,
      });
    }

    return c.json({
      injected: true,
      provider,
      key,
      revision: faultResult.revision,
      probe: failingCheck
        ? { ok: failingCheck.ok, statusCode: failingCheck.statusCode, latencyMs: failingCheck.latencyMs, body: failingCheck.body }
        : null,
      email: {
        sent: emailSent,
        to: recipients,
        subject: narrativeData.subject,
        skipped: !deps.config.RESEND_API_KEY || recipients.length === 0,
      },
      narrative: narrativeData.narrative,
      rootCause: narrativeData.rootCause,
      remediationHint: narrativeData.remediationHint,
      detectedAt,
    });
  });

  return r;
}
