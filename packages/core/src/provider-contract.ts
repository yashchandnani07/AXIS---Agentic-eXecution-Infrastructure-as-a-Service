/**
 * @file      packages/core/src/provider-contract.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   The provider-independent cloud contract (PRD §8). IBM Cloud and AWS implement it in V1; Vercel/Railway in V2.
 * @depends   ./schemas, ./events (types)
 * @usedBy    packages/provider-ibm-cloud, packages/provider-aws, orchestrator LifecycleService, FakeProvider (tests)
 * @agentNotes Adapters must: never log secrets, emit progress via ProgressFn (not console), throw Error with a
 *             human-readable message on failure. HTTP health verification is provider-independent (see probe.ts).
 */
import type { EventType } from './events';
import type { EventKind, Evidence, ProviderId, Resource, ServiceId, TargetPlan } from './schemas';

export interface ProgressEvent {
  type: EventType;
  message: string;
  kind?: EventKind;
  evidence?: Evidence[];
}
export type ProgressFn = (event: ProgressEvent) => void;

export interface DeployInput {
  runId: string;
  target: TargetPlan;
  /** absolute path to the application source (contains Dockerfile / src/lambda.ts) */
  sourceDir: string;
  /** resolved secret values keyed by secretRef name — adapters must store them in the provider secret mechanism */
  secrets: Record<string, string>;
}

export interface DeployResult {
  endpoint: string;
  revision: string;
  evidence: Evidence[];
}

export interface DeploymentRef {
  provider: ProviderId;
  /** which of the two real architectures on this cloud is live (see SERVICE_CATALOG) — adapters branch on this */
  service: ServiceId;
  appName: string;
  region: string;
  endpoint?: string;
  revision?: string;
}

export interface ProviderCapabilities {
  provider: ProviderId;
  displayName: string;
  authenticated: boolean;
  account?: string;
  region: string;
  /** underlying primitives this adapter uses, e.g. ['code-engine', 'container-registry'] — free-form, for display */
  services: string[];
  /** the real, deployable architecture choices on this cloud (see SERVICE_CATALOG) — what the UI/Bob can actually pick */
  offeredServices: ServiceId[];
  supportsRollback: boolean;
  notes: string[];
}

export interface ProviderStatus {
  state: 'ready' | 'deploying' | 'failed' | 'not_found' | 'unknown';
  revision?: string;
  endpoint?: string;
  /** runtime env as reported by the provider (callers must redact before storing) */
  env: Record<string, string>;
  raw: unknown;
}

export interface EnvChange {
  set?: Record<string, string>;
  remove?: string[];
}

export interface CloudProvider {
  readonly id: ProviderId;
  /** capability discovery + auth check (cache for ~60 s) */
  capabilities(): Promise<ProviderCapabilities>;
  /** provider-specific plan generation: resources this target will create/reuse */
  planResources(target: TargetPlan): Resource[];
  /** provision + build + deploy; resolves when the new revision is serving */
  deploy(input: DeployInput, progress: ProgressFn): Promise<DeployResult>;
  /** provider-native status */
  status(ref: DeploymentRef): Promise<ProviderStatus>;
  /** diagnostics: recent runtime log lines */
  logs(ref: DeploymentRef, lines: number): Promise<string[]>;
  /** configuration change → new revision (used for remediation and controlled fault injection) */
  setEnv(ref: DeploymentRef, change: EnvChange, progress: ProgressFn): Promise<DeployResult>;
  /** rollback to a previous revision (toRevision omitted = previous one) */
  rollback(ref: DeploymentRef, progress: ProgressFn, toRevision?: string): Promise<DeployResult>;
}
