/**
 * @file      scripts/demo/reset.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Resets the repo to the "before Bob" demo state: removes generated deployment assets and the orchestrator's
 *            local store so the recorded demo starts clean.
 * @depends   ../lib/env
 * @usedBy    `pnpm demo:reset` (run BEFORE a rehearsal/recording, with the orchestrator STOPPED)
 * @agentNotes Does NOT touch cloud resources (the deployed apps keep running; the next deploy updates them in place).
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/env';

const TARGETS = [
  'apps/demo-service/Dockerfile',
  'apps/demo-service/.dockerignore',
  'apps/demo-service/.ceignore',
  'apps/demo-service/src/lambda.ts',
  'apps/orchestrator/.data/store.json',
];

for (const rel of TARGETS) {
  const abs = path.join(REPO_ROOT, rel);
  if (fs.existsSync(abs)) {
    fs.rmSync(abs);
    console.log(`removed ${rel}`);
  } else {
    console.log(`(absent) ${rel}`);
  }
}
console.log('Demo reset complete. Bob will regenerate deployment assets during /deploy.');
