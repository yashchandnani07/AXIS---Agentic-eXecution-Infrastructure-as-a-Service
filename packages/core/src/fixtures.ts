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
