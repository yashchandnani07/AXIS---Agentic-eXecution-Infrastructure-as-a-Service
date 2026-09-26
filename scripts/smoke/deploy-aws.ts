/**
 * @file      scripts/smoke/deploy-aws.ts
 * @phase     P7
 * @owner     Orchestration & Cloud
 * @purpose   Deploys Nimbus Books to AWS Lambda directly through the adapter and probes the public Function URL.
 * @depends   ../lib/env, @bobops/core, @bobops/provider-aws
 * @usedBy    `pnpm smoke:aws [-- --provisioned]` (HUMAN — creates real cloud resources)
 * @agentNotes Requires apps/demo-service/src/lambda.ts (run `pnpm demo:golden` first). Pass --provisioned to smoke test
 *             the OTHER real architecture (provisioned concurrency) instead of the on-demand default.
 */
import path from 'node:path';
import { probeHealth, type ServiceId } from '@bobops/core';
import { AwsLambdaProvider } from '@bobops/provider-aws';
import { REPO_ROOT, requireEnv } from '../lib/env';

const region = process.env.AWS_REGION ?? 'us-east-1';
const service: ServiceId = process.argv.includes('--provisioned') ? 'lambda-provisioned' : 'lambda';
const provider = new AwsLambdaProvider({ region, roleArn: requireEnv('AWS_LAMBDA_ROLE_ARN') });

console.log('Capabilities:', await provider.capabilities());
console.log(`Deploying with service = ${service}`);
const adminToken = process.env.SECRET_ADMIN_TOKEN;
const result = await provider.deploy(
  {
    runId: 'smoke',
    sourceDir: path.join(REPO_ROOT, 'apps', 'demo-service'),
    secrets: adminToken ? { ADMIN_TOKEN: adminToken } : {},
    target: {
      provider: 'aws',
      service,
      region,
      appName: 'bobops-nimbus-books',
      port: 8080,
      healthPath: '/health',
      env: { CATALOG_MODE: 'featured', APP_VERSION: 'smoke-1', DEPLOY_PROVIDER: 'aws' },
      secretRefs: ['ADMIN_TOKEN'],
      architectureRationale: 'Smoke test target, chosen via --provisioned flag or default (on-demand).',
      resources: [],
    },
  },
  (e) => console.log(`[${e.type}] ${e.message}`),
);
console.log('Deploy result:', { endpoint: result.endpoint, revision: result.revision });
await new Promise((r) => setTimeout(r, 5000)); // new Function URLs need a few seconds
console.log('Health probe:', await probeHealth({ provider: 'aws', endpoint: result.endpoint, healthPath: '/health' }));
