/**
 * @file      packages/core/src/util.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Small isomorphic helpers: ids, timestamps, evidence builder, stable JSON (for hashing), human descriptions.
 * @depends   ./schemas, ./provider-contract (types)
 * @usedBy    orchestrator, providers, UI, MCP
 * @agentNotes Must stay browser-safe: no node:* imports here (hashing lives in apps/orchestrator/src/lib/hash.ts).
 */
import type { EnvChange } from './provider-contract';
import type { Actor, Evidence, ProviderId, RemediationAction } from './schemas';

export const nowIso = (): string => new Date().toISOString();

export const newId = (prefix: string): string =>
  `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

export const evidence = (label: string, source: string, data: unknown): Evidence => ({
  label,
  source,
  capturedAt: nowIso(),
  data,
});

export const providerActor = (provider: ProviderId): Actor => (provider === 'aws' ? 'provider:aws' : 'provider:ibm-cloud');

/** JSON.stringify with sorted object keys and undefined values dropped → identical input = identical string. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function describeAction(action: RemediationAction): string {
  return action.type === 'set_env'
    ? `Set ${action.key}=${action.value}`
    : `Roll back to ${action.toRevision ?? 'the previous revision'}`;
}

export function describeEnvChange(change: EnvChange): string {
  const parts: string[] = [];
  if (change.set && Object.keys(change.set).length) parts.push(`set ${Object.keys(change.set).join(', ')}`);
  if (change.remove?.length) parts.push(`remove ${change.remove.join(', ')}`);
  return parts.join('; ') || 'no changes';
}
