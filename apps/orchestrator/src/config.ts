/**
 * @file      apps/orchestrator/src/config.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   Parses and validates environment configuration once at startup; resolves REPO_ROOT and the store path.
 * @depends   zod
 * @usedBy    src/index.ts, src/deps.ts, tests (loadConfig with an explicit env object + inMemory)
 * @agentNotes Never read process.env anywhere else in the orchestrator — add the variable here instead.
 *             Empty strings in .env are treated as "not set".
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const EnvSchema = z.object({
  ORCHESTRATOR_PORT: z.coerce.number().int().default(4000),
  CONTROL_CENTER_ORIGIN: z.string().default('http://localhost:3000'),
  APPROVAL_TOKEN: z.string().min(8, 'APPROVAL_TOKEN must be set in .env (>= 8 chars)'),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  DATA_DIR: z.string().default('.data'),
  IBMCLOUD_API_KEY: optional,
  IBMCLOUD_REGION: z.string().default('us-south'),
  IBMCLOUD_RESOURCE_GROUP: z.string().default('Default'),
  IBM_CE_PROJECT: z.string().default('bobops-demo'),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_LAMBDA_ROLE_ARN: optional,
  GITHUB_TOKEN: optional,
  GITHUB_OWNER: optional,
  GITHUB_REPO: optional,
  /** Resend API key for incident alert emails. Optional — email is skipped when absent. */
  RESEND_API_KEY: optional,
  /** Sender address, e.g. AXIS <alerts@yourdomain.com>. Defaults to onboarding@resend.dev (sandbox). */
  RESEND_FROM: z.string().default('AXIS <onboarding@resend.dev>'),
  /** Comma-separated recipient list for incident alert emails. */
  RESEND_TO: z.string().default(''),
});

export type Config = z.infer<typeof EnvSchema> & {
  repoRoot: string;
  /** absolute path of store.json, or null for an in-memory store (tests) */
  dataFile: string | null;
  demoMode: boolean;
  /** SECRET_<NAME>=value entries from the env, keyed by NAME (plan.secretRefs resolve against this) */
  secrets: Record<string, string>;
};

/** Repo root = three levels up from apps/orchestrator/src/config.ts */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { inMemory?: boolean } = {}): Config {
  const parsed = EnvSchema.parse(env);
  return {
    ...parsed,
    repoRoot: REPO_ROOT,
    demoMode: parsed.DEMO_MODE === 'true',
    dataFile: opts.inMemory ? null : path.join(REPO_ROOT, 'apps', 'orchestrator', parsed.DATA_DIR, 'store.json'),
    secrets: Object.fromEntries(
      Object.entries(env)
        .filter(([key, value]) => key.startsWith('SECRET_') && typeof value === 'string' && value !== '')
        .map(([key, value]) => [key.slice('SECRET_'.length), value as string]),
    ),
  };
}
