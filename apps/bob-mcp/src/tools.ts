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
    'ACTION (UNDERSTAND). Start a deployment run for a repository folder (path relative to the workspace root, e.g. apps/demo-service) and objective. Ask the developer how often they want the GitHub sentinel to check on this deployment after it goes live (5, 15, 30 or 60 minutes are good choices — it must be a multiple of 5) and pass it as sentinelIntervalMinutes; default to 5 if they have no preference. Returns runId and the Control Center URL to share with the developer.',
    {
      projectName: z.string().describe('short project name, e.g. nimbus-books'),
      repoPath: z.string().describe('folder relative to the workspace root'),
      objective: z.string().describe("the developer's deployment goal in one sentence"),
      targets: z.array(ProviderIdSchema).min(1),
      sentinelIntervalMinutes: z
        .number()
        .int()
        .min(5)
        .max(1440)
        .default(5)
        .describe('How often (in minutes, multiple of 5) the GitHub sentinel checks this deployment after it is live. Ask the developer; default 5.'),
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
