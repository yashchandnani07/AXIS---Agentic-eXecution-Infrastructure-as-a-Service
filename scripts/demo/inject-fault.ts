/**
 * @file      scripts/demo/inject-fault.ts
 * @phase     P8
 * @owner     Product & Experience
 * @purpose   Presenter tool: injects the controlled fault (removes CATALOG_MODE) on one provider of a healthy run.
 * @depends   ../lib/env, @bobops/core
 * @usedBy    `pnpm demo:fault [--run <id>] [--provider ibm-cloud|aws] [--key CATALOG_MODE]` (HUMAN)
 * @agentNotes Human-only (uses the approval token). The Control Center has the same control behind ?demo=1.
 */
import { arg, requireEnv } from '../lib/env';
import { ProviderIdSchema, type Run } from '@bobops/core';

const API = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000';

async function main() {
  const token = requireEnv('APPROVAL_TOKEN');
  let runId = arg('--run');
  if (!runId) {
    const runs = (await (await fetch(`${API}/api/runs`)).json()) as Run[];
    runId = runs.find((r) => r.state === 'healthy')?.id;
    if (!runId) throw new Error('No healthy run found. Pass --run <id>.');
  }
  const provider = ProviderIdSchema.parse(arg('--provider') ?? 'ibm-cloud');
  const key = arg('--key') ?? 'CATALOG_MODE';
  console.log(`Injecting fault: remove ${key} on ${provider} for run ${runId} …`);
  const res = await fetch(`${API}/api/demo/fault`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-approval-token': token },
    body: JSON.stringify({ runId, provider, key }),
  });
  console.log(res.status, await res.text());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
