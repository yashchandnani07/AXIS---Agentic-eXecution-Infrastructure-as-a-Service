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
