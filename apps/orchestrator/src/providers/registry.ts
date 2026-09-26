/**
 * @file      apps/orchestrator/src/providers/registry.ts
 * @phase     P8
 * @owner     Orchestration & Cloud
 * @purpose   Builds the real provider adapters from config. The ONLY place the orchestrator knows concrete clouds.
 * @depends   @bobops/provider-ibm-cloud, @bobops/provider-aws, ../config
 * @usedBy    deps.ts (default providers)
 * @agentNotes V2: add `['vercel', new VercelProvider(...)]` here (+ extend ProviderIdSchema) — the workflow code stays unchanged.
 */
import type { CloudProvider, ProviderId } from '@bobops/core';
import { AwsLambdaProvider } from '@bobops/provider-aws';
import { IbmCloudProvider } from '@bobops/provider-ibm-cloud';
import type { Config } from '../config';

export function buildProviders(config: Config): Map<ProviderId, CloudProvider> {
  return new Map<ProviderId, CloudProvider>([
    [
      'ibm-cloud',
      new IbmCloudProvider({
        apiKey: config.IBMCLOUD_API_KEY,
        region: config.IBMCLOUD_REGION,
        resourceGroup: config.IBMCLOUD_RESOURCE_GROUP,
        project: config.IBM_CE_PROJECT,
      }),
    ],
    ['aws', new AwsLambdaProvider({ region: config.AWS_REGION, roleArn: config.AWS_LAMBDA_ROLE_ARN })],
  ]);
}
