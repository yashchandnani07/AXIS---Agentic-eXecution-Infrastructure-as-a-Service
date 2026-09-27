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

const only = arg('--run');
const aggregates = fs
  .readdirSync(EVIDENCE)
  .filter((f) => /^run_.*\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(EVIDENCE, f), 'utf8')) as RunAggregate)
  .filter((a) => !only || a.run.id === only);
if (!aggregates.length) throw new Error('No exported runs in evidence/demo-runs. Export one first (devops_export_evidence).');

fs.rmSync(PUBLIC_REPLAY, { recursive: true, force: true });
fs.mkdirSync(PUBLIC_REPLAY, { recursive: true });
for (const agg of aggregates) fs.writeFileSync(path.join(PUBLIC_REPLAY, `${agg.run.id}.json`), JSON.stringify(agg));
const runs = aggregates.map((a) => a.run).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
fs.writeFileSync(path.join(PUBLIC_REPLAY, 'runs.json'), JSON.stringify(runs));

const providersFile = path.join(EVIDENCE, 'providers.json');
const providers = fs.existsSync(providersFile) ? (JSON.parse(fs.readFileSync(providersFile, 'utf8')) as ProviderCapabilities[]) : [];
fs.writeFileSync(path.join(PUBLIC_REPLAY, 'providers.json'), JSON.stringify(providers.map((p) => ({ ...p, account: undefined, notes: [] }))));
console.log(`Replay data written for ${aggregates.length} run(s): ${runs.map((r) => r.id).join(', ')}`);

await execa('pnpm', ['--filter', '@bobops/control-center', 'build'], { cwd: REPO_ROOT, stdio: 'inherit', env: { NEXT_PUBLIC_MODE: 'replay' } });

fs.rmSync(SITE, { recursive: true, force: true });
fs.cpSync(path.join(UI, 'out'), SITE, { recursive: true });
console.log('Static replay site staged in infra/ibm-cloud/replay-site/site');
console.log(`Open locally: npx serve infra/ibm-cloud/replay-site/site  → /run?id=${runs[0]!.id}`);
