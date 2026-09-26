<!--
@file     docs/plan/phase-04-orchestrator-runs.md
@purpose  Orchestrator part 1: config, JSON store, event bus (SSE), runs, analysis, plans, hash-bound human approvals.
@owner    Orchestration & Cloud (O)
-->
# Phase 04 — Orchestrator: runs, plans and human approvals (~75 min)

**Goal:** A running Hono API on `:4000` that can create runs, record Bob's analysis, accept a plan, **hash it**, open a
**human-only approval**, stream audit events over SSE, and persist everything to `apps/orchestrator/.data/store.json`.
Deploying comes in Phase 05.

**Depends on:** Phase 02.
**Interfaces produced:**
- `loadConfig(env, { inMemory? }) → Config`, `REPO_ROOT` (`src/config.ts`)
- `HttpError`, `BadRequestError`, `NotFoundError`, `ConflictError`, `ApprovalRequiredError` (`src/lib/errors.ts`)
- `sha256(value) → hex` (`src/lib/hash.ts`)
- `JsonStore` with `data`, `persist()`, `upsert(collection, item)`, `getRun`, `getApproval`, `getIncident`, `aggregate(runId)`
- `EventBus` with `emit(EmitInput) → RunEvent` and `subscribe(fn) → unsubscribe`
- `RunService` with `transition(run, to)`, `createRun(input, actor)`, `recordAnalysis(runId, profile)`,
  `submitPlan(runId, plan)`, `decideApproval(approvalId, decision, decidedBy, comment?)`
- `createDeps(config, overrides) → Deps`, `createApp(deps) → Hono`

---

### Task 4.1 — Package scaffold

- [ ] **Step 1: Create `apps/orchestrator/package.json`**

```json
{
  "name": "@bobops/orchestrator",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@bobops/core": "workspace:*",
    "@hono/node-server": "^1.13.7",
    "dotenv": "^16.4.7",
    "hono": "^4.7.0",
    "zod": "^3.25.0"
  }
}
```

- [ ] **Step 2: Create `apps/orchestrator/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3:** `pnpm install`

### Task 4.2 — Config, errors, hashing

- [ ] **Step 1: Create `apps/orchestrator/src/config.ts`**

```ts
/**
 * @file      apps/orchestrator/src/config.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   Parses and validates environment configuration once at startup; resolves REPO_ROOT and the store path.
 * @depends   zod
 * @usedBy    src/index.ts, src/deps.ts, tests (loadConfig with an explicit env object + inMemory)
 * @agentNotes Never read process.env anywhere else in the orchestrator — add the variable here instead.
 *             Empty strings in .env are treated as "not set".
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const EnvSchema = z.object({
  ORCHESTRATOR_PORT: z.coerce.number().int().default(4000),
  CONTROL_CENTER_ORIGIN: z.string().default('http://localhost:3000'),
  APPROVAL_TOKEN: z.string().min(8, 'APPROVAL_TOKEN must be set in .env (>= 8 chars)'),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  DATA_DIR: z.string().default('.data'),
  IBMCLOUD_API_KEY: optional,
  IBMCLOUD_REGION: z.string().default('us-south'),
  IBMCLOUD_RESOURCE_GROUP: z.string().default('Default'),
  IBM_CE_PROJECT: z.string().default('bobops-demo'),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_LAMBDA_ROLE_ARN: optional,
  GITHUB_TOKEN: optional,
  GITHUB_OWNER: optional,
  GITHUB_REPO: optional,
});

export type Config = z.infer<typeof EnvSchema> & {
  repoRoot: string;
  /** absolute path of store.json, or null for an in-memory store (tests) */
  dataFile: string | null;
  demoMode: boolean;
  /** SECRET_<NAME>=value entries from the env, keyed by NAME (plan.secretRefs resolve against this) */
  secrets: Record<string, string>;
};

/** Repo root = three levels up from apps/orchestrator/src/config.ts */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { inMemory?: boolean } = {}): Config {
  const parsed = EnvSchema.parse(env);
  return {
    ...parsed,
    repoRoot: REPO_ROOT,
    demoMode: parsed.DEMO_MODE === 'true',
    dataFile: opts.inMemory ? null : path.join(REPO_ROOT, 'apps', 'orchestrator', parsed.DATA_DIR, 'store.json'),
    secrets: Object.fromEntries(
      Object.entries(env)
        .filter(([key, value]) => key.startsWith('SECRET_') && typeof value === 'string' && value !== '')
        .map(([key, value]) => [key.slice('SECRET_'.length), value as string]),
    ),
  };
}
```

- [ ] **Step 2: Create `apps/orchestrator/src/lib/errors.ts`**

```ts
/**
 * @file      apps/orchestrator/src/lib/errors.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   Typed HTTP errors. Services throw these; app.ts onError turns them into { error, code } JSON.
 * @depends   —
 * @usedBy    services/*, routes/*, app.ts
 * @agentNotes Routes must not construct error responses themselves — throw one of these.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, 'bad_request', message);
  }
}

export class NotFoundError extends HttpError {
  constructor(what: string) {
    super(404, 'not_found', `${what} not found`);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, 'conflict', message);
  }
}

export class ApprovalRequiredError extends HttpError {
  constructor(message: string) {
    super(403, 'approval_required', message);
  }
}
```

- [ ] **Step 3: Create `apps/orchestrator/src/lib/hash.ts`**

```ts
/**
 * @file      apps/orchestrator/src/lib/hash.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   sha256 over stable JSON — binds human approvals to the exact plan/remediation that was reviewed.
 * @depends   node:crypto, @bobops/core (stableStringify)
 * @usedBy    RunService.submitPlan, LifecycleService (remediation approvals, guards)
 * @agentNotes Changing this function invalidates every stored approval. Don't.
 */
import { createHash } from 'node:crypto';
import { stableStringify } from '@bobops/core';

export const sha256 = (value: unknown): string => createHash('sha256').update(stableStringify(value)).digest('hex');
```

### Task 4.3 — Store and event bus

- [ ] **Step 1: Create `apps/orchestrator/src/store/json-store.ts`**

```ts
/**
 * @file      apps/orchestrator/src/store/json-store.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   Tiny persistence layer: all state in one JSON file (atomic write via tmp + rename). file=null → in-memory.
 * @depends   node:fs, @bobops/core (types), ../lib/errors
 * @usedBy    every service, routes (read-only)
 * @agentNotes Always mutate via upsert() so the file is persisted. Items are matched by `id`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Approval, Deployment, HealthCheck, Incident, Run, RunAggregate, RunEvent } from '@bobops/core';
import { NotFoundError } from '../lib/errors';

export interface StoreData {
  runs: Run[];
  approvals: Approval[];
  deployments: Deployment[];
  healthChecks: HealthCheck[];
  incidents: Incident[];
  events: RunEvent[];
}

const empty = (): StoreData => ({ runs: [], approvals: [], deployments: [], healthChecks: [], incidents: [], events: [] });

export class JsonStore {
  readonly data: StoreData;

  constructor(private readonly file: string | null) {
    this.data =
      file && fs.existsSync(file) ? { ...empty(), ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<StoreData>) } : empty();
  }

  persist(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  upsert<K extends keyof StoreData>(collection: K, item: StoreData[K][number]): void {
    const list = this.data[collection] as unknown as Array<{ id: string }>;
    const withId = item as unknown as { id: string };
    const idx = list.findIndex((x) => x.id === withId.id);
    if (idx >= 0) list[idx] = withId;
    else list.push(withId);
    this.persist();
  }

  getRun(id: string): Run {
    const run = this.data.runs.find((r) => r.id === id);
    if (!run) throw new NotFoundError(`Run ${id}`);
    return run;
  }

  getApproval(id: string): Approval {
    const approval = this.data.approvals.find((a) => a.id === id);
    if (!approval) throw new NotFoundError(`Approval ${id}`);
    return approval;
  }

  getIncident(id: string): Incident {
    const incident = this.data.incidents.find((i) => i.id === id);
    if (!incident) throw new NotFoundError(`Incident ${id}`);
    return incident;
  }

  aggregate(runId: string): RunAggregate {
    const run = this.getRun(runId);
    const mine = <T extends { runId?: string }>(list: T[]) => list.filter((x) => x.runId === runId);
    return {
      run,
      approvals: mine(this.data.approvals),
      deployments: mine(this.data.deployments),
      healthChecks: mine(this.data.healthChecks).slice(-50),
      incidents: mine(this.data.incidents),
      events: mine(this.data.events),
    };
  }
}
```

- [ ] **Step 2: Create `apps/orchestrator/src/events/event-bus.ts`**

```ts
/**
 * @file      apps/orchestrator/src/events/event-bus.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   Creates auditable RunEvents (persisted) and fans them out to live subscribers (SSE → Control Center).
 * @depends   @bobops/core, ../store/json-store
 * @usedBy    RunService, LifecycleService, routes/events.ts
 * @agentNotes Every state-changing step must emit at least one event with the right actor + kind (PRD §6 evidence standard).
 */
import { newId, nowIso, type Actor, type EventKind, type EventType, type Evidence, type RunEvent } from '@bobops/core';
import type { JsonStore } from '../store/json-store';

export interface EmitInput {
  runId: string;
  actor: Actor;
  kind: EventKind;
  type: EventType;
  message: string;
  evidence?: Evidence[];
}

type Listener = (event: RunEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Listener>();

  constructor(private readonly store: JsonStore) {}

  emit(input: EmitInput): RunEvent {
    const event: RunEvent = {
      id: newId('evt'),
      at: nowIso(),
      runId: input.runId,
      actor: input.actor,
      kind: input.kind,
      type: input.type,
      message: input.message,
      evidence: input.evidence ?? [],
    };
    this.store.data.events.push(event);
    this.store.persist();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[event-bus] listener failed', err);
      }
    }
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
```

### Task 4.4 — RunService (create, analysis, plan, approvals)

- [ ] **Step 1: Create `apps/orchestrator/src/services/run-service.ts`**

```ts
/**
 * @file      apps/orchestrator/src/services/run-service.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   UNDERSTAND + PLAN stages: create runs, record Bob's analysis, accept hashed plans, record HUMAN approval decisions.
 * @depends   @bobops/core, ../store/json-store, ../events/event-bus, ../lib/*
 * @usedBy    routes/runs.ts, routes/approvals.ts, LifecycleService (transition)
 * @agentNotes ALL run state changes go through transition() (it validates against the core state machine and records
 *             stateHistory). decideApproval is only reachable through the token-protected route.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  assertTransition,
  evidence,
  newId,
  nowIso,
  type Actor,
  type AppProfile,
  type Approval,
  type DeploymentPlan,
  type ProviderId,
  type Run,
  type RunState,
  type Severity,
} from '@bobops/core';
import type { EventBus } from '../events/event-bus';
import { BadRequestError, ConflictError } from '../lib/errors';
import { sha256 } from '../lib/hash';
import type { JsonStore } from '../store/json-store';

export interface CreateRunInput {
  projectName: string;
  repoPath: string;
  objective: string;
  targets: ProviderId[];
}

const maxSeverity = (plan: DeploymentPlan): Severity =>
  plan.risks.some((r) => r.severity === 'high') ? 'high' : plan.risks.some((r) => r.severity === 'medium') ? 'medium' : 'low';

export class RunService {
  constructor(
    private readonly store: JsonStore,
    private readonly bus: EventBus,
    private readonly repoRoot: string,
  ) {}

  transition(run: Run, to: RunState): Run {
    assertTransition(run.state, to);
    const at = nowIso();
    const next: Run = { ...run, state: to, updatedAt: at, stateHistory: [...run.stateHistory, { state: to, at }] };
    this.store.upsert('runs', next);
    return next;
  }

  createRun(input: CreateRunInput, actor: Actor = 'human'): Run {
    const abs = path.resolve(this.repoRoot, input.repoPath);
    const rel = path.relative(this.repoRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new BadRequestError('repoPath must be inside the repository');
    if (!fs.existsSync(abs)) throw new BadRequestError(`repoPath ${input.repoPath} does not exist`);
    const now = nowIso();
    const run: Run = {
      id: newId('run'),
      projectName: input.projectName,
      repoPath: rel.split(path.sep).join('/'),
      objective: input.objective,
      targets: [...new Set(input.targets)],
      state: 'created',
      createdAt: now,
      updatedAt: now,
      stateHistory: [{ state: 'created', at: now }],
    };
    this.store.upsert('runs', run);
    this.bus.emit({
      runId: run.id,
      actor,
      kind: 'action',
      type: 'run.created',
      message: `Run created for ${run.projectName} (${run.repoPath}): "${run.objective}" → ${run.targets.join(' + ')}`,
    });
    return run;
  }

  recordAnalysis(runId: string, profile: AppProfile): Run {
    const run = this.store.getRun(runId);
    const next = this.transition({ ...run, profile }, 'analyzed');
    this.bus.emit({
      runId,
      actor: 'bob',
      kind: 'observation',
      type: 'analysis.recorded',
      message: `Bob profiled ${profile.name}: ${profile.runtime} ${profile.runtimeVersion} / ${profile.framework}, port ${profile.port}, health ${profile.healthPath}, required env [${profile.requiredEnv.join(', ')}]`,
      evidence: [evidence('Application profile', 'bob:synthesis', profile)],
    });
    for (const finding of profile.specialistFindings) {
      this.bus.emit({
        runId,
        actor: 'bob',
        kind: 'inference',
        type: 'specialist.finding',
        message: `${finding.specialist}: ${finding.summary}`,
        evidence: [evidence(`${finding.specialist} findings`, `bob:${finding.specialist}`, finding)],
      });
    }
    return next;
  }

  submitPlan(runId: string, plan: DeploymentPlan): { run: Run; approval: Approval } {
    const run = this.store.getRun(runId);
    if (!['analyzed', 'awaiting_approval', 'rejected'].includes(run.state)) {
      throw new ConflictError(`Cannot submit a plan while the run is ${run.state}. Record the analysis first.`);
    }
    for (const target of plan.targets) {
      if (!run.targets.includes(target.provider)) {
        throw new BadRequestError(`Plan targets ${target.provider}, which is not one of this run's targets (${run.targets.join(', ')})`);
      }
    }
    const now = nowIso();
    for (const a of this.store.data.approvals) {
      if (a.runId === runId && a.kind === 'deploy_plan' && a.status === 'pending') {
        this.store.upsert('approvals', { ...a, status: 'rejected', decidedAt: now, decidedBy: 'orchestrator', comment: 'Superseded by a newer plan' });
      }
    }
    const planHash = sha256(plan);
    const updated = this.transition({ ...run, plan, planHash }, 'awaiting_approval');
    const approval: Approval = {
      id: newId('apr'),
      runId,
      kind: 'deploy_plan',
      subjectId: runId,
      subjectHash: planHash,
      summary: plan.summary,
      risk: maxSeverity(plan),
      status: 'pending',
      requestedAt: now,
    };
    this.store.upsert('approvals', approval);
    this.bus.emit({
      runId,
      actor: 'bob',
      kind: 'proposal',
      type: 'plan.submitted',
      message: `Bob proposed a plan for ${plan.targets.map((t) => `${t.provider}/${t.service}`).join(' + ')} (${plan.risks.length} risks, ${plan.generatedAssets.length} generated assets)`,
      evidence: [evidence('Deployment plan', 'bob:synthesis', plan)],
    });
    this.bus.emit({
      runId,
      actor: 'orchestrator',
      kind: 'proposal',
      type: 'approval.requested',
      message: `Human approval required for the deployment plan (hash ${planHash.slice(0, 12)}…, risk ${approval.risk})`,
    });
    return { run: updated, approval };
  }

  decideApproval(approvalId: string, decision: 'approved' | 'rejected', decidedBy: string, comment?: string): Approval {
    const approval = this.store.getApproval(approvalId);
    if (approval.status !== 'pending') throw new ConflictError(`Approval ${approvalId} is already ${approval.status}`);
    const run = this.store.getRun(approval.runId);
    if (approval.kind === 'deploy_plan' && approval.subjectHash !== run.planHash) {
      throw new ConflictError('The plan changed after this approval was requested. Review the new plan.');
    }
    if (approval.kind === 'deploy_plan') {
      this.transition(run, decision === 'approved' ? 'approved' : 'rejected');
    } else {
      const incident = this.store.data.incidents.find((i) => i.remediation?.approvalId === approvalId);
      if (incident?.remediation) {
        this.store.upsert('incidents', {
          ...incident,
          status: decision === 'approved' ? incident.status : 'diagnosed',
          remediation: { ...incident.remediation, status: decision },
        });
        if (decision === 'rejected' && run.state === 'awaiting_remediation_approval') this.transition(run, 'incident');
      }
    }
    const decided: Approval = { ...approval, status: decision, decidedAt: nowIso(), decidedBy, comment };
    this.store.upsert('approvals', decided);
    this.bus.emit({
      runId: approval.runId,
      actor: 'human',
      kind: 'action',
      type: 'approval.decided',
      message: `${decidedBy} ${decision} the ${approval.kind === 'deploy_plan' ? 'deployment plan' : 'remediation'}${comment ? ` — "${comment}"` : ''}`,
    });
    return decided;
  }
}
```

### Task 4.5 — Dependency container, routes, app, entry point

- [ ] **Step 1: Create `apps/orchestrator/src/deps.ts`** (Phase 5 replaces this file)

```ts
/**
 * @file      apps/orchestrator/src/deps.ts
 * @phase     P4 (replaced in P5, P8, P12)
 * @owner     Orchestration & Cloud
 * @purpose   Composition root: builds every service once and wires them together. Tests pass overrides (fakes).
 * @depends   ./config, ./store, ./events, ./services
 * @usedBy    src/index.ts, src/app.ts, tests
 * @agentNotes Add new services HERE, never `new` them inside routes.
 */
import type { CloudProvider, ProviderId } from '@bobops/core';
import type { Config } from './config';
import { EventBus } from './events/event-bus';
import { RunService } from './services/run-service';
import { JsonStore } from './store/json-store';

export interface Deps {
  config: Config;
  store: JsonStore;
  bus: EventBus;
  runs: RunService;
  providers: Map<ProviderId, CloudProvider>;
}

export interface DepOverrides {
  providers?: Map<ProviderId, CloudProvider>;
}

export function createDeps(config: Config, overrides: DepOverrides = {}): Deps {
  const store = new JsonStore(config.dataFile);
  const bus = new EventBus(store);
  const runs = new RunService(store, bus, config.repoRoot);
  return { config, store, bus, runs, providers: overrides.providers ?? new Map() };
}
```

- [ ] **Step 2: Create `apps/orchestrator/src/routes/runs.ts`** (Phase 5 replaces this file)

```ts
/**
 * @file      apps/orchestrator/src/routes/runs.ts
 * @phase     P4 (replaced in P5)
 * @owner     Orchestration & Cloud
 * @purpose   HTTP routes under /api/runs for creating runs, recording analysis, submitting plans and notes.
 * @depends   hono, zod, @bobops/core, ../deps
 * @usedBy    app.ts (mounted at /api/runs); callers: bob-mcp, control-center, scripts
 * @agentNotes Validate every body with a core schema. `x-actor: bob` marks calls coming from the MCP bridge.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { AppProfileSchema, DeploymentPlanSchema, EventKindSchema, ProviderIdSchema, SpecialistSchema } from '@bobops/core';
import type { Deps } from '../deps';

const CreateRunBody = z.object({
  projectName: z.string().min(1),
  repoPath: z.string().min(1),
  objective: z.string().min(1),
  targets: z.array(ProviderIdSchema).min(1),
});

const NoteBody = z.object({
  kind: EventKindSchema.default('observation'),
  message: z.string().min(1),
  specialist: SpecialistSchema.optional(),
});

export function runRoutes(deps: Deps) {
  const r = new Hono();

  r.get('/', (c) => c.json(deps.store.data.runs.slice().reverse()));

  r.post('/', async (c) => {
    const actor = c.req.header('x-actor') === 'bob' ? 'bob' : 'human';
    return c.json(deps.runs.createRun(CreateRunBody.parse(await c.req.json()), actor), 201);
  });

  r.get('/:id', (c) => c.json(deps.store.aggregate(c.req.param('id'))));

  r.post('/:id/analysis', async (c) =>
    c.json(deps.runs.recordAnalysis(c.req.param('id'), AppProfileSchema.parse(await c.req.json()))),
  );

  r.post('/:id/plan', async (c) =>
    c.json(deps.runs.submitPlan(c.req.param('id'), DeploymentPlanSchema.parse(await c.req.json())), 201),
  );

  r.post('/:id/notes', async (c) => {
    const runId = c.req.param('id');
    deps.store.getRun(runId);
    const body = NoteBody.parse(await c.req.json());
    const event = deps.bus.emit({
      runId,
      actor: 'bob',
      kind: body.kind,
      type: 'bob.note',
      message: body.specialist ? `${body.specialist}: ${body.message}` : body.message,
    });
    return c.json(event, 201);
  });

  return r;
}
```

- [ ] **Step 3: Create `apps/orchestrator/src/routes/approvals.ts`**

```ts
/**
 * @file      apps/orchestrator/src/routes/approvals.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   Human approval endpoints. Deciding requires the x-approval-token header, which only the Control Center has.
 * @depends   hono, zod, ../deps, ../lib/errors
 * @usedBy    control-center ApprovalQueue; NEVER bob-mcp (by design there is no approve tool)
 * @agentNotes Do not add any alternative way to approve. Failed attempts are logged as guard.blocked audit events.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps';
import { HttpError } from '../lib/errors';

const DecisionBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  decidedBy: z.string().min(1).default('developer'),
  comment: z.string().optional(),
});

export function approvalRoutes(deps: Deps) {
  const r = new Hono();

  r.get('/', (c) => {
    const status = c.req.query('status');
    return c.json(deps.store.data.approvals.filter((a) => !status || a.status === status));
  });

  r.post('/:id/decision', async (c) => {
    const approval = deps.store.getApproval(c.req.param('id'));
    if (c.req.header('x-approval-token') !== deps.config.APPROVAL_TOKEN) {
      deps.bus.emit({
        runId: approval.runId,
        actor: 'orchestrator',
        kind: 'verification',
        type: 'guard.blocked',
        message: 'Blocked an approval decision that did not come from a human in the Control Center (missing/invalid approval token)',
      });
      throw new HttpError(401, 'approval_token_required', 'Only a human using the Control Center can decide approvals');
    }
    const body = DecisionBody.parse(await c.req.json());
    return c.json(deps.runs.decideApproval(approval.id, body.decision, body.decidedBy, body.comment));
  });

  return r;
}
```

- [ ] **Step 4: Create `apps/orchestrator/src/routes/providers.ts`**

```ts
/**
 * @file      apps/orchestrator/src/routes/providers.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   GET /api/providers — capability discovery + auth status for every configured cloud provider.
 * @depends   hono, @bobops/core, ../deps
 * @usedBy    control-center ProviderCards, bob-mcp devops_list_providers
 * @agentNotes Never throws for a single broken provider — reports authenticated:false with the error as a note.
 */
import { Hono } from 'hono';
import type { ProviderCapabilities } from '@bobops/core';
import type { Deps } from '../deps';

export function providerRoutes(deps: Deps) {
  const r = new Hono();
  r.get('/', async (c) => {
    const list = await Promise.all(
      [...deps.providers.values()].map(async (p): Promise<ProviderCapabilities> => {
        try {
          return await p.capabilities();
        } catch (err) {
          return {
            provider: p.id,
            displayName: p.id,
            authenticated: false,
            region: 'unknown',
            services: [],
            supportsRollback: false,
            notes: [err instanceof Error ? err.message : String(err)],
          };
        }
      }),
    );
    return c.json(list);
  });
  return r;
}
```

- [ ] **Step 5: Create `apps/orchestrator/src/routes/events.ts`**

```ts
/**
 * @file      apps/orchestrator/src/routes/events.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   GET /api/events/stream — Server-Sent Events of every audit event (live Control Center updates).
 * @depends   hono/streaming, ../deps
 * @usedBy    control-center lib/api.ts subscribeEvents()
 * @agentNotes Sends a ping every 15 s to keep proxies from closing the stream. Event name is "run-event".
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Deps } from '../deps';

export function eventRoutes(deps: Deps) {
  const r = new Hono();
  r.get('/stream', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = deps.bus.subscribe((event) => {
        void stream.writeSSE({ event: 'run-event', id: event.id, data: JSON.stringify(event) });
      });
      stream.onAbort(() => unsubscribe());
      while (!stream.aborted) {
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
        await stream.sleep(15_000);
      }
      unsubscribe();
    }),
  );
  return r;
}
```

- [ ] **Step 6: Create `apps/orchestrator/src/app.ts`** (Phase 5 replaces this file)

```ts
/**
 * @file      apps/orchestrator/src/app.ts
 * @phase     P4 (replaced in P5)
 * @owner     Orchestration & Cloud
 * @purpose   Builds the Hono app: CORS, route mounting, and the single error-to-JSON mapping.
 * @depends   hono, zod, @bobops/core, ./deps, ./routes/*, ./lib/errors
 * @usedBy    src/index.ts, tests (app.request())
 * @agentNotes Error body is ALWAYS { error, code }. Keep CORS allowHeaders in sync with headers used by the UI.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { InvalidTransitionError } from '@bobops/core';
import type { Deps } from './deps';
import { HttpError } from './lib/errors';
import { approvalRoutes } from './routes/approvals';
import { eventRoutes } from './routes/events';
import { providerRoutes } from './routes/providers';
import { runRoutes } from './routes/runs';

export function createApp(deps: Deps) {
  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: [deps.config.CONTROL_CENTER_ORIGIN],
      allowHeaders: ['content-type', 'x-approval-token', 'x-actor'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.get('/api/health', (c) => c.json({ ok: true, service: 'bobops-orchestrator', time: new Date().toISOString() }));
  app.route('/api/runs', runRoutes(deps));
  app.route('/api/approvals', approvalRoutes(deps));
  app.route('/api/providers', providerRoutes(deps));
  app.route('/api/events', eventRoutes(deps));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, code: err.code }, err.status as ContentfulStatusCode);
    if (err instanceof InvalidTransitionError) return c.json({ error: err.message, code: 'invalid_transition' }, 409);
    if (err instanceof ZodError) return c.json({ error: 'Validation failed', code: 'validation', issues: err.issues }, 400);
    if (err instanceof SyntaxError) return c.json({ error: 'Request body must be valid JSON', code: 'bad_json' }, 400);
    console.error('[orchestrator] unhandled error', err);
    return c.json({ error: err instanceof Error ? err.message : 'Internal error', code: 'internal' }, 500);
  });

  return app;
}
```

- [ ] **Step 7: Create `apps/orchestrator/src/index.ts`** (Phase 12 replaces this file)

```ts
/**
 * @file      apps/orchestrator/src/index.ts
 * @phase     P4 (replaced in P12)
 * @owner     Orchestration & Cloud
 * @purpose   Process entry: load root .env, validate config, build deps, start the HTTP server on ORCHESTRATOR_PORT.
 * @depends   dotenv, @hono/node-server, ./config, ./deps, ./app
 * @usedBy    `pnpm dev:api`
 * @agentNotes If startup fails with a zod error, a required .env value is missing (usually APPROVAL_TOKEN).
 */
import path from 'node:path';
import { serve } from '@hono/node-server';
import { config as loadDotenv } from 'dotenv';
import { createApp } from './app';
import { REPO_ROOT, loadConfig } from './config';
import { createDeps } from './deps';

loadDotenv({ path: path.join(REPO_ROOT, '.env') });
const config = loadConfig();
const deps = createDeps(config);

serve({ fetch: createApp(deps).fetch, port: config.ORCHESTRATOR_PORT }, (info) => {
  console.log(`BobOps orchestrator listening on http://localhost:${info.port} (demo mode: ${config.demoMode})`);
});
```

### Task 4.6 — Integration tests

- [ ] **Step 1: Create `apps/orchestrator/src/app.test.ts`**

```ts
/**
 * @file      apps/orchestrator/src/app.test.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   HTTP-level tests of runs, plans and the HUMAN approval gate (in-memory store, no clouds).
 * @depends   vitest, @bobops/core fixtures, ./app, ./config, ./deps
 * @usedBy    pnpm test
 * @agentNotes repoPath uses 'apps/orchestrator' because it always exists, even before the demo app is built.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_APP_PROFILE, examplePlan, type Approval, type RunAggregate } from '@bobops/core';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDeps } from './deps';

const TOKEN = 'test-approval-token';
const testConfig = () => loadConfig({ APPROVAL_TOKEN: TOKEN, DEMO_MODE: 'true' } as NodeJS.ProcessEnv, { inMemory: true });
const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

function setup() {
  const deps = createDeps(testConfig());
  return { deps, app: createApp(deps) };
}

async function createRun(app: ReturnType<typeof createApp>) {
  const res = await app.request('/api/runs', post({ projectName: 'nimbus-books', repoPath: 'apps/orchestrator', objective: 'test', targets: ['ibm-cloud', 'aws'] }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function plannedRun(app: ReturnType<typeof createApp>) {
  const runId = await createRun(app);
  expect((await app.request(`/api/runs/${runId}/analysis`, post(EXAMPLE_APP_PROFILE))).status).toBe(200);
  const res = await app.request(`/api/runs/${runId}/plan`, post(examplePlan()));
  expect(res.status).toBe(201);
  const { approval } = (await res.json()) as { approval: Approval };
  return { runId, approval };
}

const getRun = async (app: ReturnType<typeof createApp>, id: string) => (await (await app.request(`/api/runs/${id}`)).json()) as RunAggregate;

describe('orchestrator: runs, plans and approvals', () => {
  it('reports health', async () => {
    const { app } = setup();
    expect((await app.request('/api/health')).status).toBe(200);
  });

  it('moves a run to awaiting_approval with a hash-bound pending approval', async () => {
    const { app } = setup();
    const { runId, approval } = await plannedRun(app);
    const agg = await getRun(app, runId);
    expect(agg.run.state).toBe('awaiting_approval');
    expect(approval.status).toBe('pending');
    expect(approval.subjectHash).toBe(agg.run.planHash);
    expect(agg.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['run.created', 'analysis.recorded', 'specialist.finding', 'plan.submitted', 'approval.requested']),
    );
  });

  it('refuses approval without the human token and records guard.blocked', async () => {
    const { app } = setup();
    const { runId, approval } = await plannedRun(app);
    const res = await app.request(`/api/approvals/${approval.id}/decision`, post({ decision: 'approved' }));
    expect(res.status).toBe(401);
    const agg = await getRun(app, runId);
    expect(agg.run.state).toBe('awaiting_approval');
    expect(agg.events.some((e) => e.type === 'guard.blocked')).toBe(true);
  });

  it('approves with the human token', async () => {
    const { app } = setup();
    const { runId, approval } = await plannedRun(app);
    const res = await app.request(`/api/approvals/${approval.id}/decision`, post({ decision: 'approved', decidedBy: 'tester' }, { 'x-approval-token': TOKEN }));
    expect(res.status).toBe(200);
    expect((await getRun(app, runId)).run.state).toBe('approved');
  });

  it('supersedes the pending approval when a new plan is submitted', async () => {
    const { app } = setup();
    const { runId, approval } = await plannedRun(app);
    await app.request(`/api/runs/${runId}/plan`, post(examplePlan(['ibm-cloud'])));
    const agg = await getRun(app, runId);
    expect(agg.approvals.find((a) => a.id === approval.id)?.status).toBe('rejected');
    expect(agg.approvals.filter((a) => a.status === 'pending')).toHaveLength(1);
  });

  it('rejects a plan before analysis with 409', async () => {
    const { app } = setup();
    const runId = await createRun(app);
    expect((await app.request(`/api/runs/${runId}/plan`, post(examplePlan()))).status).toBe(409);
  });

  it('rejects a repoPath outside the repository with 400', async () => {
    const { app } = setup();
    const res = await app.request('/api/runs', post({ projectName: 'x', repoPath: '../../Windows', objective: 'x', targets: ['aws'] }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2:** `pnpm install; pnpm test` → Expected: all tests pass (core 23, demo-service 6, orchestrator 7).
- [ ] **Step 3:** `pnpm typecheck` → Expected: no errors.

### Task 4.7 — Run it (HUMAN)

- [ ] **Step 1:** `pnpm dev:api` → Expected: `BobOps orchestrator listening on http://localhost:4000 (demo mode: true)`.
- [ ] **Step 2:** In another terminal:
  ```powershell
  curl.exe -s http://localhost:4000/api/health
  Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/runs -ContentType 'application/json' -Body '{"projectName":"nimbus-books","repoPath":"apps/demo-service","objective":"smoke","targets":["ibm-cloud"]}'
  curl.exe -s http://localhost:4000/api/runs
  ```
  Expected: `{"ok":true,...}`, then a run object with `state: created`, then a list containing it.
- [ ] **Step 3:** In a browser, open `http://localhost:4000/api/events/stream`, then create another run. Expected: a
  `run-event` line appears live. Afterwards, stop the server and delete `apps/orchestrator/.data/store.json`.

### Task 4.8 — RETROFIT (post-phase-9): user-defined sentinel check-in interval

> Depends on Task 2.13 (core). `Run` now carries `sentinelIntervalMinutes` so the developer (via Bob) controls how often
> the GitHub sentinel checks a deployment, instead of a hardcoded 5-minute cadence.

- [ ] **Step 1: In `src/services/run-service.ts`**, add a field to `CreateRunInput`:

```ts
export interface CreateRunInput {
  projectName: string;
  repoPath: string;
  objective: string;
  targets: ProviderId[];
  /** How often the user wants the GitHub sentinel to check on this deployment, in minutes (multiple of 5). */
  sentinelIntervalMinutes?: number;
}
```

  Then in `createRun()`, add `sentinelIntervalMinutes: input.sentinelIntervalMinutes ?? 5,` to the `Run` object literal
  (right after `targets: [...new Set(input.targets)],`), and update the `run.created` message to end with
  `` ` (sentinel check-in every ${run.sentinelIntervalMinutes} min)` ``.

- [ ] **Step 2: In `src/routes/runs.ts`**, add to `CreateRunBody`:

```ts
  /** How often the user wants the GitHub sentinel to check on this deployment, in minutes. GitHub Actions cannot
   * schedule faster than every 5 minutes, so this must be a multiple of 5 (5, 10, 15, 30, 60, ...). */
  sentinelIntervalMinutes: z
    .number()
    .int()
    .min(5)
    .max(1440)
    .refine((n) => n % 5 === 0, 'sentinelIntervalMinutes must be a multiple of 5')
    .default(5)
    .optional(),
```

- [ ] **Step 3:** `pnpm test` → still 36 orchestrator-related tests pass unchanged (this field has a default, so no existing test call site breaks).

## HANDOFF

```text
✅ PHASE 04 COMPLETE — Orchestrator: runs, plans, human approvals
BUILT:
  - apps/orchestrator: config, errors, sha256 hashing, JSON store, event bus + SSE, RunService, routes (runs, approvals, providers, events)
  - 7 integration tests incl. "approval without human token → 401 + guard.blocked"
DO THIS (human):
  1. pnpm test; pnpm typecheck
  2. pnpm dev:api  → curl.exe -s http://localhost:4000/api/health
  3. Create a run with Invoke-RestMethod (Task 4.7) and watch http://localhost:4000/api/events/stream
EXPECT:
  - 36 tests pass; server logs "listening on http://localhost:4000 (demo mode: true)"
  - SSE shows a run-event when a run is created
IF IT FAILS:
  - ZodError "APPROVAL_TOKEN" at startup → set APPROVAL_TOKEN in the root .env
  - Cannot find 'hono/utils/http-status' → hono < 4.7; pnpm --filter @bobops/orchestrator add hono@^4.7.0
EVIDENCE:
  - Screenshot Bob's task summary → evidence/bob-task-summaries/phase-04-orchestrator-runs.png
  - git add -A; git commit -m "feat(p04): orchestrator runs and approvals"; git push
```
