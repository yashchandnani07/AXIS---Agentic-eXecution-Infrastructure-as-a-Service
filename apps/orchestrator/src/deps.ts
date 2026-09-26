/**
 * @file      apps/orchestrator/src/deps.ts
 * @phase     P4 (replaced in P5; replaced again in P8, P12)
 * @owner     Orchestration & Cloud
 * @purpose   Composition root: builds every service once and wires them together. Tests pass overrides (fakes).
 * @depends   @bobops/core, ./config, ./store, ./events, ./services, ./ports
 * @usedBy    src/index.ts, src/app.ts, tests
 * @agentNotes Add new services HERE, never `new` them inside routes.
 */
import { probeHealth, type CloudProvider, type ProbeFn, type ProviderId } from '@bobops/core';
import type { Config } from './config';
import { EventBus } from './events/event-bus';
import type { GitHubPort } from './ports';
import { LifecycleService } from './services/lifecycle-service';
import { RunService } from './services/run-service';
import { runPackageTests, type TestResult } from './services/test-runner';
import { JsonStore } from './store/json-store';

export interface Deps {
  config: Config;
  store: JsonStore;
  bus: EventBus;
  runs: RunService;
  lifecycle: LifecycleService;
  providers: Map<ProviderId, CloudProvider>;
}

export interface DepOverrides {
  providers?: Map<ProviderId, CloudProvider>;
  probe?: ProbeFn;
  runTests?: (sourceDir: string) => Promise<TestResult>;
  github?: GitHubPort | null;
  retryDelayMs?: number;
}

export function createDeps(config: Config, o: DepOverrides = {}): Deps {
  const store = new JsonStore(config.dataFile);
  const bus = new EventBus(store);
  const runs = new RunService(store, bus, config.repoRoot);
  const providers = o.providers ?? new Map<ProviderId, CloudProvider>();
  const lifecycle = new LifecycleService({
    store,
    bus,
    runs,
    providers,
    probe: o.probe ?? probeHealth,
    runTests: o.runTests ?? runPackageTests,
    repoRoot: config.repoRoot,
    resolveSecret: (name) => config.secrets[name],
    github: o.github ?? null,
    retryDelayMs: o.retryDelayMs ?? 5000,
    demoMode: config.demoMode,
  });
  return { config, store, bus, runs, lifecycle, providers };
}
