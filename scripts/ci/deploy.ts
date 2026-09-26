/**
 * @file      scripts/ci/deploy.ts
 * @phase     P12 (COULD)
 * @owner     Product & Experience
 * @purpose   CI deployment entry for deploy.yml: deploys the demo app to ONE provider through the same adapter the
 *            orchestrator uses, then verifies /health (non-zero exit if unhealthy).
 * @depends   ../lib/env, @bobops/core, @bobops/provider-ibm-cloud, @bobops/provider-aws
 * @usedBy    .github/workflows/deploy.yml
 * @agentNotes V1 uses the reference plan (examplePlan). V2: consume the orchestrator-approved plan exported with the run.
 */
import path from 'node:path';
import { REPO_ROOT, requireEnv } from '../lib/env';
import { ProviderIdSchema, examplePlan, probeHealth, type CloudProvider } from '@bobops/core';
import { AwsLambdaProvider } from '@bobops/provider-aws';
import { IbmCloudProvider } from '@bobops/provider-ibm-cloud';

const providerId = ProviderIdSchema.parse(process.env.DEPLOY_PROVIDER);
const target = examplePlan([providerId]).targets[0]!;
const provider: CloudProvider =
  providerId === 'ibm-cloud'
    ? new IbmCloudProvider({
        apiKey: requireEnv('IBMCLOUD_API_KEY'),
        region: process.env.IBMCLOUD_REGION ?? 'us-south',
        resourceGroup: process.env.IBMCLOUD_RESOURCE_GROUP ?? 'Default',
        project: process.env.IBM_CE_PROJECT ?? 'bobops-demo',
      })
    : new AwsLambdaProvider({ region: process.env.AWS_REGION ?? 'us-east-1', roleArn: requireEnv('AWS_LAMBDA_ROLE_ARN') });

const adminToken = process.env.SECRET_ADMIN_TOKEN;
const result = await provider.deploy(
  {
    runId: `ci-${process.env.GITHUB_RUN_ID ?? 'local'}`,
    target: { ...target, env: { ...target.env, APP_VERSION: process.env.GITHUB_SHA?.slice(0, 7) ?? target.env.APP_VERSION ?? 'ci' } },
    sourceDir: path.join(REPO_ROOT, 'apps', 'demo-service'),
    secrets: adminToken ? { ADMIN_TOKEN: adminToken } : {},
  },
  (e) => console.log(`[${e.type}] ${e.message}`),
);
await new Promise((r) => setTimeout(r, 5000));
const check = await probeHealth({ provider: providerId, endpoint: result.endpoint, healthPath: target.healthPath });
console.log(JSON.stringify({ endpoint: result.endpoint, revision: result.revision, health: { ok: check.ok, statusCode: check.statusCode } }, null, 2));
if (!check.ok) process.exit(1);
