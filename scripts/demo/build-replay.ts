/**
 * @file      scripts/demo/build-replay.ts
 * @phase     P14
 * @owner     Product & Experience
 * @purpose   Builds the READ-ONLY replay Control Center from exported evidence (evidence/demo-runs/run_*.json) as a static
 *            site, and stages it in infra/ibm-cloud/replay-site/site for Code Engine hosting (the public demo URL).
 * @depends   ../lib/env, execa, @bobops/core (types)
 * @usedBy    `pnpm demo:replay [--run <runId>]` (HUMAN)
 * @agentNotes Replay data is public — providers.json is sanitized again here (no account ids / notes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import { REPO_ROOT, arg } from '../lib/env';
import type { ProviderCapabilities, RunAggregate } from '@bobops/core';

const EVIDENCE = path.join(REPO_ROOT, 'evidence', 'demo-runs');
const UI = path.join(REPO_ROOT, 'apps', 'control-center');
const PUBLIC_REPLAY = path.join(UI, 'public', 'replay');
const SITE = path.join(REPO_ROOT, 'infra', 'ibm-cloud', 'replay-site', 'site');

if (!fs.existsSync(EVIDENCE)) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
}

const only = arg('--run');
const aggregates = fs
  .readdirSync(EVIDENCE)
  .filter((f) => /^run_.*\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(EVIDENCE, f), 'utf8')) as RunAggregate)
  .filter((a) => !only || a.run.id === only);

if (!aggregates.length) {
  console.log('No exported runs in evidence/demo-runs. Checking orchestrator store to generate one...');
  const storePath = path.join(REPO_ROOT, 'apps', 'orchestrator', '.data', 'store.json');
  if (fs.existsSync(storePath)) {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const runIds = Object.keys(store.runs || {});
    if (runIds.length > 0) {
      const runId = runIds[runIds.length - 1];
      const run = store.runs[runId];
      const agg: RunAggregate = {
        run,
        approvals: (Object.values(store.approvals || {}).filter((a: any) => a.runId === runId) as any),
        deployments: (Object.values(store.deployments || {}).filter((d: any) => d.runId === runId) as any),
        healthChecks: (Object.values(store.healthChecks || {}).filter((h: any) => h.runId === runId) as any),
        incidents: (Object.values(store.incidents || {}).filter((i: any) => i.runId === runId) as any),
        events: ((store.events || []).filter((e: any) => e.runId === runId) as any),
      };
      fs.writeFileSync(path.join(EVIDENCE, `${runId}.json`), JSON.stringify(agg, null, 2));
      aggregates.push(agg);
    }
  }
}

if (!aggregates.length) {
  throw new Error('No exported runs found. Export one first via the UI or run API e2e.');
}

fs.rmSync(PUBLIC_REPLAY, { recursive: true, force: true });
fs.mkdirSync(PUBLIC_REPLAY, { recursive: true });
for (const agg of aggregates) {
  fs.writeFileSync(path.join(PUBLIC_REPLAY, `${agg.run.id}.json`), JSON.stringify(agg, null, 2));
}

const runs = aggregates.map((a) => a.run).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
fs.writeFileSync(path.join(PUBLIC_REPLAY, 'runs.json'), JSON.stringify(runs, null, 2));

const providersFile = path.join(EVIDENCE, 'providers.json');
const providers = fs.existsSync(providersFile)
  ? (JSON.parse(fs.readFileSync(providersFile, 'utf8')) as ProviderCapabilities[])
  : [];
fs.writeFileSync(
  path.join(PUBLIC_REPLAY, 'providers.json'),
  JSON.stringify(providers.map((p) => ({ ...p, account: undefined, notes: [] })), null, 2)
);

console.log(`Replay data written for ${aggregates.length} run(s): ${runs.map((r) => r.id).join(', ')}`);

await execa('pnpm', ['--filter', '@bobops/control-center', 'build'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: { ...process.env, NEXT_PUBLIC_MODE: 'replay' }
});

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(path.dirname(SITE), { recursive: true });
const outDir = path.join(UI, 'out');
if (fs.existsSync(outDir)) {
  fs.cpSync(outDir, SITE, { recursive: true });
  console.log('Static replay site staged in infra/ibm-cloud/replay-site/site');
  console.log(`Open locally: npx serve infra/ibm-cloud/replay-site/site  → /run?id=${runs[0]!.id}`);
} else {
  console.log('Build output staged in control-center .next.');
}
