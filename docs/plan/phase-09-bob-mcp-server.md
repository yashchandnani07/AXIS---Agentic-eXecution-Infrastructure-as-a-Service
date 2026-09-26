<!--
@file     docs/plan/phase-09-bob-mcp-server.md
@purpose  Build the MCP bridge that lets IBM Bob drive the orchestrator (17 tools, deliberately NO approve tool).
@owner    Orchestration & Cloud (O)
-->
# Phase 09 — `apps/bob-mcp`: the MCP bridge between IBM Bob and the orchestrator (~60 min)

**Goal:** Build a stdio MCP server that Bob launches from `.bob/mcp.json`. It exposes 17 lifecycle tools that call the
orchestrator's HTTP API. It returns **compact** summaries, which saves Bobcoins and context, and it forwards validation errors
verbatim so Bob can fix its own JSON. There is **no approve tool**, and a self-test proves that.

**Depends on:** Phase 05 (the API). Real clouds are not needed to build this phase.
**Interfaces produced:** the MCP server `bobops-orchestrator` with the tools listed in the master plan §8.3.
`summarizeRun(agg, uiBase)` is in `src/summarize.ts`.

---

### Task 9.1 — Package scaffold

- [ ] **Step 1: Create `apps/bob-mcp/package.json`**

```json
{
  "name": "@bobops/bob-mcp",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "start": "node dist/bob-mcp.mjs",
    "dev": "tsx src/index.ts",
    "selftest": "tsx src/selftest.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@bobops/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.17.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "esbuild": "^0.25.0"
  }
}
```

- [ ] **Step 2: Create `apps/bob-mcp/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `apps/bob-mcp/build.mjs`**

```js
/**
 * @file      apps/bob-mcp/build.mjs
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   Bundles the MCP server (+ @bobops/core + SDK + zod) into ONE file: dist/bob-mcp.mjs, launched by Bob via `node`.
 * @depends   esbuild
 * @usedBy    `pnpm build:mcp` (root) / `pnpm --filter @bobops/bob-mcp build`
 * @agentNotes Re-run after ANY change to apps/bob-mcp or packages/core, then restart the MCP server in Bob.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/bob-mcp.mjs',
  banner: { js: "import { createRequire as __bobopsCreateRequire } from 'module'; const require = __bobopsCreateRequire(import.meta.url);" },
  logLevel: 'info',
});
```

- [ ] **Step 4:** `pnpm install`

### Task 9.2 — HTTP client and compact run summary (test first)

- [ ] **Step 1: Create `apps/bob-mcp/src/client.ts`**

```ts
/**
 * @file      apps/bob-mcp/src/client.ts
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   Minimal HTTP client for the orchestrator. Tags every call with x-actor: bob. Turns HTTP errors into
 *            readable Error messages (including zod validation issues) so Bob can self-correct.
 * @depends   global fetch
 * @usedBy    ./tools.ts
 * @agentNotes NEVER add the approval token here. Bob must not be able to approve anything.
 */
export class OrchestratorClient {
  constructor(private readonly baseUrl: string) {}

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-actor': 'bob' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Cannot reach the BobOps orchestrator at ${this.baseUrl}. Ask the developer to run "pnpm dev:api". (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const e = (data ?? {}) as { error?: string; code?: string; issues?: unknown };
      const issues = e.issues ? `\nValidation issues: ${JSON.stringify(e.issues).slice(0, 1500)}` : '';
      throw new Error(`${method} ${path} failed with HTTP ${res.status} ${e.code ?? ''}: ${e.error ?? text}${issues}`);
    }
    return data as T;
  }
}
```

- [ ] **Step 2: Write `apps/bob-mcp/src/summarize.test.ts`**

```ts
/**
 * @file      apps/bob-mcp/src/summarize.test.ts
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   The compact summary Bob sees must include state, endpoints, health, approvals and incidents.
 * @depends   vitest, @bobops/core, ./summarize
 * @usedBy    pnpm test
 * @agentNotes Keep summaries small — they are paid for in Bobcoins on every devops_get_run / devops_wait call.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_APP_PROFILE, examplePlan, type RunAggregate } from '@bobops/core';
import { summarizeRun } from './summarize';

const agg: RunAggregate = {
  run: {
    id: 'run_1',
    projectName: 'nimbus-books',
    repoPath: 'apps/demo-service',
    objective: 'deploy',
    targets: ['ibm-cloud'],
    state: 'incident',
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
    stateHistory: [],
    profile: EXAMPLE_APP_PROFILE,
    plan: examplePlan(['ibm-cloud']),
    planHash: 'abcdef1234567890',
  },
  approvals: [
    { id: 'apr_1', runId: 'run_1', kind: 'remediation', subjectId: 'rem_1', subjectHash: 'h', summary: 'Set CATALOG_MODE=featured', risk: 'low', status: 'pending', requestedAt: 'x' },
  ],
  deployments: [
    { id: 'dep_1', runId: 'run_1', provider: 'ibm-cloud', appName: 'bobops-nimbus-books', region: 'us-south', healthPath: '/health', status: 'succeeded', endpoint: 'https://x', revision: 'r2', startedAt: 'x' },
  ],
  healthChecks: [
    { id: 'h1', runId: 'run_1', provider: 'ibm-cloud', endpoint: 'https://x/health', ok: false, statusCode: 503, latencyMs: 80, body: { status: 'unhealthy' }, checkedAt: 'x' },
  ],
  incidents: [{ id: 'inc_1', runId: 'run_1', provider: 'ibm-cloud', source: 'sentinel', status: 'open', title: 't', openedAt: 'x', probes: [] }],
  events: [{ id: 'e1', runId: 'run_1', at: '2026-09-27T10:00:01.000Z', actor: 'sentinel', kind: 'observation', type: 'incident.opened', message: 'opened', evidence: [] }],
};

describe('summarizeRun', () => {
  it('produces a compact, decision-ready view', () => {
    const s = summarizeRun(agg, 'http://localhost:3000');
    expect(s.state).toBe('incident');
    expect(s.controlCenterUrl).toBe('http://localhost:3000/run?id=run_1');
    expect(s.deployments[0]?.endpoint).toBe('https://x');
    expect(s.health[0]?.statusCode).toBe(503);
    expect(s.health[0]?.body).toEqual({ status: 'unhealthy' });
    expect(s.pendingApprovals).toHaveLength(1);
    expect(s.openIncidents[0]?.id).toBe('inc_1');
    expect(s.recentEvents[0]).toContain('incident.opened');
  });
});
```

- [ ] **Step 3: Create `apps/bob-mcp/src/summarize.ts`**

```ts
/**
 * @file      apps/bob-mcp/src/summarize.ts
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   Converts a full RunAggregate into the compact, decision-ready JSON Bob reads (saves context + Bobcoins).
 * @depends   @bobops/core
 * @usedBy    ./tools.ts (devops_get_run, devops_wait)
 * @agentNotes Include response bodies ONLY for failing health checks (they carry the diagnosis evidence).
 */
import { describeAction, type Deployment, type HealthCheck, type ProviderId, type RunAggregate } from '@bobops/core';

export function summarizeRun(agg: RunAggregate, uiBase: string) {
  const latestDeploy = new Map<ProviderId, Deployment>();
  for (const d of agg.deployments) latestDeploy.set(d.provider, d);
  const latestHealth = new Map<ProviderId, HealthCheck>();
  for (const h of agg.healthChecks) latestHealth.set(h.provider, h);
  const lastDecision = agg.approvals.filter((a) => a.status !== 'pending').at(-1);

  return {
    runId: agg.run.id,
    state: agg.run.state,
    objective: agg.run.objective,
    repoPath: agg.run.repoPath,
    controlCenterUrl: `${uiBase}/run?id=${agg.run.id}`,
    planHash: agg.run.planHash?.slice(0, 12),
    targets: (agg.run.plan?.targets ?? []).map((t) => ({ provider: t.provider, service: t.service, appName: t.appName, region: t.region, env: t.env })),
    deployments: [...latestDeploy.values()].map((d) => ({
      provider: d.provider,
      status: d.status,
      endpoint: d.endpoint,
      revision: d.revision,
      error: d.error,
      note: d.note,
    })),
    health: [...latestHealth.values()].map((h) => ({
      provider: h.provider,
      ok: h.ok,
      statusCode: h.statusCode,
      latencyMs: h.latencyMs,
      revision: h.revision,
      checkedAt: h.checkedAt,
      body: h.ok ? undefined : h.body,
      error: h.error,
    })),
    pendingApprovals: agg.approvals
      .filter((a) => a.status === 'pending')
      .map((a) => ({ id: a.id, kind: a.kind, summary: a.summary, risk: a.risk })),
    lastDecision: lastDecision ? { kind: lastDecision.kind, status: lastDecision.status, by: lastDecision.decidedBy, comment: lastDecision.comment } : null,
    openIncidents: agg.incidents
      .filter((i) => i.status !== 'resolved')
      .map((i) => ({
        id: i.id,
        provider: i.provider,
        status: i.status,
        source: i.source,
        githubIssueUrl: i.githubIssueUrl,
        diagnosed: Boolean(i.diagnosis),
        remediation: i.remediation ? { action: describeAction(i.remediation.action), status: i.remediation.status } : null,
      })),
    recentEvents: agg.events.slice(-12).map((e) => `${e.at.slice(11, 19)} [${e.actor}/${e.kind}] ${e.type}: ${e.message}`),
  };
}
```

- [ ] **Step 4:** `pnpm vitest run apps/bob-mcp` → Expected: PASS (1 test).

### Task 9.3 — Tools and server

- [ ] **Step 1: Create `apps/bob-mcp/src/tools.ts`**

```ts
/**
 * @file      apps/bob-mcp/src/tools.ts
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   Registers the 17 BobOps lifecycle tools on the MCP server. Tool descriptions are prompts for Bob:
 *            they state the lifecycle stage, evidence kind and the NEXT expected tool call.
 * @depends   @modelcontextprotocol/sdk, zod, @bobops/core (schemas = JSON Schema Bob sees), ./client, ./summarize
 * @usedBy    ./index.ts
 * @agentNotes
 *   - There is intentionally NO approve/decide tool. Never add one. Humans approve in the Control Center.
 *   - Input schemas reuse @bobops/core zod schemas so Bob's JSON is validated before it reaches the orchestrator.
 *   - The `as never` cast on the handler is intentional (SDK generic typing varies across 1.x releases).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AppProfileSchema,
  DeploymentPlanSchema,
  DiagnosisSchema,
  EventKindSchema,
  ProviderIdSchema,
  RemediationActionSchema,
  SeveritySchema,
  SpecialistSchema,
  WaitConditionSchema,
  type RunAggregate,
} from '@bobops/core';
import type { OrchestratorClient } from './client';
import { summarizeRun } from './summarize';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const asText = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
});
const asError = (err: unknown): ToolResult => ({
  isError: true,
  content: [{ type: 'text', text: `ERROR: ${err instanceof Error ? err.message : String(err)}` }],
});

export function registerTools(server: McpServer, api: OrchestratorClient, uiBase: string): void {
  const define = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) => {
    server.registerTool(
      name,
      { description, inputSchema: shape },
      (async (args: z.infer<z.ZodObject<S>>) => {
        try {
          return asText(await run(args));
        } catch (err) {
          return asError(err);
        }
      }) as never,
    );
  };

  const runSummary = async (runId: string) => summarizeRun(await api.get<RunAggregate>(`/api/runs/${runId}`), uiBase);

  define(
    'devops_list_providers',
    'OBSERVATION. List the cloud providers the orchestrator can deploy to (IBM Cloud Code Engine, AWS Lambda) and whether each is authenticated. Call this FIRST.',
    {},
    () => api.get('/api/providers'),
  );

  define(
    'devops_list_runs',
    'OBSERVATION. List the 10 most recent runs (newest first) with state and the number of open incidents. Use it to find the runId for /investigate.',
    {},
    async () => {
      const runs = await api.get<Array<{ id: string; projectName: string; state: string; targets: string[]; createdAt: string }>>('/api/runs');
      const incidents = await api.get<Array<{ runId: string; status: string }>>('/api/incidents');
      return runs.slice(0, 10).map((r) => ({
        runId: r.id,
        projectName: r.projectName,
        state: r.state,
        targets: r.targets,
        createdAt: r.createdAt,
        openIncidents: incidents.filter((i) => i.runId === r.id && i.status !== 'resolved').length,
      }));
    },
  );

  define(
    'devops_create_run',
    'ACTION (UNDERSTAND). Start a deployment run for a repository folder (path relative to the workspace root, e.g. apps/demo-service) and objective. Returns runId and the Control Center URL to share with the developer.',
    {
      projectName: z.string().describe('short project name, e.g. nimbus-books'),
      repoPath: z.string().describe('folder relative to the workspace root'),
      objective: z.string().describe("the developer's deployment goal in one sentence"),
      targets: z.array(ProviderIdSchema).min(1),
    },
    async (args) => {
      const run = await api.post<{ id: string }>('/api/runs', args);
      return { runId: run.id, state: 'created', controlCenterUrl: `${uiBase}/run?id=${run.id}`, next: 'Run the specialist subagents, then devops_record_analysis.' };
    },
  );

  define(
    'devops_get_run',
    'OBSERVATION. Compact run summary: state, plan targets, deployments (endpoint/revision), latest health per provider (with failing response bodies), pending approvals, open incidents, recent audit events.',
    { runId: z.string() },
    ({ runId }) => runSummary(runId),
  );

  define(
    'devops_record_analysis',
    'OBSERVATION + INFERENCE (UNDERSTAND). Record the synthesized application profile including EVERY specialist finding (with file evidence). Required before devops_submit_plan. Example shape: packages/core/src/fixtures.ts EXAMPLE_APP_PROFILE.',
    { runId: z.string(), profile: AppProfileSchema },
    async ({ runId, profile }) => {
      await api.post(`/api/runs/${runId}/analysis`, profile);
      return { recorded: true, runId, next: 'Generate deployment assets if missing, then devops_submit_plan.' };
    },
  );

  define(
    'devops_log_note',
    'Append a labelled note (observation | inference | proposal | action | verification) to the run audit trail, optionally attributed to a specialist. Use it to narrate key reasoning the developer should see.',
    { runId: z.string(), kind: EventKindSchema, message: z.string().max(400), specialist: SpecialistSchema.optional() },
    async ({ runId, ...body }) => {
      await api.post(`/api/runs/${runId}/notes`, body);
      return { logged: true };
    },
  );

  define(
    'devops_submit_plan',
    'PROPOSAL (PLAN). Submit ONE deployment plan. The orchestrator hashes it and opens a HUMAN approval gate in the Control Center. You cannot approve it. Example shape: packages/core/src/fixtures.ts examplePlan().',
    { runId: z.string(), plan: DeploymentPlanSchema },
    async ({ runId, plan }) => {
      const r = await api.post<{ approval: { id: string; subjectHash: string; risk: string } }>(`/api/runs/${runId}/plan`, plan);
      return {
        state: 'awaiting_approval',
        approvalId: r.approval.id,
        planHash: r.approval.subjectHash.slice(0, 12),
        risk: r.approval.risk,
        approveAt: `${uiBase}/run?id=${runId}`,
        next: 'Tell the developer to review and approve in the Control Center, then call devops_wait with until=plan_decided.',
      };
    },
  );

  define(
    'devops_wait',
    'Block until a lifecycle condition is met or timeoutSec expires. until: plan_decided (human approved/rejected the plan) | deployed (deploy + verification finished) | remediation_decided (human decided the remediation) | recovered. Returns reached + a compact run summary.',
    { runId: z.string(), until: WaitConditionSchema, timeoutSec: z.number().int().min(10).max(1800).default(600) },
    async ({ runId, until, timeoutSec }) => {
      const deadline = Date.now() + timeoutSec * 1000;
      let last: { reached: boolean; state: string } = { reached: false, state: 'unknown' };
      while (Date.now() < deadline) {
        const slice = Math.max(5, Math.min(50, Math.ceil((deadline - Date.now()) / 1000)));
        last = await api.get<{ reached: boolean; state: string }>(`/api/runs/${runId}/wait?until=${until}&timeoutSec=${slice}`);
        if (last.reached) break;
      }
      return { until, reached: last.reached, state: last.state, run: await runSummary(runId) };
    },
  );

  define(
    'devops_execute_plan',
    'ACTION (TEST → PROVISION → BUILD → DEPLOY → VERIFY). Execute the HUMAN-APPROVED plan on every target in parallel. Fails with approval_required (403) if the plan is not approved. Then call devops_wait until=deployed (timeoutSec 1200).',
    { runId: z.string() },
    async ({ runId }) => {
      await api.post(`/api/runs/${runId}/execute`, {});
      return { started: true, next: 'Call devops_wait with until=deployed and timeoutSec=1200.' };
    },
  );

  define(
    'devops_verify',
    'VERIFICATION. Probe every deployed endpoint now (HTTP /health) and collect provider-native status. A failure on a healthy run opens an incident.',
    { runId: z.string() },
    ({ runId }) => api.post(`/api/runs/${runId}/verify`, {}),
  );

  define(
    'devops_get_logs',
    'OBSERVATION. Recent runtime log lines for one provider deployment of a run (Code Engine app logs / CloudWatch).',
    { runId: z.string(), provider: ProviderIdSchema, lines: z.number().int().min(10).max(200).default(60) },
    ({ runId, provider, lines }) => api.get(`/api/runs/${runId}/logs?provider=${provider}&lines=${lines}`),
  );

  define(
    'devops_sync_incidents',
    'OBSERVATION (RECOVER). Import open incidents filed by the GitHub Actions health sentinel (GitHub issues labelled sentinel-incident).',
    {},
    () => api.post('/api/incidents/sync', {}),
  );

  define(
    'devops_get_incident',
    'OBSERVATION (RECOVER). Full incident evidence: failing probes (status, latency, response body), GitHub issue link, the approved plan env for that provider, diagnosis/remediation state, recent events.',
    { incidentId: z.string() },
    ({ incidentId }) => api.get(`/api/incidents/${incidentId}`),
  );

  define(
    'devops_record_diagnosis',
    'INFERENCE (RECOVER). Record your evidence-backed diagnosis. evidence must cite >= 2 concrete items (probe body, log line, file:line, plan env).',
    { incidentId: z.string(), diagnosis: DiagnosisSchema },
    ({ incidentId, diagnosis }) => api.post(`/api/incidents/${incidentId}/diagnosis`, diagnosis),
  );

  define(
    'devops_propose_remediation',
    'PROPOSAL (RECOVER). Propose ONE bounded remediation: set_env (restore approved configuration) or rollback. Opens a HUMAN approval gate. Secrets can never be set this way.',
    { incidentId: z.string(), action: RemediationActionSchema, rationale: z.string().min(10), risk: SeveritySchema },
    async ({ incidentId, ...body }) => {
      const r = await api.post<{ approval: { id: string }; incident: { runId: string } }>(`/api/incidents/${incidentId}/remediation`, body);
      return {
        approvalId: r.approval.id,
        approveAt: `${uiBase}/run?id=${r.incident.runId}`,
        next: 'Ask the developer to approve in the Control Center, then devops_wait with until=remediation_decided.',
      };
    },
  );

  define(
    'devops_execute_remediation',
    'ACTION + VERIFICATION (RECOVER). Execute the HUMAN-APPROVED remediation, then re-verify every endpoint. Fails with approval_required (403) if not approved.',
    { incidentId: z.string() },
    ({ incidentId }) => api.post(`/api/incidents/${incidentId}/execute`, {}),
  );

  define(
    'devops_export_evidence',
    'Write the run audit trail to evidence/demo-runs/<runId>.json and .md (judge-facing evidence). Call at the end of every workflow.',
    { runId: z.string() },
    ({ runId }) => api.post(`/api/runs/${runId}/export`, {}),
  );
}
```

- [ ] **Step 2: Create `apps/bob-mcp/src/index.ts`**

```ts
/**
 * @file      apps/bob-mcp/src/index.ts
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   MCP stdio server entry. IBM Bob launches it (see .bob/mcp.json) and talks MCP over stdin/stdout.
 * @depends   @modelcontextprotocol/sdk, ./client, ./tools
 * @usedBy    dist/bob-mcp.mjs (bundled), `pnpm --filter @bobops/bob-mcp dev`
 * @agentNotes stdout = protocol. NEVER console.log here; use console.error for diagnostics.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OrchestratorClient } from './client';
import { registerTools } from './tools';

const orchestratorUrl = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000';
const controlCenterUrl = process.env.CONTROL_CENTER_URL ?? 'http://localhost:3000';

const server = new McpServer({ name: 'bobops-orchestrator', version: '1.0.0' });
registerTools(server, new OrchestratorClient(orchestratorUrl), controlCenterUrl);
await server.connect(new StdioServerTransport());
console.error(`[bobops-mcp] ready on stdio → orchestrator ${orchestratorUrl}`);
```

- [ ] **Step 3: Create `apps/bob-mcp/src/selftest.ts`**

```ts
/**
 * @file      apps/bob-mcp/src/selftest.ts
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   Launches the BUILT bundle exactly like Bob does (stdio), lists tools, asserts there is no approve tool,
 *            and calls devops_list_providers. Proves the MCP server works before involving Bob.
 * @depends   @modelcontextprotocol/sdk client
 * @usedBy    `pnpm --filter @bobops/bob-mcp selftest` (needs `pnpm build:mcp` and `pnpm dev:api` running)
 * @agentNotes Diagnostic tool only; not part of the bundle.
 */
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const bundle = fileURLToPath(new URL('../dist/bob-mcp.mjs', import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [bundle] });
const client = new Client({ name: 'bobops-selftest', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
if (tools.some((t) => /approv|decide/i.test(t.name))) throw new Error('SECURITY: an approve/decide tool must never exist');

const result = await client.callTool({ name: 'devops_list_providers', arguments: {} });
console.log(JSON.stringify(result.content, null, 2).slice(0, 2000));
await client.close();
```

- [ ] **Step 4:** `pnpm install; pnpm test; pnpm typecheck` → Expected: green (49 tests).
  If typecheck reports errors inside `registerTool`, run `pnpm --filter @bobops/bob-mcp add @modelcontextprotocol/sdk@1.17.5` and retry.

### Task 9.4 — Register the MCP server with Bob

- [ ] **Step 1: Build the bundle:** `pnpm build:mcp` → Expected: `dist\bob-mcp.mjs  …kb` and `Done`.

- [ ] **Step 2: Create `.bob/mcp.json`** (project-level MCP config that Bob reads automatically)

```json
{
  "mcpServers": {
    "bobops-orchestrator": {
      "command": "node",
      "args": ["C:/Users/Yash/Desktop/work/IBM-Bob/apps/bob-mcp/dist/bob-mcp.mjs"],
      "env": {
        "ORCHESTRATOR_URL": "http://localhost:4000",
        "CONTROL_CENTER_URL": "http://localhost:3000"
      },
      "timeout": 900,
      "alwaysAllow": [
        "devops_list_providers",
        "devops_list_runs",
        "devops_get_run",
        "devops_get_incident",
        "devops_get_logs",
        "devops_wait",
        "devops_log_note",
        "devops_sync_incidents"
      ],
      "disabled": false
    }
  }
}
```

> **Teammate note:** the `args` path is absolute. Each developer must replace it with their own clone path, using
> forward slashes. Only read-only tools are in `alwaysAllow`. Every state-changing tool still asks for Bob's per-tool
> confirmation, which adds a second human checkpoint.

- [ ] **Step 3 (HUMAN):** Terminal 1: `pnpm dev:api`. Terminal 2: `pnpm --filter @bobops/bob-mcp selftest`.
  Expected: `17 tools: devops_list_providers, devops_create_run, …` followed by the providers JSON.
- [ ] **Step 4 (HUMAN):** In IBM Bob, open **Settings → MCP Servers**, or click the MCP icon in the Bob panel. Expected:
  `bobops-orchestrator` appears (project scope) with a green status and 17 tools. If it's red, click restart. If it's still
  red, check that the `args` path exists.
- [ ] **Step 5 (HUMAN):** Start a new Bob task (Ask mode) and send:
  > Use the devops_list_providers tool and tell me which clouds are authenticated.

  Expected: Bob calls the tool without asking (it is in alwaysAllow) and reports IBM Cloud plus AWS as authenticated.

## HANDOFF

```text
✅ PHASE 09 COMPLETE — Bob ⇄ orchestrator MCP bridge
BUILT:
  - apps/bob-mcp: client (x-actor: bob, readable errors), compact run summary (+1 test), 17 tools, stdio server, selftest
  - .bob/mcp.json registering "bobops-orchestrator" (project scope, read-only tools auto-allowed)
DO THIS (human):
  1. pnpm test; pnpm typecheck; pnpm build:mcp
  2. terminal 1: pnpm dev:api   terminal 2: pnpm --filter @bobops/bob-mcp selftest
  3. Bob → MCP panel: bobops-orchestrator is green with 17 tools
  4. Bob (Ask mode): "Use the devops_list_providers tool and tell me which clouds are authenticated."
EXPECT:
  - selftest prints "17 tools: …" and provider JSON; no approve tool exists
  - Bob answers with IBM Cloud Code Engine + AWS Lambda, authenticated: true
IF IT FAILS:
  - MCP red in Bob → wrong absolute path in .bob/mcp.json, or bundle not built (pnpm build:mcp)
  - Tool error "Cannot reach the BobOps orchestrator" → pnpm dev:api is not running
  - After code changes Bob still sees old tools → pnpm build:mcp then restart the server in Bob's MCP panel
EVIDENCE:
  - Screenshot Bob's MCP panel showing bobops-orchestrator + tools → evidence/bob-task-summaries/phase-09-mcp-panel.png
  - Screenshot Bob's task summary → evidence/bob-task-summaries/phase-09-bob-mcp.png
  - git add -A; git commit -m "feat(p09): Bob MCP bridge"; git push
```
