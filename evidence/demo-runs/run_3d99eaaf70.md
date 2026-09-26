# BobOps audit trail — nimbus-books

- **Run:** `run_3d99eaaf70` · **State:** healthy · **Targets:** aws
- **Objective:** E2E: deploy to aws
- **Approved plan hash:** `7391c17c86acd38265757a2c09f0ae9c6fc0011fdea8bd3628da33e89bac2eff`
- **Run created → verified healthy:** 21s · **MTTR:** 9s · **Human approvals:** 2 · **Unsafe actions blocked:** 1

## Deployments
| Provider | App | Status | Endpoint | Revision | Note |
|---|---|---|---|---|---|
| aws | bobops-nimbus-books | succeeded | https://wubwqne4w23xawmxzjkpywz25a0mtktx.lambda-url.us-east-1.on.aws/ | 9 |  |
| aws | bobops-nimbus-books | succeeded | https://wubwqne4w23xawmxzjkpywz25a0mtktx.lambda-url.us-east-1.on.aws/ | 10 | fault injection: removed CATALOG_MODE |
| aws | bobops-nimbus-books | succeeded | https://wubwqne4w23xawmxzjkpywz25a0mtktx.lambda-url.us-east-1.on.aws/ | 11 | remediation rem_6ae926675c |

## Incidents
- **inc_c970842da6** (aws, via orchestrator) — resolved · root cause: CATALOG_MODE is missing from the running revision · remediation: Set CATALOG_MODE=featured (succeeded)

## Timeline
| Time (UTC) | Actor | Kind | Event | Message |
|---|---|---|---|---|
| 21:20:00 | human | action | run.created | Run created for nimbus-books (apps/demo-service): "E2E: deploy to aws" → aws (sentinel check-in every 5 min) |
| 21:20:00 | bob | observation | analysis.recorded | Bob profiled nimbus-books: node 22 / hono, port 8080, health /health, required env [CATALOG_MODE] |
| 21:20:00 | bob | inference | specialist.finding | application-analyst: Hono 4 HTTP API on Node 22 with a /health endpoint that validates required configuration |
| 21:20:00 | bob | inference | specialist.finding | cloud-architect: Container on IBM Cloud Code Engine (primary) and Lambda + Function URL on AWS (secondary) |
| 21:20:00 | bob | inference | specialist.finding | security-reviewer: ADMIN_TOKEN is a secret and must not appear in plain configuration |
| 21:20:00 | bob | inference | specialist.finding | release-verifier: Vitest suite covers health, catalog and admin routes; /health exposes revision for correlation |
| 21:20:00 | bob | proposal | plan.submitted | Bob proposed a plan for aws/lambda (2 risks, 4 generated assets) |
| 21:20:00 | orchestrator | proposal | approval.requested | Human approval required for the deployment plan (hash 7391c17c86ac…, risk medium) |
| 21:20:00 | orchestrator | verification | guard.blocked | Blocked deployment: no human-approved plan matches the current plan hash (run state: awaiting_approval) |
| 21:20:00 | human | action | approval.decided | e2e-script approved the deployment plan |
| 21:20:00 | orchestrator | action | test.started | Running the pre-deploy test suite in apps/demo-service |
| 21:20:03 | orchestrator | verification | test.passed | Pre-deploy tests passed |
| 21:20:03 | provider:aws | action | deploy.started | Deploying bobops-nimbus-books to aws (lambda, us-east-1) |
| 21:20:03 | provider:aws | action | build.started | Bundling demo-service/src/lambda.ts with esbuild (ESM, node22) |
| 21:20:03 | provider:aws | action | build.completed | Lambda bundle ready (9.9 KiB zipped) |
| 21:20:07 | provider:aws | action | provision.started | Updating existing Lambda function bobops-nimbus-books in us-east-1 |
| 21:20:18 | provider:aws | action | provision.completed | Alias live → version 9 (lambda) |
| 21:20:18 | provider:aws | action | deploy.completed | aws is serving bobops-nimbus-books at https://wubwqne4w23xawmxzjkpywz25a0mtktx.lambda-url.us-east-1.on.aws/ (revision 9) |
| 21:20:21 | orchestrator | verification | verify.passed | aws healthy — HTTP 200 in 2292 ms (revision 1.0.0) |
| 21:20:22 | orchestrator | observation | orchestrator.warning | Could not arm the GitHub sentinel: Not Found - https://docs.github.com/rest/actions/variables#create-a-repository-variable |
| 21:20:23 | provider:aws | action | provider.progress | Updating Lambda bobops-nimbus-books configuration (remove CATALOG_MODE) and publishing a new version |
| 21:20:27 | human | action | fault.injected | Controlled fault injected by the presenter: removed CATALOG_MODE from aws/bobops-nimbus-books (revision 10) |
| 21:20:36 | orchestrator | verification | verify.failed | aws UNHEALTHY — HTTP 503 at https://wubwqne4w23xawmxzjkpywz25a0mtktx.lambda-url.us-east-1.on.aws/health |
| 21:20:36 | orchestrator | observation | incident.opened | Incident inc_c970842da6 opened by the orchestrator: aws failed 1/1 probes |
| 21:20:36 | bob | inference | incident.diagnosed | Diagnosis (high confidence): CATALOG_MODE is missing from the running revision |
| 21:20:36 | bob | proposal | remediation.proposed | Bob proposes: Set CATALOG_MODE=featured (risk low) — Restore the approved configuration value |
| 21:20:36 | orchestrator | proposal | approval.requested | Human approval required for the remediation (hash 1bf66125647d…) |
| 21:20:36 | human | action | approval.decided | e2e-script approved the remediation |
| 21:20:36 | orchestrator | action | remediation.started | Executing approved remediation: Set CATALOG_MODE=featured on aws/bobops-nimbus-books |
| 21:20:37 | provider:aws | action | provider.progress | Updating Lambda bobops-nimbus-books configuration (set CATALOG_MODE) and publishing a new version |
| 21:20:42 | provider:aws | action | remediation.completed | aws change applied — new revision 11 |
| 21:20:46 | orchestrator | verification | verify.passed | aws healthy — HTTP 200 in 2691 ms (revision 1.0.0) |
| 21:20:46 | orchestrator | verification | incident.resolved | Recovered and re-verified: every endpoint is healthy. Time to recovery 9s |
