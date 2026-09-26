<!-- @file .bob/rules-multicloud-devops/05-deploy-workflow.md  @phase P10  @purpose Exact MCP call sequence for /deploy. -->
# 05 — Deploy workflow (exact order)

Create a todo list with these items first: UNDERSTAND, PLAN, APPROVAL, TEST+PROVISION+BUILD+DEPLOY, VERIFY, EVIDENCE.

1. **OBSERVE providers:** `devops_list_providers`. If a requested target is `authenticated:false`, stop and tell the
   developer which provider is not connected (quote the note). Do not continue for that target.
2. **Create the run:** ask the developer, in one short question, how often they want the GitHub sentinel to check on this
   deployment once it is live (mention that 5, 15, 30 or 60 minutes are common choices, and it must be a multiple of 5).
   If they don't answer or say "don't know" / "default", use 5. Then call `devops_create_run` with `projectName`,
   `repoPath`, `objective`, `targets`, and `sentinelIntervalMinutes`. Share the `controlCenterUrl` with the developer and
   tell them this is where they will review and approve the plan.
3. **UNDERSTAND:** run the 4 parallel specialists (rule 04), synthesize, then call `devops_record_analysis`.
4. **Deployment assets:** check whether `<repoPath>/Dockerfile`, `.dockerignore`, `.ceignore` and `src/lambda.ts` exist.
   If any is missing, use the skill **deployment-asset-authoring** to create them, then show the developer the file list.
   Run `pnpm --filter <package name from package.json> build` to prove the app still builds (ACTION plus VERIFICATION).
5. **PLAN:** build ONE `DeploymentPlan` (shape reference only: `examplePlan()` in `packages/core/src/fixtures.ts`; derive
   the values from this run's analysis — NEVER copy the fixture's values without evidence, see rule 01):
   - one target per requested provider, using the SERVICE the cloud-architect specialist recommended in rule 04 (one of
     `code-engine` / `code-engine-scale-to-zero` for `ibm-cloud`, region `us-south`; one of `lambda` / `lambda-provisioned`
     for `aws`, region `us-east-1`)
   - `architectureRationale`: the cloud-architect's stated reason, rewritten as a full sentence citing the app profile —
     this field is REQUIRED and validated (≥ 20 characters); a generic sentence like "because it's cheaper" will be
     rejected by rule 01's evidence standard even if the schema accepts it — cite the actual traffic/latency reasoning
   - `appName`: `bobops-<project-name>` (for example `bobops-nimbus-books`)
   - `env`: every required non-secret variable with its correct value (for Nimbus Books: `CATALOG_MODE=featured`,
     `APP_VERSION=1.0.0`, `DEPLOY_PROVIDER=<provider>`)
   - `secretRefs`: secret names only (for example `ADMIN_TOKEN`)
   - `resources`, `risks` (from the specialists), `generatedAssets` (the files from step 4), `rollbackStrategy`,
     `approvalGates`, `estimatedMonthlyCostUsd`
   Call `devops_submit_plan`. If it returns validation issues, fix exactly those fields and resubmit. Tell the developer,
   in your summary, which architecture you chose per cloud AND why — this is the plan's headline decision, not a footnote.
6. **APPROVAL:** follow rule 02. Say: "Please review and approve in the Control Center: <approveAt>". Then call
   `devops_wait` with `until=plan_decided`, `timeoutSec=900`.
7. **EXECUTE:** `devops_execute_plan`. Tell the developer that tests run first, and that the Code Engine build takes 2–5 minutes
   while Lambda takes seconds.
8. **WAIT:** `devops_wait` with `until=deployed`, `timeoutSec=1200`.
9. **VERIFY:** if the state is `healthy`, report a VERIFICATION table: `Provider | Endpoint | HTTP | Latency | Revision`.
   If it is `failed`, call `devops_get_logs` for the failing provider, explain the evidence, and propose one fix. Do not
   redeploy without asking.
10. **EVIDENCE:** `devops_export_evidence`, then give the final summary `Stage | Result | Evidence`, including the Control Center URL.
