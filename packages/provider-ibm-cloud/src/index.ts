/**
 * @file      packages/provider-ibm-cloud/src/index.ts
 * @phase     P6
 * @owner     Orchestration & Cloud
 * @purpose   Public API of @bobops/provider-ibm-cloud.
 * @depends   ./provider, ./parse
 * @usedBy    orchestrator registry, scripts
 * @agentNotes Export only what other packages need.
 */
export { IbmCloudProvider, type IbmCloudConfig } from './provider';
export { extractJson, parseCodeEngineApp, parseRevisions, type ParsedCodeEngineApp } from './parse';
export { ibmcloud, IbmCloudCliError } from './cli';
