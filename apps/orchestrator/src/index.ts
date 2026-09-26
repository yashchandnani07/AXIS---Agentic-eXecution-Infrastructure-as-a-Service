/**
 * @file      apps/orchestrator/src/index.ts
 * @phase     P4 (replaced in P12)
 * @owner     Orchestration & Cloud
 * @purpose   Process entry: load root .env, validate config, build deps, start the HTTP server on ORCHESTRATOR_PORT.
 * @depends   dotenv, @hono/node-server, ./config, ./deps, ./app
 * @usedBy    `pnpm dev:api`
 * @agentNotes If startup fails with a zod error, a required .env value is missing (usually APPROVAL_TOKEN).
 */
import path from 'node:path';
import { serve } from '@hono/node-server';
import { config as loadDotenv } from 'dotenv';
import { createApp } from './app';
import { REPO_ROOT, loadConfig } from './config';
import { createDeps } from './deps';

loadDotenv({ path: path.join(REPO_ROOT, '.env') });
const config = loadConfig();
const deps = createDeps(config);

serve({ fetch: createApp(deps).fetch, port: config.ORCHESTRATOR_PORT }, (info) => {
  console.log(`BobOps orchestrator listening on http://localhost:${info.port} (demo mode: ${config.demoMode})`);
});
