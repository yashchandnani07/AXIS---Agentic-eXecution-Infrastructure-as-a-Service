/**
 * @file      apps/demo-service/src/config.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Reads runtime configuration. CATALOG_MODE is REQUIRED — its absence is the demo's controlled fault.
 * @depends   —
 * @usedBy    ./app.ts
 * @agentNotes Keep REQUIRED_ENV = ['CATALOG_MODE']: the fixtures, rules, fault script and remediation all rely on it.
 */
export const REQUIRED_ENV = ['CATALOG_MODE'] as const;

export interface ServiceConfig {
  catalogMode: 'featured' | 'all';
  appVersion: string;
  provider: string;
  adminToken?: string;
  missing: string[];
}

export function readConfig(env: Record<string, string | undefined>): ServiceConfig {
  const missing = REQUIRED_ENV.filter((key) => !env[key] || env[key]!.trim() === '');
  return {
    catalogMode: env.CATALOG_MODE === 'all' ? 'all' : 'featured',
    appVersion: env.APP_VERSION ?? 'dev',
    provider: env.DEPLOY_PROVIDER ?? 'local',
    adminToken: env.ADMIN_TOKEN,
    missing: [...missing],
  };
}
