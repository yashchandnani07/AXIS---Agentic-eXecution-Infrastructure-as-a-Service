/**
 * @file      packages/core/src/index.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Public API of @bobops/core. Import ONLY from '@bobops/core' in other packages (never deep paths).
 * @depends   all core modules
 * @usedBy    every workspace package
 * @agentNotes Adding a module? Export it here.
 */
export * from './schemas';
export * from './events';
export * from './state-machine';
export * from './provider-contract';
export * from './util';
export * from './redact';
export * from './probe';
export * from './metrics';
export * from './audit';
export * from './sentinel';
export * from './fixtures';
