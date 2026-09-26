/**
 * @file      scripts/demo/golden.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Copies the golden deployment assets into apps/demo-service (for smoke tests, or as a fallback if Bob's
 *            generated assets are broken during a live demo).
 * @depends   ../lib/env
 * @usedBy    `pnpm demo:golden`
 * @agentNotes Overwrites existing generated assets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/env';

const GOLDEN = path.join(REPO_ROOT, 'docs', 'demo', 'golden');
const APP = path.join(REPO_ROOT, 'apps', 'demo-service');
const COPIES: Array<[string, string]> = [
  ['Dockerfile', 'Dockerfile'],
  ['.dockerignore', '.dockerignore'],
  ['.ceignore', '.ceignore'],
  ['lambda.ts', path.join('src', 'lambda.ts')],
];

for (const [from, to] of COPIES) {
  fs.copyFileSync(path.join(GOLDEN, from), path.join(APP, to));
  console.log(`copied docs/demo/golden/${from} → apps/demo-service/${to.replace(/\\/g, '/')}`);
}
