/**
 * @file      apps/control-center/lib/format.ts
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Tiny display helpers.
 * @depends   —
 * @usedBy    components
 * @agentNotes Keep pure.
 */
export const fmtTime = (iso?: string): string =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const json = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
