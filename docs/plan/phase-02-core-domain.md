<!--
@file     docs/plan/phase-02-core-domain.md
@purpose  Build packages/core: the single source of truth (schemas, state machine, provider contract, probe, sentinel format).
@owner    Orchestration & Cloud (O); Product & Experience (P) reviews the types before building UI.
-->
# Phase 02 — `packages/core` domain (~75 min)

**Goal:** One isomorphic package (it runs in Node *and* the browser) that defines every domain object, the run state
machine, the event taxonomy, the cloud provider contract, the HTTP health probe, metrics, the audit-markdown renderer, the
sentinel issue format, and a valid example profile and plan. **Every other package imports from here.**

**Depends on:** Phase 01.
**Interfaces produced (later phases rely on these exact names):**
- Schemas/types: `ProviderIdSchema/ProviderId`, `RunStateSchema/RunState`, `EventKindSchema/EventKind`, `ActorSchema/Actor`,
  `SpecialistSchema/Specialist`, `SeveritySchema/Severity`, `RiskSchema/Risk`, `SpecialistFindingSchema/SpecialistFinding`,
  `AppProfileSchema/AppProfile`, `ResourceSchema/Resource`, `TargetPlanSchema/TargetPlan`, `DeploymentPlanSchema/DeploymentPlan`,
  `EvidenceSchema/Evidence`, `RunEventSchema/RunEvent`, `ApprovalSchema/Approval`, `HealthCheckSchema/HealthCheck`,
  `DeploymentSchema/Deployment`, `RemediationActionSchema/RemediationAction`, `DiagnosisSchema/Diagnosis`,
  `RemediationSchema/Remediation`, `IncidentSchema/Incident`, `RunSchema/Run`, `WaitConditionSchema/WaitCondition`,
  `RunAggregate`, `APP_NAME_PATTERN`
- `EVENT_TYPES`, `EventType`, `LIFECYCLE_STAGES`, `LifecycleStage`, `stageForEvent()`, `stageForState()`
- `TRANSITIONS`, `canTransition()`, `assertTransition()`, `InvalidTransitionError`
- `CloudProvider`, `DeployInput`, `DeployResult`, `DeploymentRef`, `ProviderCapabilities`, `ProviderStatus`, `ProgressEvent`, `ProgressFn`, `EnvChange`
- `nowIso()`, `newId()`, `evidence()`, `providerActor()`, `stableStringify()`, `describeAction()`, `describeEnvChange()`
- `isSecretKey()`, `redactEnv()`, `redactText()`
- `probeHealth()`, `ProbeOptions`, `ProbeFn`
- `computeMetrics()`, `RunMetrics`, `formatDuration()`
- `renderAuditMarkdown()`
- `SENTINEL_LABEL`, `SentinelTargetSchema/SentinelTarget`, `SentinelIncidentPayloadSchema/SentinelIncidentPayload`,
  `consecutiveFailures()`, `incidentTitle()`, `renderIssueBody()`, `parseIssueBody()`, `renderStepSummary()`
- `EXAMPLE_APP_PROFILE`, `examplePlan()`

---

### Task 2.1 — Package scaffold

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@bobops/core",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": { "zod": "^3.25.0" }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3:** `pnpm install` → Expected: `Done`.

### Task 2.2 — Events and lifecycle stages

- [ ] **Step 1: Create `packages/core/src/events.ts`**

```ts
/**
 * @file      packages/core/src/events.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Canonical audit event types and their mapping to the 8 lifecycle stages shown in the UI.
 * @depends   (type-only) ./schemas
 * @usedBy    schemas.ts (RunEventSchema), orchestrator (emits), control-center (stepper)
 * @agentNotes Adding an event type? Add it to EVENT_TYPES and, if it belongs to a stage, make its prefix map in PREFIX_STAGE.
 */
import type { RunState } from './schemas';

export const EVENT_TYPES = [
  'run.created',
  'analysis.recorded',
  'specialist.finding',
  'bob.note',
  'plan.submitted',
  'approval.requested',
  'approval.decided',
  'guard.blocked',
  'test.started',
  'test.passed',
  'test.failed',
  'provision.started',
  'provision.completed',
  'build.started',
  'build.completed',
  'deploy.started',
  'deploy.completed',
  'deploy.failed',
  'verify.passed',
  'verify.failed',
  'sentinel.armed',
  'fault.injected',
  'incident.opened',
  'incident.diagnosed',
  'remediation.proposed',
  'remediation.started',
  'remediation.completed',
  'remediation.failed',
  'incident.resolved',
  'provider.progress',
  'orchestrator.warning',
  'evidence.exported',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const LIFECYCLE_STAGES = ['UNDERSTAND', 'PLAN', 'PROVISION', 'BUILD', 'TEST', 'DEPLOY', 'VERIFY', 'RECOVER'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

const PREFIX_STAGE: Record<string, LifecycleStage> = {
  run: 'UNDERSTAND',
  analysis: 'UNDERSTAND',
  specialist: 'UNDERSTAND',
  plan: 'PLAN',
  approval: 'PLAN',
  provision: 'PROVISION',
  build: 'BUILD',
  test: 'TEST',
  deploy: 'DEPLOY',
  verify: 'VERIFY',
  sentinel: 'VERIFY',
  fault: 'RECOVER',
  incident: 'RECOVER',
  remediation: 'RECOVER',
};

/** Stage an event belongs to, or null for cross-cutting events (bob.note, guard.blocked, …). */
export function stageForEvent(type: EventType): LifecycleStage | null {
  const prefix = type.split('.')[0] ?? '';
  return PREFIX_STAGE[prefix] ?? null;
}

/** Stage the run is currently in, derived from its state. */
export function stageForState(state: RunState): LifecycleStage {
  switch (state) {
    case 'created':
    case 'analyzed':
      return 'UNDERSTAND';
    case 'awaiting_approval':
    case 'approved':
    case 'rejected':
      return 'PLAN';
    case 'deploying':
      return 'DEPLOY';
    case 'verifying':
    case 'healthy':
    case 'failed':
      return 'VERIFY';
    case 'incident':
    case 'awaiting_remediation_approval':
    case 'remediating':
      return 'RECOVER';
  }
}
```

### Task 2.3 — Secret detection and redaction

- [ ] **Step 1: Create `packages/core/src/redact.ts`**

```ts
/**
 * @file      packages/core/src/redact.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Decide what counts as a secret and scrub secrets from env maps and free text before they reach evidence.
 * @depends   —
 * @usedBy    schemas.ts (plan env refinement), orchestrator (evidence), provider adapters (CLI output)
 * @agentNotes Never weaken SECRET_KEY_PATTERN. If a key is secret it must travel via plan.secretRefs, not plan.env.
 */
export const SECRET_KEY_PATTERN = /(TOKEN|SECRET|PASSWORD|API_?KEY|PRIVATE)/i;
export const REDACTED = '••••redacted';

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function redactEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, isSecretKey(k) ? REDACTED : v]));
}

/** Replace every occurrence of each secret value (length >= 4) in text. */
export function redactText(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((s) => typeof s === 'string' && s.length >= 4)
    .reduce((acc, secret) => acc.split(secret).join(REDACTED), text);
}
```

### Task 2.4 — Schemas (single source of truth)

- [ ] **Step 1: Create `packages/core/src/schemas.ts`**

```ts
/**
 * @file      packages/core/src/schemas.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Every domain object as a zod schema + inferred TypeScript type. The ONLY place these shapes are declared.
 * @depends   zod, ./events, ./redact
 * @usedBy    orchestrator (request validation), bob-mcp (MCP tool input schemas), control-center (types), scripts
 * @agentNotes Change shapes here first, then run `pnpm typecheck` to find every consumer. Keep defaults stable:
 *             MCP turns these schemas into JSON Schema that Bob reads.
 */
import { z } from 'zod';
import { EVENT_TYPES } from './events';
import { isSecretKey } from './redact';

export const ProviderIdSchema = z.enum(['ibm-cloud', 'aws']);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const RunStateSchema = z.enum([
  'created',
  'analyzed',
  'awaiting_approval',
  'approved',
  'rejected',
  'deploying',
  'verifying',
  'healthy',
  'failed',
  'incident',
  'awaiting_remediation_approval',
  'remediating',
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const EventKindSchema = z.enum(['observation', 'inference', 'proposal', 'action', 'verification']);
export type EventKind = z.infer<typeof EventKindSchema>;

export const ActorSchema = z.enum(['bob', 'human', 'orchestrator', 'sentinel', 'provider:ibm-cloud', 'provider:aws']);
export type Actor = z.infer<typeof ActorSchema>;

export const SpecialistSchema = z.enum([
  'application-analyst',
  'cloud-architect',
  'security-reviewer',
  'release-verifier',
  'incident-investigator',
]);
export type Specialist = z.infer<typeof SpecialistSchema>;

export const SeveritySchema = z.enum(['low', 'medium', 'high']);
export type Severity = z.infer<typeof SeveritySchema>;

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const RiskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: SeveritySchema,
  mitigation: z.string().min(1),
});
export type Risk = z.infer<typeof RiskSchema>;

export const SpecialistFindingSchema = z.object({
  specialist: SpecialistSchema,
  summary: z.string().min(1),
  findings: z.array(z.string().min(1)).min(1),
  confidence: ConfidenceSchema,
  /** file:line references, commands or tool outputs supporting the findings */
  evidence: z.array(z.string()).default([]),
});
export type SpecialistFinding = z.infer<typeof SpecialistFindingSchema>;

export const AppProfileSchema = z.object({
  name: z.string().min(1),
  runtime: z.string().min(1),
  runtimeVersion: z.string().min(1),
  framework: z.string().min(1),
  buildCommand: z.string().min(1),
  startCommand: z.string().min(1),
  port: z.number().int().positive(),
  healthPath: z.string().startsWith('/'),
  requiredEnv: z.array(z.string()),
  secretEnv: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  specialistFindings: z.array(SpecialistFindingSchema).min(1),
  risks: z.array(RiskSchema).default([]),
});
export type AppProfile = z.infer<typeof AppProfileSchema>;

export const ResourceSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  action: z.enum(['create', 'update', 'reuse']),
});
export type Resource = z.infer<typeof ResourceSchema>;

/** Safety boundary: Bob may only create/modify resources whose names match this. */
export const APP_NAME_PATTERN = /^bobops-[a-z0-9-]{3,40}$/;

export const TargetPlanSchema = z
  .object({
    provider: ProviderIdSchema,
    service: z.enum(['code-engine', 'lambda']),
    region: z.string().min(1),
    appName: z.string().regex(APP_NAME_PATTERN, 'appName must match ^bobops-[a-z0-9-]{3,40}$'),
    port: z.number().int().positive().default(8080),
    resources: z.array(ResourceSchema).default([]),
    /** NON-secret configuration only. Secret keys are rejected; use secretRefs. */
    env: z.record(z.string()).default({}),
    /** Names of secrets resolved by the orchestrator from SECRET_<NAME> and stored in the provider's secret mechanism. */
    secretRefs: z.array(z.string()).default([]),
    healthPath: z.string().startsWith('/').default('/health'),
  })
  .refine((t) => (t.provider === 'ibm-cloud') === (t.service === 'code-engine'), {
    message: 'ibm-cloud targets use service "code-engine"; aws targets use service "lambda"',
  })
  .refine((t) => Object.keys(t.env).every((k) => !isSecretKey(k)), {
    message: 'Secret-looking keys (TOKEN/SECRET/PASSWORD/API_KEY/PRIVATE) must be listed in secretRefs, not env',
  });
export type TargetPlan = z.infer<typeof TargetPlanSchema>;

export const DeploymentPlanSchema = z.object({
  summary: z.string().min(1),
  targets: z.array(TargetPlanSchema).min(1),
  risks: z.array(RiskSchema).default([]),
  generatedAssets: z.array(z.object({ path: z.string(), purpose: z.string() })).default([]),
  rollbackStrategy: z.string().min(1),
  approvalGates: z.array(z.string()).min(1),
  estimatedMonthlyCostUsd: z.number().nonnegative().optional(),
});
export type DeploymentPlan = z.infer<typeof DeploymentPlanSchema>;

export const EvidenceSchema = z.object({
  label: z.string(),
  source: z.string(),
  capturedAt: z.string(),
  data: z.unknown(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const RunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  at: z.string(),
  actor: ActorSchema,
  kind: EventKindSchema,
  type: z.enum(EVENT_TYPES),
  message: z.string(),
  evidence: z.array(EvidenceSchema).default([]),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const ApprovalSchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: z.enum(['deploy_plan', 'remediation']),
  /** run id (deploy_plan) or remediation id (remediation) */
  subjectId: z.string(),
  /** sha256 of what the human is approving — execution is refused if it no longer matches */
  subjectHash: z.string(),
  summary: z.string(),
  risk: SeveritySchema,
  status: z.enum(['pending', 'approved', 'rejected']),
  requestedAt: z.string(),
  decidedAt: z.string().optional(),
  decidedBy: z.string().optional(),
  comment: z.string().optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const HealthCheckSchema = z.object({
  id: z.string(),
  runId: z.string().optional(),
  provider: ProviderIdSchema,
  endpoint: z.string(),
  ok: z.boolean(),
  /** 0 = no HTTP response (network error / timeout) */
  statusCode: z.number().int(),
  latencyMs: z.number(),
  revision: z.string().optional(),
  body: z.unknown().optional(),
  error: z.string().optional(),
  checkedAt: z.string(),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;

export const DeploymentSchema = z.object({
  id: z.string(),
  runId: z.string(),
  provider: ProviderIdSchema,
  appName: z.string(),
  region: z.string(),
  healthPath: z.string(),
  status: z.enum(['in_progress', 'succeeded', 'failed']),
  endpoint: z.string().optional(),
  revision: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  /** why this record exists when it is not the initial deploy, e.g. "remediation rem_x" */
  note: z.string().optional(),
});
export type Deployment = z.infer<typeof DeploymentSchema>;

export const RemediationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set_env'),
    key: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'env key must be UPPER_SNAKE_CASE'),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal('rollback'),
    /** AWS: version number. IBM: revision name or image reference. Omit = previous revision. */
    toRevision: z.string().optional(),
  }),
]);
export type RemediationAction = z.infer<typeof RemediationActionSchema>;

export const DiagnosisSchema = z.object({
  summary: z.string().min(1),
  rootCause: z.string().min(1),
  confidence: ConfidenceSchema,
  evidence: z.array(z.string().min(1)).min(2, 'Cite at least two pieces of evidence (probe body, log line, file:line)'),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const RemediationSchema = z.object({
  id: z.string(),
  action: RemediationActionSchema,
  rationale: z.string(),
  risk: SeveritySchema,
  status: z.enum(['proposed', 'approved', 'rejected', 'executing', 'succeeded', 'failed']),
  approvalId: z.string().optional(),
});
export type Remediation = z.infer<typeof RemediationSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  runId: z.string(),
  provider: ProviderIdSchema,
  source: z.enum(['sentinel', 'orchestrator']),
  status: z.enum(['open', 'diagnosed', 'remediation_proposed', 'remediating', 'resolved']),
  title: z.string(),
  openedAt: z.string(),
  resolvedAt: z.string().optional(),
  probes: z.array(HealthCheckSchema),
  githubIssueNumber: z.number().int().optional(),
  githubIssueUrl: z.string().optional(),
  diagnosis: DiagnosisSchema.optional(),
  remediation: RemediationSchema.optional(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const RunSchema = z.object({
  id: z.string(),
  projectName: z.string(),
  repoPath: z.string(),
  objective: z.string(),
  targets: z.array(ProviderIdSchema).min(1),
  state: RunStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  stateHistory: z.array(z.object({ state: RunStateSchema, at: z.string() })).default([]),
  profile: AppProfileSchema.optional(),
  plan: DeploymentPlanSchema.optional(),
  planHash: z.string().optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const WaitConditionSchema = z.enum(['plan_decided', 'deployed', 'remediation_decided', 'recovered']);
export type WaitCondition = z.infer<typeof WaitConditionSchema>;

/** Everything the UI / Bob needs about one run, returned by GET /api/runs/:id. */
export interface RunAggregate {
  run: Run;
  approvals: Approval[];
  deployments: Deployment[];
  healthChecks: HealthCheck[];
  incidents: Incident[];
  events: RunEvent[];
}
```

### Task 2.5 — State machine (test first)

- [ ] **Step 1: Write the failing test `packages/core/src/state-machine.test.ts`**

```ts
/**
 * @file      packages/core/src/state-machine.test.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Locks the run lifecycle: allowed and forbidden transitions.
 * @depends   vitest, ./state-machine
 * @usedBy    pnpm test
 * @agentNotes If you change TRANSITIONS, update these tests AND the diagram in 00-MASTER-PLAN.md §4.2.
 */
import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, InvalidTransitionError } from './state-machine';

describe('run state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('created', 'analyzed')).toBe(true);
    expect(canTransition('analyzed', 'awaiting_approval')).toBe(true);
    expect(canTransition('awaiting_approval', 'approved')).toBe(true);
    expect(canTransition('approved', 'deploying')).toBe(true);
    expect(canTransition('deploying', 'verifying')).toBe(true);
    expect(canTransition('verifying', 'healthy')).toBe(true);
  });

  it('allows the recovery loop', () => {
    expect(canTransition('healthy', 'incident')).toBe(true);
    expect(canTransition('incident', 'awaiting_remediation_approval')).toBe(true);
    expect(canTransition('awaiting_remediation_approval', 'remediating')).toBe(true);
    expect(canTransition('remediating', 'verifying')).toBe(true);
  });

  it('forbids skipping the human approval gate', () => {
    expect(canTransition('analyzed', 'deploying')).toBe(false);
    expect(canTransition('awaiting_approval', 'deploying')).toBe(false);
    expect(canTransition('incident', 'remediating')).toBe(false);
  });

  it('assertTransition throws a descriptive error', () => {
    expect(() => assertTransition('created', 'healthy')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('created', 'healthy')).toThrow(/created → healthy/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**
  ```powershell
  pnpm vitest run packages/core/src/state-machine.test.ts
  ```
  Expected: FAIL, `Failed to resolve import "./state-machine"`.

- [ ] **Step 3: Create `packages/core/src/state-machine.ts`**

```ts
/**
 * @file      packages/core/src/state-machine.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   The explicit run lifecycle (PRD §8 "Orchestrator"). Every state change in the orchestrator goes through assertTransition.
 * @depends   ./schemas (types)
 * @usedBy    orchestrator RunService.transition()
 * @agentNotes Approval gates are encoded here: there is NO edge from analyzed/awaiting_approval to deploying,
 *             and NO edge from incident to remediating. Keep it that way.
 */
import type { RunState } from './schemas';

export const TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  created: ['analyzed'],
  analyzed: ['analyzed', 'awaiting_approval'],
  awaiting_approval: ['awaiting_approval', 'approved', 'rejected'],
  rejected: ['analyzed', 'awaiting_approval'],
  approved: ['deploying'],
  deploying: ['verifying', 'failed'],
  verifying: ['healthy', 'failed', 'incident'],
  healthy: ['verifying', 'incident'],
  failed: ['deploying', 'verifying', 'incident', 'awaiting_remediation_approval'],
  incident: ['incident', 'awaiting_remediation_approval'],
  awaiting_remediation_approval: ['awaiting_remediation_approval', 'remediating', 'incident'],
  remediating: ['verifying', 'failed'],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: RunState,
    readonly to: RunState,
  ) {
    super(`Invalid run transition ${from} → ${to}. Allowed from ${from}: [${TRANSITIONS[from].join(', ')}]`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
```

- [ ] **Step 4: Run the test again**
  ```powershell
  pnpm vitest run packages/core/src/state-machine.test.ts
  ```
  Expected: PASS (4 tests).

### Task 2.6 — Provider contract and utilities

- [ ] **Step 1: Create `packages/core/src/provider-contract.ts`**

```ts
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
import type { EventKind, Evidence, ProviderId, Resource, TargetPlan } from './schemas';

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
  services: string[];
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
```

- [ ] **Step 2: Create `packages/core/src/util.ts`**

```ts
/**
 * @file      packages/core/src/util.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Small isomorphic helpers: ids, timestamps, evidence builder, stable JSON (for hashing), human descriptions.
 * @depends   ./schemas, ./provider-contract (types)
 * @usedBy    orchestrator, providers, UI, MCP
 * @agentNotes Must stay browser-safe: no node:* imports here (hashing lives in apps/orchestrator/src/lib/hash.ts).
 */
import type { EnvChange } from './provider-contract';
import type { Actor, Evidence, ProviderId, RemediationAction } from './schemas';

export const nowIso = (): string => new Date().toISOString();

export const newId = (prefix: string): string =>
  `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

export const evidence = (label: string, source: string, data: unknown): Evidence => ({
  label,
  source,
  capturedAt: nowIso(),
  data,
});

export const providerActor = (provider: ProviderId): Actor => (provider === 'aws' ? 'provider:aws' : 'provider:ibm-cloud');

/** JSON.stringify with sorted object keys and undefined values dropped → identical input = identical string. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function describeAction(action: RemediationAction): string {
  return action.type === 'set_env'
    ? `Set ${action.key}=${action.value}`
    : `Roll back to ${action.toRevision ?? 'the previous revision'}`;
}

export function describeEnvChange(change: EnvChange): string {
  const parts: string[] = [];
  if (change.set && Object.keys(change.set).length) parts.push(`set ${Object.keys(change.set).join(', ')}`);
  if (change.remove?.length) parts.push(`remove ${change.remove.join(', ')}`);
  return parts.join('; ') || 'no changes';
}
```

- [ ] **Step 3: Write the test `packages/core/src/util.test.ts`**

```ts
/**
 * @file      packages/core/src/util.test.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Guarantees stable hashing input and readable action descriptions.
 * @depends   vitest, ./util
 * @usedBy    pnpm test
 * @agentNotes stableStringify drives approval hashes — a regression here silently breaks approvals.
 */
import { describe, expect, it } from 'vitest';
import { describeAction, describeEnvChange, newId, stableStringify } from './util';

describe('util', () => {
  it('stableStringify ignores key order and undefined', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [1, { y: 1, x: 2 }] }, u: undefined })).toBe(
      stableStringify({ a: { c: [1, { x: 2, y: 1 }], d: 2 }, b: 1 }),
    );
  });
  it('newId uses the prefix', () => {
    expect(newId('run')).toMatch(/^run_[0-9a-f]{10}$/);
  });
  it('describes actions and env changes', () => {
    expect(describeAction({ type: 'set_env', key: 'CATALOG_MODE', value: 'featured' })).toBe('Set CATALOG_MODE=featured');
    expect(describeAction({ type: 'rollback' })).toBe('Roll back to the previous revision');
    expect(describeEnvChange({ set: { A: '1' }, remove: ['B'] })).toBe('set A; remove B');
  });
});
```

### Task 2.7 — Health probe (shared by orchestrator AND the GitHub sentinel)

- [ ] **Step 1: Write the test `packages/core/src/probe.test.ts`**

```ts
/**
 * @file      packages/core/src/probe.test.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Probe semantics: 2xx = ok, revision extracted from JSON body, network errors = statusCode 0.
 * @depends   vitest, ./probe
 * @usedBy    pnpm test
 * @agentNotes Uses an injected fetchImpl — never hits the network.
 */
import { describe, expect, it } from 'vitest';
import { probeHealth } from './probe';

describe('probeHealth', () => {
  it('reports a healthy JSON endpoint with its revision', async () => {
    const check = await probeHealth({
      provider: 'aws',
      endpoint: 'https://abc.lambda-url.us-east-1.on.aws/',
      healthPath: '/health',
      fetchImpl: async () => new Response(JSON.stringify({ status: 'healthy', revision: '7' }), { status: 200 }),
    });
    expect(check.ok).toBe(true);
    expect(check.statusCode).toBe(200);
    expect(check.revision).toBe('7');
    expect(check.endpoint).toBe('https://abc.lambda-url.us-east-1.on.aws/health');
  });

  it('reports 503 as not ok and keeps the body as evidence', async () => {
    const check = await probeHealth({
      provider: 'ibm-cloud',
      endpoint: 'https://app.example.appdomain.cloud',
      healthPath: '/health',
      fetchImpl: async () => new Response(JSON.stringify({ status: 'unhealthy', checks: { config: { ok: false } } }), { status: 503 }),
    });
    expect(check.ok).toBe(false);
    expect(check.statusCode).toBe(503);
    expect(check.body).toMatchObject({ status: 'unhealthy' });
  });

  it('reports network errors with statusCode 0', async () => {
    const check = await probeHealth({
      provider: 'aws',
      endpoint: 'https://down.example.com',
      healthPath: '/health',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(check.ok).toBe(false);
    expect(check.statusCode).toBe(0);
    expect(check.error).toContain('ECONNREFUSED');
  });
});
```

- [ ] **Step 2: Create `packages/core/src/probe.ts`**

```ts
/**
 * @file      packages/core/src/probe.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   One HTTP health probe implementation used by the orchestrator (VERIFY) and the GitHub sentinel.
 * @depends   global fetch (Node 22 / browsers), ./schemas (types)
 * @usedBy    orchestrator LifecycleService.verifyRun, scripts/sentinel/run-sentinel.ts
 * @agentNotes Never throws — failures are returned as { ok:false, statusCode:0, error }. Keep it that way:
 *             the sentinel relies on it to count consecutive failures.
 */
import type { HealthCheck, ProviderId } from './schemas';

export interface ProbeOptions {
  provider: ProviderId;
  endpoint: string;
  healthPath: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function probeHealth(opts: ProbeOptions): Promise<HealthCheck> {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  const id = globalThis.crypto.randomUUID();
  let url = `${opts.endpoint.replace(/\/$/, '')}${opts.healthPath}`;
  try {
    url = new URL(opts.healthPath, opts.endpoint).toString();
    const res = await (opts.fetchImpl ?? fetch)(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: { 'user-agent': 'bobops-probe/1.0', accept: 'application/json' },
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    const revision =
      body && typeof body === 'object' && 'revision' in body ? String((body as { revision: unknown }).revision) : undefined;
    return { id, provider: opts.provider, endpoint: url, ok: res.ok, statusCode: res.status, latencyMs, revision, body, checkedAt };
  } catch (err) {
    return {
      id,
      provider: opts.provider,
      endpoint: url,
      ok: false,
      statusCode: 0,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}

export type ProbeFn = typeof probeHealth;
```

- [ ] **Step 3:** `pnpm vitest run packages/core/src/probe.test.ts` → Expected: PASS (3 tests).

### Task 2.8 — Metrics and audit markdown

- [ ] **Step 1: Create `packages/core/src/metrics.ts`**

```ts
/**
 * @file      packages/core/src/metrics.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Business-value numbers shown in the Control Center and the exported audit trail.
 * @depends   ./schemas (types)
 * @usedBy    control-center MetricsStrip, audit.ts, README screenshots
 * @agentNotes "timeToHealthyMs" honestly includes the human approval time — say so in the pitch.
 */
import type { ProviderId, RunAggregate } from './schemas';

export interface RunMetrics {
  /** run created → first time the run became healthy */
  timeToHealthyMs?: number;
  /** mean incident open → resolved */
  mttrMs?: number;
  approvals: number;
  bobActions: number;
  guardBlocks: number;
  providersLive: number;
}

export function computeMetrics(agg: RunAggregate): RunMetrics {
  const created = Date.parse(agg.run.createdAt);
  const firstHealthy = agg.run.stateHistory.find((s) => s.state === 'healthy');
  const mttrs = agg.incidents
    .filter((i) => i.resolvedAt)
    .map((i) => Date.parse(i.resolvedAt as string) - Date.parse(i.openedAt));
  const latest = new Map<ProviderId, boolean>();
  for (const h of agg.healthChecks) latest.set(h.provider, h.ok);
  return {
    timeToHealthyMs: firstHealthy ? Date.parse(firstHealthy.at) - created : undefined,
    mttrMs: mttrs.length ? Math.round(mttrs.reduce((a, b) => a + b, 0) / mttrs.length) : undefined,
    approvals: agg.approvals.filter((a) => a.status === 'approved').length,
    bobActions: agg.events.filter((e) => e.actor === 'bob').length,
    guardBlocks: agg.events.filter((e) => e.type === 'guard.blocked').length,
    providersLive: [...latest.values()].filter(Boolean).length,
  };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}
```

- [ ] **Step 2: Create `packages/core/src/audit.ts`**

```ts
/**
 * @file      packages/core/src/audit.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Renders a run aggregate as a human-readable Markdown audit trail (committed to evidence/demo-runs/).
 * @depends   ./metrics, ./util, ./schemas (types)
 * @usedBy    orchestrator LifecycleService.exportEvidence
 * @agentNotes Output is judge-facing. Never include env values that are secret (events already carry redacted data).
 */
import { computeMetrics, formatDuration } from './metrics';
import type { RunAggregate } from './schemas';
import { describeAction } from './util';

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderAuditMarkdown(agg: RunAggregate): string {
  const m = computeMetrics(agg);
  const { run } = agg;
  const lines = [
    `# BobOps audit trail — ${run.projectName}`,
    '',
    `- **Run:** \`${run.id}\` · **State:** ${run.state} · **Targets:** ${run.targets.join(', ')}`,
    `- **Objective:** ${run.objective}`,
    `- **Approved plan hash:** \`${run.planHash ?? 'n/a'}\``,
    `- **Run created → verified healthy:** ${m.timeToHealthyMs !== undefined ? formatDuration(m.timeToHealthyMs) : 'n/a'}` +
      ` · **MTTR:** ${m.mttrMs !== undefined ? formatDuration(m.mttrMs) : 'n/a'}` +
      ` · **Human approvals:** ${m.approvals} · **Unsafe actions blocked:** ${m.guardBlocks}`,
    '',
    '## Deployments',
    '| Provider | App | Status | Endpoint | Revision | Note |',
    '|---|---|---|---|---|---|',
    ...agg.deployments.map(
      (d) => `| ${d.provider} | ${d.appName} | ${d.status} | ${d.endpoint ?? ''} | ${d.revision ?? ''} | ${cell(d.note ?? '')} |`,
    ),
    '',
    '## Incidents',
    ...(agg.incidents.length
      ? agg.incidents.map(
          (i) =>
            `- **${i.id}** (${i.provider}, via ${i.source}) — ${i.status}` +
            (i.diagnosis ? ` · root cause: ${i.diagnosis.rootCause}` : '') +
            (i.remediation ? ` · remediation: ${describeAction(i.remediation.action)} (${i.remediation.status})` : '') +
            (i.githubIssueUrl ? ` · ${i.githubIssueUrl}` : ''),
        )
      : ['- none']),
    '',
    '## Timeline',
    '| Time (UTC) | Actor | Kind | Event | Message |',
    '|---|---|---|---|---|',
    ...agg.events.map((e) => `| ${e.at.slice(11, 19)} | ${e.actor} | ${e.kind} | ${e.type} | ${cell(e.message)} |`),
  ];
  return `${lines.join('\n')}\n`;
}
```

### Task 2.9 — Sentinel issue format (shared by the GitHub workflow and the orchestrator)

- [ ] **Step 1: Write the test `packages/core/src/sentinel.test.ts`**

```ts
/**
 * @file      packages/core/src/sentinel.test.ts
 * @phase     P2
 * @owner     Product & Experience
 * @purpose   Round-trip of the machine-readable incident block embedded in GitHub issues + failure streak logic.
 * @depends   vitest, ./sentinel
 * @usedBy    pnpm test
 * @agentNotes The issue body format is a cross-process contract (GitHub Actions ⇄ orchestrator). Never change it silently.
 */
import { describe, expect, it } from 'vitest';
import type { HealthCheck } from './schemas';
import { consecutiveFailures, parseIssueBody, renderIssueBody, type SentinelIncidentPayload } from './sentinel';

const probe = (ok: boolean): HealthCheck => ({
  id: crypto.randomUUID(),
  provider: 'ibm-cloud',
  endpoint: 'https://x.appdomain.cloud/health',
  ok,
  statusCode: ok ? 200 : 503,
  latencyMs: 120,
  checkedAt: '2026-09-27T10:00:00.000Z',
});

describe('sentinel format', () => {
  it('counts trailing consecutive failures', () => {
    expect(consecutiveFailures([probe(true), probe(false), probe(false)])).toBe(2);
    expect(consecutiveFailures([probe(false), probe(true)])).toBe(0);
  });

  it('round-trips the incident payload through the issue body', () => {
    const payload: SentinelIncidentPayload = {
      version: 1,
      runId: 'run_abc',
      provider: 'ibm-cloud',
      appName: 'bobops-nimbus-books',
      endpoint: 'https://x.appdomain.cloud',
      threshold: 3,
      consecutiveFailures: 3,
      probes: [probe(false), probe(false), probe(false)],
      detectedAt: '2026-09-27T10:00:30.000Z',
      workflowRunUrl: 'https://github.com/o/r/actions/runs/1',
    };
    const body = renderIssueBody(payload);
    expect(body).toContain('Health sentinel incident');
    expect(parseIssueBody(body)).toEqual(payload);
  });

  it('ignores unrelated issue bodies', () => {
    expect(parseIssueBody('just a normal issue')).toBeNull();
  });
});
```

- [ ] **Step 2: Create `packages/core/src/sentinel.ts`**

```ts
/**
 * @file      packages/core/src/sentinel.ts
 * @phase     P2
 * @owner     Product & Experience
 * @purpose   Contract between the GitHub Actions health sentinel and the orchestrator: targets, incident payload,
 *            issue body rendering/parsing, failure-streak logic, job summary.
 * @depends   zod, ./schemas
 * @usedBy    scripts/sentinel/run-sentinel.ts, packages/github, orchestrator incident sync
 * @agentNotes The JSON block after MARKER is machine-read. Keep MARKER and version:1 stable.
 */
import { z } from 'zod';
import { HealthCheckSchema, ProviderIdSchema, type HealthCheck } from './schemas';

export const SENTINEL_LABEL = 'sentinel-incident';
const MARKER = '<!-- bobops-incident:v1 -->';

export const SentinelTargetSchema = z.object({
  runId: z.string(),
  provider: ProviderIdSchema,
  appName: z.string(),
  endpoint: z.string().url(),
  healthPath: z.string().default('/health'),
});
export type SentinelTarget = z.infer<typeof SentinelTargetSchema>;

export const SentinelIncidentPayloadSchema = z.object({
  version: z.literal(1),
  runId: z.string(),
  provider: ProviderIdSchema,
  appName: z.string(),
  endpoint: z.string(),
  threshold: z.number().int(),
  consecutiveFailures: z.number().int(),
  probes: z.array(HealthCheckSchema),
  detectedAt: z.string(),
  workflowRunUrl: z.string().optional(),
  commitSha: z.string().optional(),
});
export type SentinelIncidentPayload = z.infer<typeof SentinelIncidentPayloadSchema>;

export function consecutiveFailures(probes: HealthCheck[]): number {
  let n = 0;
  for (let i = probes.length - 1; i >= 0 && !probes[i]!.ok; i--) n++;
  return n;
}

export function incidentTitle(target: { provider: string; appName: string }): string {
  return `[sentinel] ${target.provider}/${target.appName} is failing health checks`;
}

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\r?\n/g, ' ');

export function renderIssueBody(p: SentinelIncidentPayload): string {
  const rows = p.probes.map(
    (pr) =>
      `| ${pr.checkedAt} | ${pr.statusCode || '—'} | ${pr.latencyMs} ms | ${pr.ok ? '✅' : '❌'} | ${cell(pr.error ?? JSON.stringify(pr.body ?? '').slice(0, 120))} |`,
  );
  return [
    '## 🚨 Health sentinel incident',
    '',
    `**Target:** \`${p.provider}\` / \`${p.appName}\`  `,
    `**Endpoint:** ${p.endpoint}  `,
    `**Consecutive failures:** ${p.consecutiveFailures} (threshold ${p.threshold})  `,
    p.workflowRunUrl ? `**Workflow run:** ${p.workflowRunUrl}  ` : '',
    p.commitSha ? `**Commit:** \`${p.commitSha.slice(0, 7)}\`` : '',
    '',
    '| Checked at | HTTP | Latency | OK | Detail |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    'The BobOps orchestrator imports this issue as an incident. IBM Bob investigates it in the IDE (`/investigate`);',
    'any remediation requires human approval in the Control Center. This issue closes automatically after verified recovery.',
    '',
    MARKER,
    '```json',
    JSON.stringify(p, null, 2),
    '```',
  ].join('\n');
}

export function parseIssueBody(body: string): SentinelIncidentPayload | null {
  const idx = body.indexOf(MARKER);
  if (idx < 0) return null;
  const match = body.slice(idx).match(/```json\s*([\s\S]*?)```/);
  if (!match?.[1]) return null;
  try {
    const parsed = SentinelIncidentPayloadSchema.safeParse(JSON.parse(match[1]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface SentinelResult {
  target: SentinelTarget;
  probes: HealthCheck[];
  incident: boolean;
  issueUrl?: string;
}

export function renderStepSummary(results: SentinelResult[]): string {
  const rows = results.map((r) => {
    const last = r.probes[r.probes.length - 1];
    const verdict = r.incident ? '🚨 INCIDENT' : r.probes.every((p) => p.ok) ? '✅ healthy' : '⚠️ flaky';
    return `| ${r.target.provider} | ${r.target.appName} | ${verdict} | ${r.probes.filter((p) => p.ok).length}/${r.probes.length} | ${last ? `${last.statusCode} / ${last.latencyMs} ms` : '—'} | ${r.issueUrl ?? ''} |`;
  });
  return [
    '## BobOps health sentinel',
    '',
    '| Provider | App | Verdict | OK probes | Last status / latency | Incident |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}
```

- [ ] **Step 3:** `pnpm vitest run packages/core/src/sentinel.test.ts` → Expected: PASS (3 tests).

### Task 2.10 — Example profile and plan (fixtures reused by tests, scripts and Bob's rules)

- [ ] **Step 1: Create `packages/core/src/fixtures.ts`**

```ts
/**
 * @file      packages/core/src/fixtures.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   A VALID AppProfile and DeploymentPlan for the Nimbus Books demo app. Used by tests, scripts/demo/api-e2e.ts,
 *            and referenced by Bob's rules as the canonical example of the JSON Bob must produce.
 * @depends   ./schemas
 * @usedBy    orchestrator tests, bob-mcp tests, scripts/demo/api-e2e.ts, .bob/rules-multicloud-devops/05-deploy-workflow.md
 * @agentNotes Keep this in sync with apps/demo-service (env names, port, health path). Must pass schema validation (tested).
 */
import type { AppProfile, DeploymentPlan, ProviderId, TargetPlan } from './schemas';

export const EXAMPLE_APP_PROFILE: AppProfile = {
  name: 'nimbus-books',
  runtime: 'node',
  runtimeVersion: '22',
  framework: 'hono',
  buildCommand: 'npm run build',
  startCommand: 'node dist/server.mjs',
  port: 8080,
  healthPath: '/health',
  requiredEnv: ['CATALOG_MODE'],
  secretEnv: ['ADMIN_TOKEN'],
  dependencies: ['hono', '@hono/node-server'],
  specialistFindings: [
    {
      specialist: 'application-analyst',
      summary: 'Hono 4 HTTP API on Node 22 with a /health endpoint that validates required configuration',
      findings: ['src/server.ts listens on PORT (default 8080)', 'GET /health returns 503 when CATALOG_MODE is missing'],
      confidence: 'high',
      evidence: ['apps/demo-service/src/server.ts', 'apps/demo-service/src/app.ts'],
    },
    {
      specialist: 'cloud-architect',
      summary: 'Container on IBM Cloud Code Engine (primary) and Lambda + Function URL on AWS (secondary)',
      findings: ['Stateless service, no database', 'Code Engine builds from source with a Dockerfile; Lambda runs a bundled ESM handler'],
      confidence: 'high',
      evidence: ['apps/demo-service/package.json'],
    },
    {
      specialist: 'security-reviewer',
      summary: 'ADMIN_TOKEN is a secret and must not appear in plain configuration',
      findings: ['ADMIN_TOKEN guards /api/admin/stats', 'IBM: Code Engine secret; AWS: KMS-encrypted Lambda env (V2: Secrets Manager)'],
      confidence: 'high',
      evidence: ['apps/demo-service/src/app.ts'],
    },
    {
      specialist: 'release-verifier',
      summary: 'Vitest suite covers health, catalog and admin routes; /health exposes revision for correlation',
      findings: ['Pre-deploy gate: vitest run must pass', 'Post-deploy gate: GET /health must return 200 on every target'],
      confidence: 'high',
      evidence: ['apps/demo-service/src/app.test.ts'],
    },
  ],
  risks: [
    {
      id: 'R1',
      title: 'Missing CATALOG_MODE makes the service unhealthy',
      severity: 'medium',
      mitigation: 'Plan sets CATALOG_MODE on every target; the sentinel detects drift',
    },
  ],
};

const IBM_TARGET: TargetPlan = {
  provider: 'ibm-cloud',
  service: 'code-engine',
  region: 'us-south',
  appName: 'bobops-nimbus-books',
  port: 8080,
  healthPath: '/health',
  env: { CATALOG_MODE: 'featured', APP_VERSION: '1.0.0', DEPLOY_PROVIDER: 'ibm-cloud' },
  secretRefs: ['ADMIN_TOKEN'],
  resources: [
    { type: 'code-engine-project', name: 'bobops-demo', action: 'reuse' },
    { type: 'code-engine-build-run', name: 'bobops-nimbus-books-build', action: 'create' },
    { type: 'code-engine-secret', name: 'bobops-nimbus-books-secrets', action: 'create' },
    { type: 'code-engine-app', name: 'bobops-nimbus-books', action: 'create' },
  ],
};

const AWS_TARGET: TargetPlan = {
  provider: 'aws',
  service: 'lambda',
  region: 'us-east-1',
  appName: 'bobops-nimbus-books',
  port: 8080,
  healthPath: '/health',
  env: { CATALOG_MODE: 'featured', APP_VERSION: '1.0.0', DEPLOY_PROVIDER: 'aws' },
  secretRefs: ['ADMIN_TOKEN'],
  resources: [
    { type: 'lambda-function', name: 'bobops-nimbus-books', action: 'create' },
    { type: 'lambda-alias', name: 'live', action: 'create' },
    { type: 'lambda-function-url', name: 'bobops-nimbus-books:live', action: 'create' },
  ],
};

export function examplePlan(targets: ProviderId[] = ['ibm-cloud', 'aws']): DeploymentPlan {
  return {
    summary: `Deploy nimbus-books to ${targets.map((t) => (t === 'ibm-cloud' ? 'IBM Cloud Code Engine' : 'AWS Lambda')).join(' + ')} with verified health`,
    targets: [IBM_TARGET, AWS_TARGET].filter((t) => targets.includes(t.provider)),
    risks: [
      { id: 'R1', title: 'Missing CATALOG_MODE makes the service unhealthy', severity: 'medium', mitigation: 'Set explicitly per target; sentinel detects drift' },
      { id: 'R2', title: 'Lambda env holds ADMIN_TOKEN (KMS-encrypted at rest)', severity: 'low', mitigation: 'V2: move to AWS Secrets Manager' },
    ],
    generatedAssets: [
      { path: 'apps/demo-service/Dockerfile', purpose: 'Code Engine build from source' },
      { path: 'apps/demo-service/.dockerignore', purpose: 'Keep the image small' },
      { path: 'apps/demo-service/.ceignore', purpose: 'Keep node_modules out of the Code Engine source upload' },
      { path: 'apps/demo-service/src/lambda.ts', purpose: 'AWS Lambda Function URL entry point' },
    ],
    rollbackStrategy:
      'IBM Cloud: restore configuration or roll back to the previous revision image. AWS: move the live alias to the previous published version.',
    approvalGates: ['This deployment plan', 'Every remediation or rollback'],
    estimatedMonthlyCostUsd: 5,
  };
}
```

- [ ] **Step 2: Write `packages/core/src/schemas.test.ts`**

```ts
/**
 * @file      packages/core/src/schemas.test.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Schema guard rails: fixtures valid, secrets rejected from env, name boundary enforced, diagnosis needs evidence.
 * @depends   vitest, ./schemas, ./fixtures, ./events
 * @usedBy    pnpm test
 * @agentNotes These tests encode safety rules from .bob/rules-multicloud-devops/03-cloud-safety-boundaries.md.
 */
import { describe, expect, it } from 'vitest';
import { stageForEvent } from './events';
import { EXAMPLE_APP_PROFILE, examplePlan } from './fixtures';
import { AppProfileSchema, DeploymentPlanSchema, DiagnosisSchema, RemediationActionSchema, TargetPlanSchema } from './schemas';

const target = examplePlan(['ibm-cloud']).targets[0]!;

describe('schemas', () => {
  it('fixtures are valid', () => {
    expect(AppProfileSchema.parse(EXAMPLE_APP_PROFILE).name).toBe('nimbus-books');
    expect(DeploymentPlanSchema.parse(examplePlan()).targets).toHaveLength(2);
  });
  it('rejects secrets in plain env', () => {
    const r = TargetPlanSchema.safeParse({ ...target, env: { ADMIN_TOKEN: 'x' } });
    expect(r.success).toBe(false);
  });
  it('enforces the bobops- name boundary', () => {
    expect(TargetPlanSchema.safeParse({ ...target, appName: 'prod-db' }).success).toBe(false);
  });
  it('enforces provider/service pairing', () => {
    expect(TargetPlanSchema.safeParse({ ...target, service: 'lambda' }).success).toBe(false);
  });
  it('requires two evidence items in a diagnosis', () => {
    expect(DiagnosisSchema.safeParse({ summary: 's', rootCause: 'r', confidence: 'high', evidence: ['one'] }).success).toBe(false);
  });
  it('parses remediation actions', () => {
    expect(RemediationActionSchema.parse({ type: 'set_env', key: 'CATALOG_MODE', value: 'featured' }).type).toBe('set_env');
    expect(RemediationActionSchema.safeParse({ type: 'set_env', key: 'lower', value: 'x' }).success).toBe(false);
  });
  it('maps events to stages', () => {
    expect(stageForEvent('build.completed')).toBe('BUILD');
    expect(stageForEvent('guard.blocked')).toBeNull();
  });
});
```

- [ ] **Step 3: Write `packages/core/src/metrics.test.ts`**

```ts
/**
 * @file      packages/core/src/metrics.test.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Verifies the business-value metrics (time-to-healthy, MTTR, counters).
 * @depends   vitest, ./metrics, ./audit
 * @usedBy    pnpm test
 * @agentNotes Build aggregates by hand here — do not import orchestrator code into core tests.
 */
import { describe, expect, it } from 'vitest';
import { renderAuditMarkdown } from './audit';
import { computeMetrics, formatDuration } from './metrics';
import type { RunAggregate } from './schemas';

const agg: RunAggregate = {
  run: {
    id: 'run_1',
    projectName: 'nimbus-books',
    repoPath: 'apps/demo-service',
    objective: 'deploy',
    targets: ['ibm-cloud'],
    state: 'healthy',
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:10:00.000Z',
    stateHistory: [
      { state: 'created', at: '2026-09-27T10:00:00.000Z' },
      { state: 'healthy', at: '2026-09-27T10:04:30.000Z' },
    ],
  },
  approvals: [
    { id: 'a', runId: 'run_1', kind: 'deploy_plan', subjectId: 'run_1', subjectHash: 'h', summary: 's', risk: 'low', status: 'approved', requestedAt: 'x' },
  ],
  deployments: [],
  healthChecks: [
    { id: 'h', provider: 'ibm-cloud', endpoint: 'e', ok: true, statusCode: 200, latencyMs: 90, checkedAt: 'x' },
  ],
  incidents: [
    { id: 'i', runId: 'run_1', provider: 'ibm-cloud', source: 'sentinel', status: 'resolved', title: 't', openedAt: '2026-09-27T10:05:00.000Z', resolvedAt: '2026-09-27T10:07:00.000Z', probes: [] },
  ],
  events: [
    { id: 'e1', runId: 'run_1', at: '2026-09-27T10:00:01.000Z', actor: 'bob', kind: 'observation', type: 'analysis.recorded', message: 'm', evidence: [] },
    { id: 'e2', runId: 'run_1', at: '2026-09-27T10:00:02.000Z', actor: 'orchestrator', kind: 'verification', type: 'guard.blocked', message: 'm', evidence: [] },
  ],
};

describe('metrics', () => {
  it('computes business metrics', () => {
    const m = computeMetrics(agg);
    expect(m.timeToHealthyMs).toBe(270_000);
    expect(m.mttrMs).toBe(120_000);
    expect(m.approvals).toBe(1);
    expect(m.bobActions).toBe(1);
    expect(m.guardBlocks).toBe(1);
    expect(m.providersLive).toBe(1);
  });
  it('formats durations', () => {
    expect(formatDuration(270_000)).toBe('4m 30s');
    expect(formatDuration(9_000)).toBe('9s');
  });
  it('renders an audit trail', () => {
    expect(renderAuditMarkdown(agg)).toContain('Run created → verified healthy:** 4m 30s');
  });
});
```

### Task 2.11 — Barrel export

- [ ] **Step 1: Create `packages/core/src/index.ts`**

```ts
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
```

### Task 2.12 — Verify the whole package

- [ ] **Step 1:** `pnpm test` → Expected: **all core tests pass** (state-machine 4, util 3, probe 3, sentinel 3, schemas 7, metrics 3 = 23 tests).
- [ ] **Step 2:** `pnpm typecheck` → Expected: no errors.

### Task 2.13 — RETROFIT (post-phase-9): real per-cloud architecture choice + user-defined sentinel interval

> **If you are running this phase fresh, apply this task too — it supersedes the original TargetPlanSchema/DeploymentSchema/
> provider-contract.ts/fixtures.ts/sentinel.ts shown above.** It was added after the original build because a single fixed
> service per cloud gave the cloud-architect specialist nothing real to decide. Full rationale: see the retrofit commit
> `feat: real per-cloud architecture choice + user-defined sentinel interval`.

- [ ] **Step 1: In `packages/core/src/schemas.ts`**, right after `export type ProviderId = ...`, add:

```ts
/**
 * Every deployable service, across both clouds. Each cloud offers two real architectures on the same cost/latency axis:
 * an always-warm option (no cold starts, higher idle cost) and a cost-optimized option (scales down when idle, possible
 * cold start). This is a genuine trade-off the cloud-architect specialist evaluates per app, not a cosmetic label —
 * see SERVICE_CATALOG below and .bob/rules-multicloud-devops/04-specialists-and-synthesis.md.
 */
export const ServiceIdSchema = z.enum(['code-engine', 'code-engine-scale-to-zero', 'lambda', 'lambda-provisioned']);
export type ServiceId = z.infer<typeof ServiceIdSchema>;

export interface ServiceDescriptor {
  service: ServiceId;
  provider: ProviderId;
  label: string;
  /** 'warm' = always ready, no cold starts, higher idle cost. 'cost-optimized' = scales down when idle, cheaper, possible cold start. */
  kind: 'warm' | 'cost-optimized';
  description: string;
}

/** The real, deployable architecture choices per cloud. Both variants of a cloud share the SAME provider adapter class —
 * the adapter branches on `target.service` — so adding a variant here never requires a new class or new credentials. */
export const SERVICE_CATALOG: readonly ServiceDescriptor[] = [
  {
    service: 'code-engine',
    provider: 'ibm-cloud',
    label: 'Code Engine — always-on container',
    kind: 'warm',
    description: 'min-scale 1: at least one instance always running. Predictable latency, no cold starts, higher idle cost.',
  },
  {
    service: 'code-engine-scale-to-zero',
    provider: 'ibm-cloud',
    label: 'Code Engine — scale-to-zero container',
    kind: 'cost-optimized',
    description: 'min-scale 0: scales to zero when idle. Lower cost for infrequent traffic; a cold start on the first request after idling.',
  },
  {
    service: 'lambda',
    provider: 'aws',
    label: 'Lambda — on-demand',
    kind: 'cost-optimized',
    description: 'Pay per invocation only. Lower cost for infrequent or bursty traffic; possible cold starts.',
  },
  {
    service: 'lambda-provisioned',
    provider: 'aws',
    label: 'Lambda — provisioned concurrency',
    kind: 'warm',
    description: 'Keeps warm instances ready. Eliminates cold starts, at the cost of paying for idle warm capacity.',
  },
] as const;

export function servicesForProvider(provider: ProviderId): ServiceDescriptor[] {
  return SERVICE_CATALOG.filter((s) => s.provider === provider);
}

export function describeService(service: ServiceId): ServiceDescriptor {
  const found = SERVICE_CATALOG.find((s) => s.service === service);
  if (!found) throw new Error(`Unknown service "${service}"`);
  return found;
}
```

- [ ] **Step 2: Replace `TargetPlanSchema` and `DeploymentPlanSchema`** with:

```ts
export const TargetPlanSchema = z
  .object({
    provider: ProviderIdSchema,
    service: ServiceIdSchema,
    region: z.string().min(1),
    appName: z.string().regex(APP_NAME_PATTERN, 'appName must match ^bobops-[a-z0-9-]{3,40}$'),
    port: z.number().int().positive().default(8080),
    resources: z.array(ResourceSchema).default([]),
    /** NON-secret configuration only. Secret keys are rejected; use secretRefs. */
    env: z.record(z.string()).default({}),
    /** Names of secrets resolved by the orchestrator from SECRET_<NAME> and stored in the provider's secret mechanism. */
    secretRefs: z.array(z.string()).default([]),
    healthPath: z.string().startsWith('/').default('/health'),
    /** Why THIS service was chosen for THIS cloud over the other real option in SERVICE_CATALOG. Must cite the app
     * profile (traffic pattern, latency sensitivity, cost). This is a real decision, not a label — see rule 04. */
    architectureRationale: z
      .string()
      .min(20, 'Explain why this service was chosen over the alternative for this cloud, citing the app profile'),
  })
  .refine((t) => SERVICE_CATALOG.some((s) => s.provider === t.provider && s.service === t.service), {
    message: 'service must be one of the real options offered for this provider — see servicesForProvider()',
  })
  .refine((t) => Object.keys(t.env).every((k) => !isSecretKey(k)), {
    message: 'Secret-looking keys (TOKEN/SECRET/PASSWORD/API_KEY/PRIVATE) must be listed in secretRefs, not env',
  });
export type TargetPlan = z.infer<typeof TargetPlanSchema>;

export const DeploymentPlanSchema = z
  .object({
    summary: z.string().min(1),
    targets: z.array(TargetPlanSchema).min(1),
    risks: z.array(RiskSchema).default([]),
    generatedAssets: z.array(z.object({ path: z.string(), purpose: z.string() })).default([]),
    rollbackStrategy: z.string().min(1),
    approvalGates: z.array(z.string()).min(1),
    estimatedMonthlyCostUsd: z.number().nonnegative().optional(),
  })
  .refine((p) => new Set(p.targets.map((t) => t.provider)).size === p.targets.length, {
    message: 'A plan may have at most one target per provider (one architecture choice per cloud)',
  });
export type DeploymentPlan = z.infer<typeof DeploymentPlanSchema>;
```

- [ ] **Step 3: In `DeploymentSchema`**, add one field right after `provider: ProviderIdSchema,`:

```ts
  /** which of the two real architectures on this cloud is live — the adapter branches on this for status/logs/setEnv/rollback */
  service: ServiceIdSchema,
```

- [ ] **Step 4: In `RunSchema`**, add one field right after `targets: z.array(ProviderIdSchema).min(1),`:

```ts
  /** How often the user wants this deployment checked by the GitHub sentinel, in minutes (must be a multiple of 5 —
   * GitHub Actions cannot schedule faster than that). Set at run creation; see sentinel.ts's shouldProbeNow(). */
  sentinelIntervalMinutes: z.number().int().min(5).max(1440).default(5),
```

- [ ] **Step 5: In `packages/core/src/provider-contract.ts`**, import `ServiceId` alongside the other schema types, then:
  - Add `service: ServiceId;` to `DeploymentRef` (documented: "which of the two real architectures on this cloud is live").
  - Add `offeredServices: ServiceId[];` to `ProviderCapabilities` (documented: "the real, deployable architecture choices on this cloud").

- [ ] **Step 6: In `packages/core/src/fixtures.ts`**, replace `IBM_TARGET`/`AWS_TARGET`/`examplePlan()` so each target carries a real `architectureRationale`, add `IBM_TARGET_SCALE_TO_ZERO` and `AWS_TARGET_PROVISIONED` alternates, and let `examplePlan(targets, variants)` pick between them:

```ts
const IBM_TARGET: TargetPlan = {
  provider: 'ibm-cloud',
  service: 'code-engine',
  region: 'us-south',
  appName: 'bobops-nimbus-books',
  port: 8080,
  healthPath: '/health',
  env: { CATALOG_MODE: 'featured', APP_VERSION: '1.0.0', DEPLOY_PROVIDER: 'ibm-cloud' },
  secretRefs: ['ADMIN_TOKEN'],
  architectureRationale:
    'IBM Cloud is the primary demo target and backs the live judged run: it must respond immediately with no cold-start ' +
    'delay, so the always-on container (min-scale 1) is chosen over the scale-to-zero variant despite its higher idle cost.',
  resources: [
    { type: 'code-engine-project', name: 'bobops-demo', action: 'reuse' },
    { type: 'code-engine-build-run', name: 'bobops-nimbus-books-build', action: 'create' },
    { type: 'code-engine-secret', name: 'bobops-nimbus-books-secrets', action: 'create' },
    { type: 'code-engine-app', name: 'bobops-nimbus-books', action: 'create' },
  ],
};

const IBM_TARGET_SCALE_TO_ZERO: TargetPlan = {
  ...IBM_TARGET,
  service: 'code-engine-scale-to-zero',
  architectureRationale:
    'This target sees low, infrequent traffic outside the demo window, so scale-to-zero (min-scale 0) is chosen to avoid ' +
    'paying for an idle instance; an occasional cold start on the first request is an acceptable trade-off here.',
};

const AWS_TARGET: TargetPlan = {
  provider: 'aws',
  service: 'lambda',
  region: 'us-east-1',
  appName: 'bobops-nimbus-books',
  port: 8080,
  healthPath: '/health',
  env: { CATALOG_MODE: 'featured', APP_VERSION: '1.0.0', DEPLOY_PROVIDER: 'aws' },
  secretRefs: ['ADMIN_TOKEN'],
  architectureRationale:
    'AWS is the secondary target with lower expected call volume than IBM Cloud, so on-demand Lambda (pay per invocation) ' +
    'is chosen over provisioned concurrency: the cost saving outweighs the risk of an occasional cold start here.',
  resources: [
    { type: 'lambda-function', name: 'bobops-nimbus-books', action: 'create' },
    { type: 'lambda-alias', name: 'live', action: 'create' },
    { type: 'lambda-function-url', name: 'bobops-nimbus-books:live', action: 'create' },
  ],
};

const AWS_TARGET_PROVISIONED: TargetPlan = {
  ...AWS_TARGET,
  service: 'lambda-provisioned',
  architectureRationale:
    'This target is latency-sensitive (health checks or user traffic must never see a cold start), so provisioned ' +
    'concurrency is chosen despite the extra cost of keeping a warm instance ready at all times.',
};

const TEMPLATES: Record<ProviderId, Record<ServiceId, TargetPlan>> = {
  'ibm-cloud': { 'code-engine': IBM_TARGET, 'code-engine-scale-to-zero': IBM_TARGET_SCALE_TO_ZERO } as Record<ServiceId, TargetPlan>,
  aws: { lambda: AWS_TARGET, 'lambda-provisioned': AWS_TARGET_PROVISIONED } as Record<ServiceId, TargetPlan>,
};

const DEFAULT_SERVICE: Record<ProviderId, ServiceId> = { 'ibm-cloud': 'code-engine', aws: 'lambda' };

/**
 * Builds a valid example plan. `variants` lets a caller pick the OTHER real architecture for a cloud
 * (e.g. `{ 'ibm-cloud': 'code-engine-scale-to-zero' }`) — used by tests and rule 04's worked example to show that both
 * options are real, schema-valid choices, not just the default.
 */
export function examplePlan(
  targets: ProviderId[] = ['ibm-cloud', 'aws'],
  variants: Partial<Record<ProviderId, ServiceId>> = {},
): DeploymentPlan {
  const chosen = targets.map((provider) => TEMPLATES[provider][variants[provider] ?? DEFAULT_SERVICE[provider]]);
  return {
    summary: `Deploy nimbus-books to ${chosen.map((t) => `${t.provider} (${t.service})`).join(' + ')} with verified health`,
    targets: chosen,
    risks: [
      { id: 'R1', title: 'Missing CATALOG_MODE makes the service unhealthy', severity: 'medium', mitigation: 'Set explicitly per target; sentinel detects drift' },
      { id: 'R2', title: 'Lambda env holds ADMIN_TOKEN (KMS-encrypted at rest)', severity: 'low', mitigation: 'V2: move to AWS Secrets Manager' },
    ],
    generatedAssets: [
      { path: 'apps/demo-service/Dockerfile', purpose: 'Code Engine build from source' },
      { path: 'apps/demo-service/.dockerignore', purpose: 'Keep the image small' },
      { path: 'apps/demo-service/.ceignore', purpose: 'Keep node_modules out of the Code Engine source upload' },
      { path: 'apps/demo-service/src/lambda.ts', purpose: 'AWS Lambda Function URL entry point' },
    ],
    rollbackStrategy:
      'IBM Cloud: restore configuration or roll back to the previous revision image. AWS: move the live alias to the previous published version.',
    approvalGates: ['This deployment plan', 'Every remediation or rollback'],
    estimatedMonthlyCostUsd: 5,
  };
}
```

- [ ] **Step 7: In `packages/core/src/sentinel.ts`**, replace `SentinelTargetSchema` and add `shouldProbeNow`:

```ts
/** GitHub Actions cannot run a schedule faster than every 5 minutes, so the workflow cron is fixed at that floor.
 * A user-chosen check-in cadence slower than 5 min is honored by shouldProbeNow() sampling every Nth tick — see below. */
export const SENTINEL_CRON_MINUTES = 5;

export const SentinelTargetSchema = z.object({
  runId: z.string(),
  provider: ProviderIdSchema,
  appName: z.string(),
  endpoint: z.string().url(),
  healthPath: z.string().default('/health'),
  /** How often the user wants this deployment checked, in minutes. Must be a multiple of SENTINEL_CRON_MINUTES;
   * the cron itself still fires every 5 min, but shouldProbeNow() skips ticks until this many minutes have passed. */
  intervalMinutes: z
    .number()
    .int()
    .min(SENTINEL_CRON_MINUTES)
    .max(1440)
    .default(SENTINEL_CRON_MINUTES)
    .refine((n) => n % SENTINEL_CRON_MINUTES === 0, `intervalMinutes must be a multiple of ${SENTINEL_CRON_MINUTES}`),
});
export type SentinelTarget = z.infer<typeof SentinelTargetSchema>;

/**
 * Stateless sampling: the workflow's cron always fires every SENTINEL_CRON_MINUTES, but a target with a slower
 * user-chosen interval is only actually probed on the ticks that land on a multiple of its interval. No external
 * state needed — every runner agrees on the same wall-clock tick.
 */
export function shouldProbeNow(target: Pick<SentinelTarget, 'intervalMinutes'>, now: Date = new Date()): boolean {
  const tick = Math.floor(now.getTime() / 60_000 / SENTINEL_CRON_MINUTES) * SENTINEL_CRON_MINUTES;
  return tick % target.intervalMinutes === 0;
}
```

- [ ] **Step 7b:** In the same file, add `skipped?: boolean;` to `SentinelResult` (documented: "true when this tick was
  skipped because the target's user-chosen intervalMinutes hasn't elapsed yet"), and in `renderStepSummary`, replace the
  `verdict` line with:
  ```ts
    const verdict = r.skipped
      ? `⏭️ not due (every ${r.target.intervalMinutes}m)`
      : r.incident
        ? '🚨 INCIDENT'
        : r.probes.every((p) => p.ok)
          ? '✅ healthy'
          : '⚠️ flaky';
  ```
- [ ] **Step 8:** Add the retrofit tests: in `schemas.test.ts`, tests for `servicesForProvider`, accepting the scale-to-zero variant as valid, rejecting a short `architectureRationale`, and rejecting two targets for the same provider; in `sentinel.test.ts`, tests for the `intervalMinutes` multiple-of-5 refine and for `shouldProbeNow` sampling (see the real files for the exact assertions — both are short and self-explanatory).
- [ ] **Step 9:** `pnpm test` → Expected: 27 core tests pass (was 23).

## HANDOFF

```text
✅ PHASE 02 COMPLETE — packages/core domain
BUILT:
  - packages/core: schemas, events/stages, state machine, provider contract, util, redact, probe, metrics, audit, sentinel, fixtures
  - 23 unit tests
DO THIS (human):
  1. pnpm test
  2. pnpm typecheck
  3. Product owner: skim packages/core/src/schemas.ts — these are the exact shapes the UI will render.
EXPECT:
  - "Test Files  6 passed", "Tests  23 passed"
  - typecheck: no output errors
IF IT FAILS:
  - "Cannot find module 'zod'" → run pnpm install at the repo root
  - crypto.randomUUID undefined → Node < 22; upgrade Node
EVIDENCE:
  - Screenshot Bob's task summary → evidence/bob-task-summaries/phase-02-core-domain.png
  - git add -A; git commit -m "feat(p02): core domain"; git push
```
