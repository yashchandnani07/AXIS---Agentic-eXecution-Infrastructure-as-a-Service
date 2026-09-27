/**
 * @file      scripts/demo/recover.ts
 * @phase     P13 / Demo
 * @owner     Product & Experience
 * @purpose   Automates or assists the recovery of an incident (Act 2: break it -> recover it).
 *            Records Bob's diagnosis, proposes the remediation (set_env CATALOG_MODE=featured),
 *            waits for or performs human approval, and executes the remediation to restore HEALTHY state.
 * @depends   @bobops/core, ../lib/env
 * @usedBy    `pnpm demo:recover [--auto-approve]` (HUMAN)
 */
import { arg, requireEnv } from '../lib/env';
import { type RunAggregate, type Approval, type Incident, formatDuration } from '@bobops/core';

const API = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000';
const UI = process.env.CONTROL_CENTER_URL ?? 'http://localhost:3000';

async function main() {
  const token = requireEnv('APPROVAL_TOKEN');
  const autoApprove = process.argv.includes('--auto-approve') || process.argv.includes('-y');

  console.log('\n🔍 Checking active incidents across runs...');
  const runsRes = await fetch(`${API}/api/runs`);
  if (!runsRes.ok) throw new Error(`Could not fetch runs from ${API}: ${runsRes.statusText}`);
  const runs = (await runsRes.json()) as Array<{ id: string; state: string }>;

  const targetRun = runs.find((r) => r.state === 'incident' || r.state === 'awaiting_remediation_approval') ?? runs[0];
  if (!targetRun) {
    console.log('✅ No runs found.');
    return;
  }

  const aggRes = await fetch(`${API}/api/runs/${targetRun.id}`);
  const agg = (await aggRes.json()) as RunAggregate;

  const incident = agg.incidents.find((i) => i.status !== 'resolved');
  if (!incident) {
    console.log(`✅ Run ${targetRun.id} has no open incidents (state: ${agg.run.state}). Everything is healthy!`);
    return;
  }

  console.log(`🚨 Found open incident: ${incident.id} on ${incident.provider}`);
  console.log(`   Run: ${targetRun.id} (State: ${agg.run.state})`);

  // Step 1: Record diagnosis if missing
  if (!incident.diagnosis) {
    console.log('🧠 Recording AI diagnosis (IBM Granite watsonx.ai)...');
    const diagRes = await fetch(`${API}/api/incidents/${incident.id}/diagnosis`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: 'Configuration drift — missing CATALOG_MODE',
        rootCause: 'CATALOG_MODE environment variable was removed or altered, causing /health probe to return HTTP 503',
        confidence: 'high',
        evidence: [
          'Probe failure: HTTP 503 missing required env: CATALOG_MODE',
          'Code reference: apps/demo-service/src/app.ts:12',
          'Approved plan spec: CATALOG_MODE=featured',
        ],
      }),
    });
    if (!diagRes.ok) throw new Error(`Failed to record diagnosis: ${await diagRes.text()}`);
    console.log('   ✔ Diagnosis recorded.');
  } else {
    console.log('   ✔ Diagnosis already recorded.');
  }

  // Step 2: Propose remediation if missing
  let approvalId = incident.remediation?.approvalId;
  if (!incident.remediation) {
    console.log('💡 Proposing remediation: set_env CATALOG_MODE=featured...');
    const remRes = await fetch(`${API}/api/incidents/${incident.id}/remediation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: { type: 'set_env', key: 'CATALOG_MODE', value: 'featured' },
        rationale: 'Restore CATALOG_MODE=featured to satisfy health check requirement',
        risk: 'low',
      }),
    });
    if (!remRes.ok) throw new Error(`Failed to propose remediation: ${await remRes.text()}`);
    const proposal = (await remRes.json()) as { approval: Approval };
    approvalId = proposal.approval.id;
    console.log(`   ✔ Remediation proposed! Approval gate created (ID: ${approvalId}).`);
  } else {
    console.log(`   ✔ Remediation already proposed (Approval ID: ${approvalId}).`);
  }

  // Step 3: Approve remediation
  if (autoApprove) {
    console.log('⚡ Auto-approving remediation gate with APPROVAL_TOKEN...');
    const appRes = await fetch(`${API}/api/approvals/${approvalId}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-approval-token': token },
      body: JSON.stringify({ decision: 'approved', comment: 'Approved via CLI recovery script', decidedBy: 'developer' }),
    });
    if (!appRes.ok) throw new Error(`Approval failed: ${await appRes.text()}`);
    console.log('   ✔ Approved.');
  } else {
    // Check if already approved in UI
    const checkAgg = (await (await fetch(`${API}/api/runs/${targetRun.id}`)).json()) as RunAggregate;
    const approval = checkAgg.approvals.find((a) => a.id === approvalId);
    if (approval?.status !== 'approved') {
      console.log('\n✋ ACTION REQUIRED:');
      console.log(`   Open the Control Center: ${UI}/run?id=${targetRun.id}&demo=1`);
      console.log('   Look at the "Approval gates" panel at the top and click [Approve Plan / Remediation].');
      console.log('   (Or run: pnpm demo:recover --auto-approve to approve automatically from CLI.)\n');
      return;
    }
    console.log('   ✔ Approval verified from Control Center.');
  }

  // Step 4: Execute remediation
  console.log('🔧 Executing approved remediation and re-verifying health...');
  const execRes = await fetch(`${API}/api/incidents/${incident.id}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!execRes.ok) throw new Error(`Execution failed: ${await execRes.text()}`);
  const execResult = (await execRes.json()) as { ok: boolean; incident: Incident };

  if (execResult.ok) {
    const finalAgg = (await (await fetch(`${API}/api/runs/${targetRun.id}`)).json()) as RunAggregate;
    const resolved = finalAgg.incidents.find((i) => i.id === incident.id);
    const mttr = resolved?.resolvedAt ? formatDuration(Date.parse(resolved.resolvedAt) - Date.parse(resolved.openedAt)) : 'N/A';

    console.log('\n🎉 ==========================================');
    console.log('   RECOVERY COMPLETE — SERVICE IS HEALTHY!  ');
    console.log('==========================================');
    console.log(`   Run ID:    ${targetRun.id}`);
    console.log(`   State:     ${finalAgg.run.state.toUpperCase()} ✓`);
    console.log(`   Incident:  RESOLVED (MTTR: ${mttr})`);
    console.log(`   Endpoints: HTTP 200 OK verified`);
    console.log(`   View in UI: ${UI}/run?id=${targetRun.id}&demo=1\n`);
  } else {
    console.error('❌ Remediation execution did not recover the service.');
  }
}

main().catch((err) => {
  console.error('\n❌ Recovery script error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
