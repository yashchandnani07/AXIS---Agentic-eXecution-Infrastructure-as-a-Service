# BobOps audit trail — nimbus-books

- **Run:** `run_01f8d9e1bf` · **State:** healthy · **Targets:** aws
- **Objective:** Deploy Nimbus Books to AWS Lambda with verified health
- **Approved plan hash:** `48354a7322dc7a30b1bb8cecd5ac12303b7c21d8ea771122cc1e775ec05640d4`
- **Run created → verified healthy:** 8m 31s · **MTTR:** n/a · **Human approvals:** 1 · **Unsafe actions blocked:** 0

## Deployments
| Provider | App | Status | Endpoint | Revision | Note |
|---|---|---|---|---|---|
| aws | bobops-nimbus-books | succeeded | https://wubwqne4w23xawmxzjkpywz25a0mtktx.lambda-url.us-east-1.on.aws/ | 19 |  |

## Incidents
- none

## Timeline
| Time (UTC) | Actor | Kind | Event | Message |
|---|---|---|---|---|
| 13:41:30 | bob | action | run.created | Run created for nimbus-books (apps/demo-service): "Deploy Nimbus Books to AWS Lambda with verified health" → aws (sentinel check-in every 5 min) |
| 13:42:40 | bob | observation | analysis.recorded | Bob profiled nimbus-books: nodejs 22 / Hono, port 8080, health /health, required env [CATALOG_MODE, APP_VERSION] |
| 13:42:40 | bob | inference | specialist.finding | application-analyst: Hono v4 service on Node 22, port 8080, health at /health, ESM build output. CATALOG_MODE required; ADMIN_TOKEN optional but secret. |
| 13:42:40 | bob | inference | specialist.finding | cloud-architect: Recommends lambda (scale-to-zero) for AWS due to sporadic demo traffic, lightweight in-memory operations, and existing lambda.ts adapter. Estimated $0.20/month. |
| 13:42:40 | bob | inference | specialist.finding | security-reviewer: High-severity: weak x-admin-token header auth and ADMIN_TOKEN not in secret manager. Medium: hardcoded test secret 'admin-secret' in test fixtures, missing security headers, no rate limiting on admin endpoint. |
| 13:42:40 | bob | inference | specialist.finding | release-verifier: All deployment assets present (Dockerfile, .dockerignore, .ceignore, src/lambda.ts). Build and start scripts confirmed. Health endpoint present. No missing assets. |
| 13:43:31 | bob | proposal | plan.submitted | Bob proposed a plan for aws/lambda (3 risks, 0 generated assets) |
| 13:43:31 | orchestrator | proposal | approval.requested | Human approval required for the deployment plan (hash 48354a7322dc…, risk high) |
| 13:48:34 | human | action | approval.decided | developer approved the deployment plan |
| 13:49:48 | orchestrator | action | test.started | Running the pre-deploy test suite in apps/demo-service |
| 13:49:51 | orchestrator | verification | test.passed | Pre-deploy tests passed |
| 13:49:51 | provider:aws | action | deploy.started | Deploying bobops-nimbus-books to aws (lambda, us-east-1) |
| 13:49:51 | provider:aws | action | build.started | Bundling demo-service/src/lambda.ts with esbuild (ESM, node22) |
| 13:49:51 | provider:aws | action | build.completed | Lambda bundle ready (9.9 KiB zipped) |
| 13:49:51 | provider:aws | action | provision.started | Updating existing Lambda function bobops-nimbus-books in us-east-1 |
| 13:49:58 | provider:aws | action | provision.completed | Alias live → version 19 (lambda) |
| 13:49:58 | provider:aws | action | deploy.completed | aws is serving bobops-nimbus-books at https://wubwqne4w23xawmxzjkpywz25a0mtktx.lambda-url.us-east-1.on.aws/ (revision 19) |
| 13:50:00 | orchestrator | verification | verify.passed | aws healthy — HTTP 200 in 1965 ms (revision 1.0.0) |
| 13:50:01 | orchestrator | observation | orchestrator.warning | Could not arm the GitHub sentinel: Not Found - https://docs.github.com/rest/actions/variables#create-a-repository-variable |
| 13:50:12 | orchestrator | action | evidence.exported | Audit trail exported to evidence/demo-runs/run_01f8d9e1bf.md and evidence/demo-runs/run_01f8d9e1bf.json |
