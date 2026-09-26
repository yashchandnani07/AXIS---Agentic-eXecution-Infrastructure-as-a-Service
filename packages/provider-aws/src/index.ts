/**
 * @file      packages/provider-aws/src/index.ts
 * @phase     P7
 * @owner     Orchestration & Cloud
 * @purpose   Public API of @bobops/provider-aws.
 * @depends   ./provider, ./bundle, ./versions
 * @usedBy    orchestrator registry, scripts
 * @agentNotes Export only what other packages need.
 */
export { AwsLambdaProvider, LAMBDA_ALIAS, type AwsConfig } from './provider';
export { bundleLambda } from './bundle';
export { pickPreviousVersion } from './versions';
