/**
 * @file      packages/core/src/probe.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   One HTTP health probe implementation used by the orchestrator (VERIFY) and the GitHub sentinel.
 * @depends   global fetch (Node 22 / browsers), ./schemas (types)
 * @usedBy    orchestrator LifecycleService.verifyRun, scripts/sentinel/run-sentinel.ts
 * @agentNotes Never throws — failures are returned as { ok:false, statusCode:0, error }. Keep it that way:
 *             the sentinel relies on it to count consecutive failures.
 */
import type { HealthCheck, ProviderId } from './schemas';

export interface ProbeOptions {
  provider: ProviderId;
  endpoint: string;
  healthPath: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function probeHealth(opts: ProbeOptions): Promise<HealthCheck> {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  const id = globalThis.crypto.randomUUID();
  let url = `${opts.endpoint.replace(/\/$/, '')}${opts.healthPath}`;
  try {
    url = new URL(opts.healthPath, opts.endpoint).toString();
    const res = await (opts.fetchImpl ?? fetch)(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: { 'user-agent': 'bobops-probe/1.0', accept: 'application/json' },
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    const revision =
      body && typeof body === 'object' && 'revision' in body ? String((body as { revision: unknown }).revision) : undefined;
    return { id, provider: opts.provider, endpoint: url, ok: res.ok, statusCode: res.status, latencyMs, revision, body, checkedAt };
  } catch (err) {
    return {
      id,
      provider: opts.provider,
      endpoint: url,
      ok: false,
      statusCode: 0,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}

export type ProbeFn = typeof probeHealth;
