/**
 * @file      scripts/smoke/deploy-ibm.ts
 * @phase     P6
 * @owner     Orchestration & Cloud
 * @purpose   Deploys Nimbus Books to IBM Cloud Code Engine directly through the adapter (no orchestrator) and probes it.
 *            Proves credentials + adapter + Dockerfile work, and pre-warms the app/registry for the live demo.
 * @depends   ../lib/env, @bobops/core, @bobops/provider-ibm-cloud
 * @usedBy    `pnpm smoke:ibm [-- --scale-to-zero]` (HUMAN — creates real cloud resources)
 * @agentNotes Requires golden assets in apps/demo-service (run `pnpm demo:golden` first). Pass --scale-to-zero to smoke
 *             test the OTHER real architecture (min-scale 0) instead of the always-on default.
 */
import path from 'node:path';
import { probeHealth, type ServiceId } from '@bobops/core';
import { IbmCloudProvider } from '@bobops/provider-ibm-cloud';
import { REPO_ROOT, requireEnv } from '../lib/env';

const region = process.env.IBMCLOUD_REGION ?? 'us-south';
const service: ServiceId = process.argv.includes('--scale-to-zero') ? 'code-engine-scale-to-zero' : 'code-engine';
const provider = new IbmCloudProvider({
  apiKey: requireEnv('IBMCLOUD_API_KEY'),
  region,
  resourceGroup: process.env.IBMCLOUD_RESOURCE_GROUP ?? 'Default',
  project: process.env.IBM_CE_PROJECT ?? 'bobops-demo',
});

console.log('Capabilities:', await provider.capabilities());
console.log(`Deploying with service = ${service}`);
const adminToken = process.env.SECRET_ADMIN_TOKEN;
const result = await provider.deploy(
  {
    runId: 'smoke',
    sourceDir: path.join(REPO_ROOT, 'apps', 'demo-service'),
    secrets: adminToken ? { ADMIN_TOKEN: adminToken } : {},
    target: {
      provider: 'ibm-cloud',
      service,
      region,
      appName: 'bobops-nimbus-books',
      port: 8080,
      healthPath: '/health',
      env: { CATALOG_MODE: 'featured', APP_VERSION: 'smoke-1', DEPLOY_PROVIDER: 'ibm-cloud' },
      secretRefs: ['ADMIN_TOKEN'],
      architectureRationale: 'Smoke test target, chosen via --scale-to-zero flag or default (always-on).',
      resources: [],
    },
  },
  (e) => console.log(`[${e.type}] ${e.message}`),
);
console.log('Deploy result:', { endpoint: result.endpoint, revision: result.revision });
console.log('Health probe:', await probeHealth({ provider: 'ibm-cloud', endpoint: result.endpoint, healthPath: '/health' }));
console.log('Logs (last 10):', await provider.logs({ provider: 'ibm-cloud', service, appName: 'bobops-nimbus-books', region }, 10));
