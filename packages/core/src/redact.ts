/**
 * @file      packages/core/src/redact.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Decide what counts as a secret and scrub secrets from env maps and free text before they reach evidence.
 * @depends   —
 * @usedBy    schemas.ts (plan env refinement), orchestrator (evidence), provider adapters (CLI output)
 * @agentNotes Never weaken SECRET_KEY_PATTERN. If a key is secret it must travel via plan.secretRefs, not plan.env.
 */
export const SECRET_KEY_PATTERN = /(TOKEN|SECRET|PASSWORD|API_?KEY|PRIVATE)/i;
export const REDACTED = '••••redacted';

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function redactEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, isSecretKey(k) ? REDACTED : v]));
}

/** Replace every occurrence of each secret value (length >= 4) in text. */
export function redactText(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((s) => typeof s === 'string' && s.length >= 4)
    .reduce((acc, secret) => acc.split(secret).join(REDACTED), text);
}
