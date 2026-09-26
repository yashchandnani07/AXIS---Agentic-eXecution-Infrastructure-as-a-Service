<!--
@file     docs/plan/phase-01-monorepo-foundation.md
@purpose  Create the pnpm monorepo skeleton, agent guide, env template, git repo.
@owner    Orchestration & Cloud (O)
-->
# Phase 01 — Monorepo foundation (~30 min)

**Goal:** An empty but fully wired pnpm/TypeScript/Vitest monorepo on GitHub, with `AGENTS.md` (auto-loaded by Bob), the
`/run-phase` slash command, `.bobignore` and a documented `.env`.

**Depends on:** Phase 00.
**Creates:** root config files, `AGENTS.md`, `.bob/commands/run-phase.md`, `scripts/` workspace package, `evidence/` folders.

---

### Task 1.1 — Root configuration files

- [ ] **Step 1: Create `package.json`** (repo root)

```json
{
  "name": "bobops",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "pnpm --parallel --filter @bobops/orchestrator --filter @bobops/control-center run dev",
    "dev:api": "pnpm --filter @bobops/orchestrator run dev",
    "dev:ui": "pnpm --filter @bobops/control-center run dev",
    "typecheck": "pnpm -r --if-present run typecheck",
    "test": "vitest run --passWithNoTests",
    "build:mcp": "pnpm --filter @bobops/bob-mcp run build",
    "smoke:ibm": "pnpm --filter @bobops/scripts run smoke:ibm",
    "smoke:aws": "pnpm --filter @bobops/scripts run smoke:aws",
    "api:e2e": "pnpm --filter @bobops/scripts run api:e2e",
    "sentinel": "pnpm --filter @bobops/scripts run sentinel",
    "demo:reset": "pnpm --filter @bobops/scripts run demo:reset",
    "demo:golden": "pnpm --filter @bobops/scripts run demo:golden",
    "demo:fault": "pnpm --filter @bobops/scripts run demo:fault",
    "demo:replay": "pnpm --filter @bobops/scripts run demo:replay"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
# @file pnpm-workspace.yaml
# @phase P1
# @purpose Declares every workspace package. apps/* = runnable apps, packages/* = libraries, scripts = tooling package.
# @agentNotes Do not add new globs; new packages must live under apps/ or packages/.
packages:
  - apps/*
  - packages/*
  - scripts
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
/**
 * @file      vitest.config.ts
 * @phase     P1
 * @owner     Orchestration & Cloud
 * @purpose   Root Vitest config: one `pnpm test` runs every package's *.test.ts.
 * @depends   vitest
 * @usedBy    `pnpm test`, GitHub Actions validate.yml
 * @agentNotes Tests must never call real clouds or the network. Keep include globs in sync with the workspace layout.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```gitignore
# @file .gitignore  @phase P1  @purpose Keep secrets, build output and local state out of git.
node_modules/
dist/
.next/
out/
*.log
.DS_Store
.env
.env.*
!.env.example
**/.env.local
!**/.env.local.example
apps/orchestrator/.data/
sentinel-report.json
apps/control-center/public/replay/
infra/ibm-cloud/replay-site/site/
```

- [ ] **Step 6: Create `.bobignore`** (IBM Bob will not read these paths, so secrets never enter the model context)

```gitignore
# @file .bobignore  @phase P1
# @purpose Paths IBM Bob must never read: secrets, local state, generated/bulky files (saves Bobcoins too).
.env
.env.*
!.env.example
**/.env.local
apps/orchestrator/.data/
**/node_modules/
**/dist/
**/.next/
**/out/
pnpm-lock.yaml
```

- [ ] **Step 7: Create `.env.example`**

```dotenv
# @file .env.example  @phase P1
# @purpose Template for the root .env (copy to .env and fill). The orchestrator, scripts and smoke tests read .env.
# NEVER commit .env. NEVER paste its values into the Bob chat.

# ── Orchestrator ─────────────────────────────────────────────
ORCHESTRATOR_PORT=4000
CONTROL_CENTER_ORIGIN=http://localhost:3000
# Human approval token. The Control Center sends it; Bob/MCP never knows it. >= 8 chars.
APPROVAL_TOKEN=change-me-to-24-random-chars
# Enables POST /api/demo/fault (controlled fault injection). Keep true for the demo.
DEMO_MODE=true
DATA_DIR=.data

# ── IBM Cloud (Code Engine) ──────────────────────────────────
IBMCLOUD_API_KEY=
IBMCLOUD_REGION=us-south
IBMCLOUD_RESOURCE_GROUP=Default
IBM_CE_PROJECT=bobops-demo

# ── AWS (Lambda) ─────────────────────────────────────────────
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_LAMBDA_ROLE_ARN=

# ── GitHub (sentinel incidents + repo variables) ─────────────
# Tip: GITHUB_TOKEN = output of `gh auth token`
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=bobops

# ── Secrets injected into deployments (plan.secretRefs → SECRET_<NAME>) ──
SECRET_ADMIN_TOKEN=change-me-admin-token
```

### Task 1.2 — Agent guide and slash command

- [ ] **Step 1: Create `AGENTS.md`** (IBM Bob auto-loads this file in every mode)

```markdown
<!--
@file     AGENTS.md
@phase    P1
@purpose  Standing instructions for IBM Bob (and any coding agent) while BUILDING this repo.
@agentNotes Keep short. The deployment/runtime behaviour of Bob lives in .bob/rules-multicloud-devops/.
-->
# BobOps — Agent Guide

You are helping build **BobOps — Agentic Multi-Cloud DevOps Engineer** for the IBM Bob 2.0 Hackathon.

## Source of truth
- Product spec: `PRD.md`. Build plan: `docs/plan/00-MASTER-PLAN.md` + `docs/plan/phase-NN-*.md`.
- Execute **only** the phase the human asked for. Follow its steps in order. Print its HANDOFF block at the end.

## Stack
Node 22 · pnpm 9 workspaces · TypeScript ESM (run with `tsx`) · zod 3.25 (`import { z } from 'zod'`) · Hono 4 · Vitest 3 ·
Next.js 15 + Tailwind v4 · MCP SDK · execa · AWS SDK v3 · Octokit.

## Commands
- `pnpm install` · `pnpm test` · `pnpm typecheck`
- `pnpm dev:api` (orchestrator :4000) · `pnpm dev:ui` (control center :3000)
- Shell is **Windows PowerShell**: use `curl.exe` or `Invoke-RestMethod`, `;` to chain, `Copy-Item`, `Remove-Item`.

## Non-negotiable rules
1. Every new source file starts with the context header defined in `docs/plan/00-MASTER-PLAN.md` §9.1.
2. Domain shapes come from `@bobops/core` schemas. Never redeclare them.
3. Do not add dependencies that the phase file does not list. Do not rename files, functions or exports.
4. Never read or print `.env*` files. Never put secrets in code, tests, logs or chat.
5. Never run cloud-mutating CLI commands (`ibmcloud … create/update/delete`, `aws …`) unless the phase file explicitly
   tells the HUMAN to run them. Smoke scripts are run by the human.
6. In `apps/bob-mcp`, never write to stdout (`console.log`). It is the MCP protocol channel. Use `console.error`.
7. After writing code, run the phase's verification commands. If one fails 3 times, stop and report instead of guessing.
```

- [ ] **Step 2: Create `.bob/commands/run-phase.md`**

```markdown
---
description: Execute exactly one phase of the BobOps implementation plan
argument-hint: <two-digit phase number, e.g. 04>
---
<!-- @file .bob/commands/run-phase.md  @phase P1  @purpose Slash command that runs one plan phase with discipline. -->
Execute exactly ONE phase of the BobOps implementation plan. The phase number is the argument given with this command.

1. Read ONLY sections 6 (Global Constraints), 8 (Contracts cheat-sheet) and 9 (Conventions) of `docs/plan/00-MASTER-PLAN.md`.
2. Open the one file in `docs/plan/` whose name starts with `phase-<NN>-` and follow it exactly, in order.
3. Keep a todo list that mirrors the phase's tasks and tick items as you complete them.
4. Create files with EXACTLY the content given, including the header comments. Do not "improve", rename, or add dependencies.
5. Run every verification command in the phase. Fix failures (max 3 attempts each), then stop and report if still failing.
6. Do NOT execute steps marked "(HUMAN)". List them in the HANDOFF block instead.
7. Finish by printing the phase's HANDOFF block with real values filled in. Never start the next phase.
```

### Task 1.3 — `scripts` workspace package (tooling home)

- [ ] **Step 1: Create `scripts/package.json`** (later phases replace this file with a longer version)

```json
{
  "name": "@bobops/scripts",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "dotenv": "^16.4.7"
  }
}
```

- [ ] **Step 2: Create `scripts/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `scripts/lib/env.ts`**

```ts
/**
 * @file      scripts/lib/env.ts
 * @phase     P1
 * @owner     Orchestration & Cloud
 * @purpose   Shared helpers for every script: loads the ROOT .env and exposes REPO_ROOT + tiny CLI helpers.
 * @depends   dotenv
 * @usedBy    scripts/smoke/*, scripts/demo/*, scripts/sentinel/*, scripts/ci/*
 * @agentNotes Import this module FIRST in every script (`import { REPO_ROOT } from '../lib/env';`).
 *             In GitHub Actions there is no .env — dotenv silently does nothing and real env vars are used.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
config({ path: path.join(REPO_ROOT, '.env') });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to the root .env (see .env.example).`);
  return value;
}

/** Returns the value after a CLI flag, e.g. arg('--run') for `--run run_123`. */
export function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
```

### Task 1.4 — Evidence folders and README stub

- [ ] **Step 1:** Create empty files `evidence/bob-task-summaries/.gitkeep` and `evidence/demo-runs/.gitkeep`.
- [ ] **Step 2:** Create `README.md` containing just:

```markdown
# BobOps — Agentic Multi-Cloud DevOps Engineer
IBM Bob 2.0 Hackathon entry. Full README arrives in Phase 14. Plan: `docs/plan/00-MASTER-PLAN.md`.
```

### Task 1.5 — Install, verify, create the GitHub repo

- [ ] **Step 1: Install**
  ```powershell
  pnpm install
  ```
  Expected: `Done in …`, and `pnpm-lock.yaml` is created.
- [ ] **Step 2: Typecheck and test**
  ```powershell
  pnpm typecheck; pnpm test
  ```
  Expected: typecheck prints `scripts typecheck$ tsc --noEmit -p tsconfig.json` with no errors, and vitest prints
  `No test files found, exiting with code 0`.
- [ ] **Step 3 (HUMAN): Create `.env`**
  ```powershell
  Copy-Item .env.example .env
  notepad .env
  ```
  Fill in `APPROVAL_TOKEN`, `SECRET_ADMIN_TOKEN`, `IBMCLOUD_API_KEY` and `GITHUB_OWNER` (your GitHub username). The AWS values
  come in Phase 7 and `GITHUB_TOKEN` in Phase 12.
- [ ] **Step 4 (HUMAN): git + GitHub**
  ```powershell
  git init -b main
  git add -A
  git commit -m "feat(p01): monorepo foundation"
  gh repo create bobops --public --source . --remote origin --push
  ```
  Expected: the repo URL `https://github.com/<you>/bobops` prints. **Check that `.env` is NOT in the commit** (`git show --stat`).

## HANDOFF

```text
✅ PHASE 01 COMPLETE — Monorepo foundation
BUILT:
  - package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.config.ts, .gitignore, .bobignore, .env.example
  - AGENTS.md (auto-loaded by Bob), .bob/commands/run-phase.md (/run-phase NN)
  - scripts/ workspace package with lib/env.ts; evidence/ folders
DO THIS (human):
  1. pnpm install; pnpm typecheck; pnpm test
  2. Copy-Item .env.example .env  → fill APPROVAL_TOKEN, SECRET_ADMIN_TOKEN, IBMCLOUD_API_KEY, GITHUB_OWNER
  3. git init -b main; git add -A; git commit -m "feat(p01): monorepo foundation"; gh repo create bobops --public --source . --remote origin --push
  4. In Bob, type "/" and confirm "run-phase" appears in the command menu.
EXPECT:
  - Install OK, typecheck OK, "No test files found, exiting with code 0"
  - Public GitHub repo exists; `git show --stat` does NOT list .env
IF IT FAILS:
  - "packageManager" mismatch → corepack prepare pnpm@9.15.0 --activate
  - /run-phase missing → reload Bob window (Command Palette → "Developer: Reload Window")
EVIDENCE:
  - Screenshot Bob's task summary → evidence/bob-task-summaries/phase-01-foundation.png
  - git add -A; git commit -m "feat(p01): foundation evidence"; git push
```
