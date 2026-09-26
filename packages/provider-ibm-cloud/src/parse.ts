/**
 * @file      packages/provider-ibm-cloud/src/parse.ts
 * @phase     P6
 * @owner     Orchestration & Cloud
 * @purpose   Tolerant parsers for `ibmcloud ce` JSON output (Knative-style and v2-API-style shapes).
 * @depends   —
 * @usedBy    ./provider.ts
 * @agentNotes Pure functions only. Unknown shapes must degrade to undefined fields, never throw.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ParsedCodeEngineApp {
  url?: string;
  revision?: string;
  ready: boolean;
  env: Record<string, string>;
  image?: string;
}

export function extractJson(stdout: string): unknown {
  const start = stdout.search(/[[{]/);
  if (start < 0) throw new Error(`Expected JSON output from ibmcloud, got: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(start));
}

export function parseCodeEngineApp(raw: unknown): ParsedCodeEngineApp {
  const r = (raw ?? {}) as any;
  const container = r?.spec?.template?.spec?.containers?.[0];
  const conditions: Array<{ type?: string; status?: string }> | undefined = r?.status?.conditions;
  const envList: Array<{ name?: string; value?: unknown }> = container?.env ?? r?.run_env_variables ?? [];
  const env: Record<string, string> = {};
  for (const e of envList) {
    if (e?.name && typeof e.value === 'string') env[e.name] = e.value;
  }
  return {
    url: r?.status?.url ?? r?.endpoint ?? r?.url,
    revision: r?.status?.latestReadyRevisionName ?? r?.latest_ready_revision ?? r?.status_details?.latest_ready_revision,
    ready: Array.isArray(conditions) ? conditions.some((c) => c.type === 'Ready' && c.status === 'True') : r?.status === 'ready',
    env,
    image: container?.image ?? r?.image_reference,
  };
}

export function parseRevisions(raw: unknown): Array<{ name: string; image?: string; createdAt: string }> {
  const r = (raw ?? {}) as any;
  const items: any[] = r?.items ?? r?.revisions ?? (Array.isArray(r) ? r : []);
  return items
    .map((it) => ({
      name: String(it?.metadata?.name ?? it?.name ?? ''),
      image: it?.spec?.containers?.[0]?.image ?? it?.image_reference,
      createdAt: String(it?.metadata?.creationTimestamp ?? it?.created_at ?? ''),
    }))
    .filter((rev) => rev.name)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
