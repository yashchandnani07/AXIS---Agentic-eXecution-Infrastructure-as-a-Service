/**
 * @file      apps/control-center/lib/api.ts
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   All HTTP/SSE access to the orchestrator, plus REPLAY mode (static JSON in /public/replay) for the public demo URL.
 * @depends   @bobops/core (types only)
 * @usedBy    every page/component that loads or mutates data
 * @agentNotes The approval token is sent ONLY from decide() and injectFault() — human actions in this UI.
 */
import type { Approval, ProviderCapabilities, ProviderId, Run, RunAggregate, RunEvent } from '@bobops/core';

export const MODE: 'live' | 'replay' = process.env.NEXT_PUBLIC_MODE === 'replay' ? 'replay' : 'live';
export const API = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';
const TOKEN = process.env.NEXT_PUBLIC_APPROVAL_TOKEN ?? '';

async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

async function replay<T>(file: string): Promise<T> {
  const res = await fetch(`/replay/${file}`);
  if (!res.ok) throw new Error(`Replay file ${file} is missing`);
  return (await res.json()) as T;
}

const post = (body: unknown = {}, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers,
});

export const api = {
  listRuns: () => (MODE === 'replay' ? replay<Run[]>('runs.json') : http<Run[]>('/api/runs')),
  getRun: (id: string) => (MODE === 'replay' ? replay<RunAggregate>(`${id}.json`) : http<RunAggregate>(`/api/runs/${id}`)),
  providers: () => (MODE === 'replay' ? replay<ProviderCapabilities[]>('providers.json') : http<ProviderCapabilities[]>('/api/providers')),
  decide: (approvalId: string, decision: 'approved' | 'rejected', comment?: string) =>
    http<Approval>(`/api/approvals/${approvalId}/decision`, post({ decision, decidedBy: 'developer', comment }, { 'x-approval-token': TOKEN })),
  verify: (runId: string) => http(`/api/runs/${runId}/verify`, post()),
  logs: (runId: string, provider: ProviderId) => http<{ lines: string[] }>(`/api/runs/${runId}/logs?provider=${provider}&lines=60`),
  syncIncidents: () => http<{ imported: number; open: number; note?: string }>('/api/incidents/sync', post()),
  injectFault: (runId: string, provider: ProviderId) => http('/api/demo/fault', post({ runId, provider }, { 'x-approval-token': TOKEN })),
  exportEvidence: (runId: string) => http<{ json: string; markdown: string }>(`/api/runs/${runId}/export`, post()),
  askWatson: (question: string, runId?: string) =>
    http<{ question: string; answer: string; category: string; model: string; time: string; suggestedQuestions: string[] }>(
      '/api/watson/ask',
      post({ question, runId }),
    ),
};

/** Live audit events (SSE). Returns an unsubscribe function. No-op in replay mode. */
export function subscribeEvents(onEvent: (event: RunEvent) => void): () => void {
  if (MODE === 'replay' || typeof window === 'undefined') return () => {};
  const source = new EventSource(`${API}/api/events/stream`);
  source.addEventListener('run-event', (msg) => onEvent(JSON.parse((msg as MessageEvent<string>).data) as RunEvent));
  return () => source.close();
}
