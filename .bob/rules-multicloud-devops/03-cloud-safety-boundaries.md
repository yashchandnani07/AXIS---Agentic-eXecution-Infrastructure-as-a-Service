<!-- @file .bob/rules-multicloud-devops/03-cloud-safety-boundaries.md  @phase P10  @purpose What Bob may and may not touch. -->
# 03 — Cloud safety boundaries

**Allowed**
- Reading any repository file except `.env*` (the `.bobignore` file enforces this).
- Writing deployment assets inside the target app folder (Dockerfile, .dockerignore, .ceignore, src/lambda.ts), plus docs and evidence.
- Read-only terminal commands: `pnpm test`, `pnpm --filter <pkg> build`, `node -v`, `git status`, `git diff`.
- Every bobops-orchestrator MCP tool.

**Forbidden**
- Terminal commands that change cloud or GitHub state: `ibmcloud … create|update|delete|login`, any `aws …`, `gh … create|edit|close|delete`,
  `docker push`. The orchestrator does these after approval.
- Deleting resources of any kind. Rollback means moving to a previous revision, never deleting.
- Resource names that do not match `^bobops-[a-z0-9-]{3,40}$`. The orchestrator rejects them anyway.
- Putting secret values in a plan. Secret-looking keys (TOKEN/SECRET/PASSWORD/API_KEY/PRIVATE) go in `secretRefs` by name only.
- Using regions other than IBM `us-south` or AWS `us-east-1` unless the developer asks.

**Cost guardrails:** Code Engine `--cpu 0.25 --memory 0.5G --min-scale 1 --max-scale 2`; Lambda 256 MB, 10 s timeout.
Include `estimatedMonthlyCostUsd` in every plan (≈ 5 USD for the demo app).
