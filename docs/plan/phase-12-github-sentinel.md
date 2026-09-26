<!--
@file     docs/plan/phase-12-github-sentinel.md
@purpose  GitHub integration: Octokit client, the */5 health sentinel (issues with JSON evidence), incident sync, CI workflows.
@owner    Product & Experience (P)
-->
# Phase 12 — GitHub: health sentinel, incident sync, CI/CD (~90 min)

**Goal:** Add independent, cross-cloud verification (PRD §9). A GitHub Actions workflow runs every 5 minutes, and can also
be dispatched for the demo. It probes every deployed endpoint 3 times and, after **3 consecutive failures**, opens a
GitHub issue that carries a machine-readable JSON evidence block. The orchestrator imports those issues as incidents
(every 60 s, or on demand) and, after a verified recovery, **comments on and closes** the issue. The phase also adds
`validate.yml` (CI) and an optional approval-gated `deploy.yml`.

**Depends on:** Phase 05 (lifecycle) and Phase 08 (real deployments to probe).
**Interfaces produced:** `GitHubClient`, `githubConfigFromEnv()` and `SentinelIssue` from `@bobops/github`;
`createGitHubPort(config)` in the orchestrator; `Deps.github`.

**Why issues?** A GitHub runner cannot reach an orchestrator running on a laptop. Issues are durable, visible to judges,
linkable, and free. The sentinel does **not** pretend to invoke Bob. Bob consumes the evidence interactively (`/investigate`).

---

### Task 12.1 — `packages/github`

- [ ] **Step 1: Create `packages/github/package.json`**

```json
{
  "name": "@bobops/github",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": {
    "@bobops/core": "workspace:*",
    "@octokit/rest": "^21.1.1"
  }
}
```

- [ ] **Step 2: Create `packages/github/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `packages/github/src/client.ts`**

```ts
/**
 * @file      packages/github/src/client.ts
 * @phase     P12
 * @owner     Product & Experience
 * @purpose   Octokit wrapper for the sentinel + orchestrator: incident issues (create/find/comment/close/list), the
 *            sentinel-incident label, and the SENTINEL_TARGETS repository variable.
 * @depends   @octokit/rest, @bobops/core (sentinel format)
 * @usedBy    scripts/sentinel/run-sentinel.ts (GitHub Actions), apps/orchestrator/src/github.ts (GitHubPort)
 * @agentNotes Issue bodies are rendered/parsed ONLY via core renderIssueBody/parseIssueBody (cross-process contract).
 */
import { Octokit } from '@octokit/rest';
import {
  SENTINEL_LABEL,
  parseIssueBody,
  renderIssueBody,
  type SentinelIncidentPayload,
  type SentinelTarget,
} from '@bobops/core';

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
}

export interface SentinelIssue {
  issueNumber: number;
  url: string;
  title: string;
  payload: SentinelIncidentPayload;
}

/** Reads GITHUB_TOKEN + GITHUB_OWNER/GITHUB_REPO, falling back to GITHUB_REPOSITORY ("owner/repo", set by Actions). */
export function githubConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GitHubConfig | null {
  const token = env.GITHUB_TOKEN;
  let owner = env.GITHUB_OWNER;
  let repo = env.GITHUB_REPO;
  if ((!owner || !repo) && env.GITHUB_REPOSITORY) [owner, repo] = env.GITHUB_REPOSITORY.split('/');
  return token && owner && repo ? { token, owner, repo } : null;
}

export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(private readonly cfg: GitHubConfig) {
    this.octokit = new Octokit({ auth: cfg.token, userAgent: 'bobops/1.0' });
  }

  private get repo() {
    return { owner: this.cfg.owner, repo: this.cfg.repo };
  }

  async ensureLabel(): Promise<void> {
    try {
      await this.octokit.rest.issues.getLabel({ ...this.repo, name: SENTINEL_LABEL });
    } catch {
      await this.octokit.rest.issues.createLabel({
        ...this.repo,
        name: SENTINEL_LABEL,
        color: 'da1e28',
        description: 'Opened by the BobOps health sentinel',
      });
    }
  }

  private async openSentinelIssues() {
    const { data } = await this.octokit.rest.issues.listForRepo({ ...this.repo, state: 'open', labels: SENTINEL_LABEL, per_page: 50 });
    return data.filter((issue) => !issue.pull_request);
  }

  async listOpenSentinelIncidents(): Promise<SentinelIssue[]> {
    const result: SentinelIssue[] = [];
    for (const issue of await this.openSentinelIssues()) {
      const payload = parseIssueBody(issue.body ?? '');
      if (payload) result.push({ issueNumber: issue.number, url: issue.html_url, title: issue.title, payload });
    }
    return result;
  }

  async findOpenIssueByTitle(title: string): Promise<{ number: number; url: string } | null> {
    const match = (await this.openSentinelIssues()).find((issue) => issue.title === title);
    return match ? { number: match.number, url: match.html_url } : null;
  }

  async openIncidentIssue(title: string, payload: SentinelIncidentPayload): Promise<{ number: number; url: string }> {
    await this.ensureLabel();
    const { data } = await this.octokit.rest.issues.create({ ...this.repo, title, body: renderIssueBody(payload), labels: [SENTINEL_LABEL] });
    return { number: data.number, url: data.html_url };
  }

  async comment(issueNumber: number, body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({ ...this.repo, issue_number: issueNumber, body });
  }

  async commentAndCloseIncident(issueNumber: number, body: string): Promise<void> {
    await this.comment(issueNumber, body);
    await this.octokit.rest.issues.update({ ...this.repo, issue_number: issueNumber, state: 'closed', state_reason: 'completed' });
  }

  async publishSentinelTargets(targets: SentinelTarget[]): Promise<void> {
    const value = JSON.stringify(targets);
    try {
      await this.octokit.rest.actions.updateRepoVariable({ ...this.repo, name: 'SENTINEL_TARGETS', value });
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
      await this.octokit.rest.actions.createRepoVariable({ ...this.repo, name: 'SENTINEL_TARGETS', value });
    }
  }
}
```

- [ ] **Step 4: Create `packages/github/src/index.ts`**

```ts
/**
 * @file      packages/github/src/index.ts
 * @phase     P12
 * @owner     Product & Experience
 * @purpose   Public API of @bobops/github.
 * @depends   ./client
 * @usedBy    orchestrator, scripts
 * @agentNotes —
 */
export { GitHubClient, githubConfigFromEnv, type GitHubConfig, type SentinelIssue } from './client';
```

- [ ] **Step 5:** `pnpm install`

### Task 12.2 — Orchestrator: GitHub port + periodic incident sync

- [ ] **Step 1: Replace `apps/orchestrator/package.json`**

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
    "@bobops/github": "workspace:*",
    "@bobops/provider-aws": "workspace:*",
    "@bobops/provider-ibm-cloud": "workspace:*",
    "@hono/node-server": "^1.13.7",
    "dotenv": "^16.4.7",
    "execa": "^9.5.2",
    "hono": "^4.7.0",
    "zod": "^3.25.0"
  }
}
```

- [ ] **Step 2: Create `apps/orchestrator/src/github.ts`**

```ts
/**
 * @file      apps/orchestrator/src/github.ts
 * @phase     P12
 * @owner     Orchestration & Cloud
 * @purpose   Builds the GitHubPort from config (null when GitHub is not configured — the lifecycle still works).
 * @depends   @bobops/github, ./config, ./ports
 * @usedBy    deps.ts
 * @agentNotes GITHUB_TOKEN needs issues:write + variables:write on the repo (`gh auth token` works for your own repo).
 */
import { GitHubClient } from '@bobops/github';
import type { Config } from './config';
import type { GitHubPort } from './ports';

export function createGitHubPort(config: Config): GitHubPort | null {
  if (!config.GITHUB_TOKEN || !config.GITHUB_OWNER || !config.GITHUB_REPO) return null;
  return new GitHubClient({ token: config.GITHUB_TOKEN, owner: config.GITHUB_OWNER, repo: config.GITHUB_REPO });
}
```

- [ ] **Step 3: Replace `apps/orchestrator/src/deps.ts`**

```ts
/**
 * @file      apps/orchestrator/src/deps.ts
 * @phase     P4 (replaced in P5, P8, P12 — final)
 * @owner     Orchestration & Cloud
 * @purpose   Composition root: builds every service once and wires them together. Tests pass overrides (fakes).
 * @depends   @bobops/core, ./config, ./store, ./events, ./services, ./ports, ./providers/registry, ./github
 * @usedBy    src/index.ts, src/app.ts, tests
 * @agentNotes Add new services HERE, never `new` them inside routes. Tests MUST pass `providers` fakes and `github: null`.
 */
import { probeHealth, type CloudProvider, type ProbeFn, type ProviderId } from '@bobops/core';
import type { Config } from './config';
import { EventBus } from './events/event-bus';
import { createGitHubPort } from './github';
import type { GitHubPort } from './ports';
import { buildProviders } from './providers/registry';
import { LifecycleService } from './services/lifecycle-service';
import { RunService } from './services/run-service';
import { runPackageTests, type TestResult } from './services/test-runner';
import { JsonStore } from './store/json-store';

export interface Deps {
  config: Config;
  store: JsonStore;
  bus: EventBus;
  runs: RunService;
  lifecycle: LifecycleService;
  providers: Map<ProviderId, CloudProvider>;
  github: GitHubPort | null;
}

export interface DepOverrides {
  providers?: Map<ProviderId, CloudProvider>;
  probe?: ProbeFn;
  runTests?: (sourceDir: string) => Promise<TestResult>;
  github?: GitHubPort | null;
  retryDelayMs?: number;
}

export function createDeps(config: Config, o: DepOverrides = {}): Deps {
  const store = new JsonStore(config.dataFile);
  const bus = new EventBus(store);
  const runs = new RunService(store, bus, config.repoRoot);
  const providers = o.providers ?? buildProviders(config);
  const github = o.github !== undefined ? o.github : createGitHubPort(config);
  const lifecycle = new LifecycleService({
    store,
    bus,
    runs,
    providers,
    probe: o.probe ?? probeHealth,
    runTests: o.runTests ?? runPackageTests,
    repoRoot: config.repoRoot,
    resolveSecret: (name) => config.secrets[name],
    github,
    retryDelayMs: o.retryDelayMs ?? 5000,
    demoMode: config.demoMode,
  });
  return { config, store, bus, runs, lifecycle, providers, github };
}
```

- [ ] **Step 4: Replace `apps/orchestrator/src/index.ts`**

```ts
/**
 * @file      apps/orchestrator/src/index.ts
 * @phase     P4 (replaced in P12 — final)
 * @owner     Orchestration & Cloud
 * @purpose   Process entry: load root .env, validate config, build deps, start HTTP server, sync sentinel incidents every 60 s.
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
  console.log(deps.github ? `GitHub sentinel sync: ON (${config.GITHUB_OWNER}/${config.GITHUB_REPO}, every 60 s)` : 'GitHub sentinel sync: OFF (set GITHUB_* in .env)');
});

if (deps.github) {
  setInterval(() => {
    deps.lifecycle
      .syncIncidents()
      .then((r) => {
        if (r.imported) console.log(`[sentinel-sync] imported ${r.imported} incident(s)`);
      })
      .catch((err: unknown) => console.error('[sentinel-sync]', err instanceof Error ? err.message : err));
  }, 60_000);
}
```

- [ ] **Step 5:** `pnpm install; pnpm test; pnpm typecheck` → Expected: green.

### Task 12.3 — The sentinel script

- [ ] **Step 1: Create `scripts/sentinel/run-sentinel.ts`**

```ts
/**
 * @file      scripts/sentinel/run-sentinel.ts
 * @phase     P12
 * @owner     Product & Experience
 * @purpose   Independent cross-cloud health sentinel. The workflow's cron always fires every 5 minutes (GitHub's fastest
 *            schedule), but each target is only ACTUALLY PROBED when shouldProbeNow() says its user-chosen
 *            intervalMinutes has elapsed — so "check every 15/30/60 minutes" is a real, user-set cadence, not a fixed 5.
 *            For targets that are due: probes N times; after THRESHOLD consecutive failures opens (or comments on) a
 *            GitHub issue with JSON evidence. Always writes sentinel-report.json and a job summary. Exit code 1 only
 *            when an incident exists (red run = visible); a quiet or skipped tick exits 0.
 * @depends   ../lib/env, @bobops/core (probe + sentinel format), @bobops/github, zod
 * @usedBy    .github/workflows/health-sentinel.yml, `pnpm sentinel` (local dry run)
 * @agentNotes Never close issues here — only the orchestrator closes them after a VERIFIED recovery. shouldProbeNow()
 *             needs no external state — every runner agrees on the same wall-clock tick (see packages/core/src/sentinel.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/env';
import { z } from 'zod';
import {
  SentinelTargetSchema,
  consecutiveFailures,
  incidentTitle,
  probeHealth,
  renderStepSummary,
  shouldProbeNow,
  type HealthCheck,
  type SentinelIncidentPayload,
  type SentinelResult,
  type SentinelTarget,
} from '@bobops/core';
import { GitHubClient, githubConfigFromEnv } from '@bobops/github';

const ATTEMPTS = Number(process.env.SENTINEL_ATTEMPTS ?? 3);
const GAP_MS = Number(process.env.SENTINEL_GAP_MS ?? 10_000);
const THRESHOLD = Number(process.env.SENTINEL_THRESHOLD ?? ATTEMPTS);
const REPORT = process.env.SENTINEL_REPORT_PATH ?? path.join(REPO_ROOT, 'sentinel-report.json');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadTargets(): SentinelTarget[] {
  const fallback = path.join(REPO_ROOT, 'ops', 'sentinel-targets.json');
  const raw = process.env.SENTINEL_TARGETS?.trim() || (fs.existsSync(fallback) ? fs.readFileSync(fallback, 'utf8') : '[]');
  return z.array(SentinelTargetSchema).parse(JSON.parse(raw));
}

async function probeTarget(target: SentinelTarget, gh: GitHubClient | null): Promise<SentinelResult> {
  const probes: HealthCheck[] = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    const probe = await probeHealth({ provider: target.provider, endpoint: target.endpoint, healthPath: target.healthPath, timeoutMs: 10_000 });
    probes.push({ ...probe, runId: target.runId });
    console.log(`[${target.provider}] attempt ${i + 1}/${ATTEMPTS}: ${probe.ok ? 'OK' : 'FAIL'} ${probe.statusCode} ${probe.latencyMs}ms`);
    if (i < ATTEMPTS - 1) await sleep(GAP_MS);
  }
  const streak = consecutiveFailures(probes);
  const incident = streak >= THRESHOLD;
  let issueUrl: string | undefined;
  if (incident && gh) {
    const payload: SentinelIncidentPayload = {
      version: 1,
      runId: target.runId,
      provider: target.provider,
      appName: target.appName,
      endpoint: target.endpoint,
      threshold: THRESHOLD,
      consecutiveFailures: streak,
      probes,
      detectedAt: new Date().toISOString(),
      workflowRunUrl: process.env.WORKFLOW_RUN_URL,
      commitSha: process.env.GITHUB_SHA,
    };
    const title = incidentTitle(target);
    const existing = await gh.findOpenIssueByTitle(title);
    if (existing) {
      await gh.comment(existing.number, `Still failing at ${payload.detectedAt} (${streak} consecutive failures). ${payload.workflowRunUrl ?? ''}`);
      issueUrl = existing.url;
    } else {
      issueUrl = (await gh.openIncidentIssue(title, payload)).url;
    }
    console.log(`🚨 incident for ${target.provider}/${target.appName}: ${issueUrl}`);
  }
  return { target, probes, incident, issueUrl };
}

async function main() {
  const targets = loadTargets();
  if (!targets.length) {
    console.log('No sentinel targets (repo variable SENTINEL_TARGETS is empty). The orchestrator sets it after a healthy deploy.');
    return;
  }
  const ghConfig = githubConfigFromEnv();
  const gh = ghConfig ? new GitHubClient(ghConfig) : null;
  const now = new Date();
  const results: SentinelResult[] = [];

  for (const target of targets) {
    if (!shouldProbeNow(target, now)) {
      console.log(`[${target.provider}/${target.appName}] not due yet (checks in every ${target.intervalMinutes} min) — skipping this tick`);
      results.push({ target, probes: [], incident: false, skipped: true });
      continue;
    }
    results.push(await probeTarget(target, gh));
  }

  fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: now.toISOString(), threshold: THRESHOLD, results }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderStepSummary(results));
  if (results.some((r) => r.incident)) {
    console.error('Sentinel detected at least one incident.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
```

- [ ] **Step 2: Replace `scripts/package.json`**

```json
{
  "name": "@bobops/scripts",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "demo:golden": "tsx demo/golden.ts",
    "demo:reset": "tsx demo/reset.ts",
    "demo:fault": "tsx demo/inject-fault.ts",
    "api:e2e": "tsx demo/api-e2e.ts",
    "smoke:ibm": "tsx smoke/deploy-ibm.ts",
    "smoke:aws": "tsx smoke/deploy-aws.ts",
    "sentinel": "tsx sentinel/run-sentinel.ts",
    "deploy:ci": "tsx ci/deploy.ts"
  },
  "dependencies": {
    "@bobops/core": "workspace:*",
    "@bobops/github": "workspace:*",
    "@bobops/provider-aws": "workspace:*",
    "@bobops/provider-ibm-cloud": "workspace:*",
    "dotenv": "^16.4.7",
    "zod": "^3.25.0"
  }
}
```

### Task 12.4 — Workflows

- [ ] **Step 1: Create `.github/workflows/validate.yml`**

```yaml
# @file      .github/workflows/validate.yml
# @phase     P12
# @owner     Product & Experience
# @purpose   CI validation on every push/PR: install, typecheck, unit tests (incl. the full fake-cloud lifecycle), builds.
# @agentNotes Must stay green — judges look at the Actions tab.
name: validate
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm --filter @bobops/demo-service build
      - run: pnpm build:mcp
      - run: pnpm --filter @bobops/control-center build
```

- [ ] **Step 2: Create `.github/workflows/health-sentinel.yml`**

```yaml
# @file      .github/workflows/health-sentinel.yml
# @phase     P12
# @owner     Product & Experience
# @purpose   Independent cross-cloud health sentinel. This cron is GitHub's FASTEST possible schedule (every 5 min) —
#            it is a floor, not the user's chosen cadence. Each run's actual check-in interval (5/15/30/60 min, chosen
#            by the user when Bob created the run) is honored by run-sentinel.ts's shouldProbeNow(), which skips a
#            target's probe on ticks that don't land on its interval. Opens GitHub issues with JSON evidence after 3
#            consecutive failures on a tick where the target WAS due; the orchestrator imports them as incidents.
# @agentNotes Scheduled runs can be delayed by GitHub — that's why the demo uses workflow_dispatch and why this is NOT the
#             only health mechanism (orchestrator verify + provider-native status are first line). Disable after the event:
#             gh workflow disable health-sentinel.yml
name: health-sentinel
on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:
    inputs:
      attempts:
        description: Probe attempts per target (incident threshold = attempts)
        required: false
        default: '3'
permissions:
  contents: read
  issues: write
concurrency:
  group: health-sentinel
  cancel-in-progress: false
jobs:
  probe:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Probe every deployed endpoint
        env:
          SENTINEL_TARGETS: ${{ vars.SENTINEL_TARGETS }}
          SENTINEL_ATTEMPTS: ${{ inputs.attempts || '3' }}
          SENTINEL_REPORT_PATH: ${{ github.workspace }}/sentinel-report.json
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          WORKFLOW_RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: pnpm sentinel
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: sentinel-report-${{ github.run_id }}
          path: sentinel-report.json
          if-no-files-found: ignore
```

- [ ] **Step 3 (COULD tier): Create `.github/workflows/deploy.yml`**

```yaml
# @file      .github/workflows/deploy.yml
# @phase     P12 (COULD)
# @owner     Product & Experience
# @purpose   Approval-gated CI deployment of the demo app to one provider. The "production" GitHub Environment must have
#            Required reviewers configured → a second, GitHub-native human approval gate.
# @agentNotes Requires the generated assets (Dockerfile, src/lambda.ts) to be committed, plus repo secrets
#             IBMCLOUD_API_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SECRET_ADMIN_TOKEN and variable AWS_LAMBDA_ROLE_ARN.
name: deploy
on:
  workflow_dispatch:
    inputs:
      provider:
        description: Target cloud
        type: choice
        options: [ibm-cloud, aws]
        required: true
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Install IBM Cloud CLI + Code Engine plugin
        if: inputs.provider == 'ibm-cloud'
        run: |
          curl -fsSL https://clis.cloud.ibm.com/install/linux | sh
          ibmcloud plugin install code-engine -f
      - name: Deploy and verify
        env:
          DEPLOY_PROVIDER: ${{ inputs.provider }}
          IBMCLOUD_API_KEY: ${{ secrets.IBMCLOUD_API_KEY }}
          IBMCLOUD_REGION: us-south
          IBMCLOUD_RESOURCE_GROUP: Default
          IBM_CE_PROJECT: bobops-demo
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_REGION: us-east-1
          AWS_LAMBDA_ROLE_ARN: ${{ vars.AWS_LAMBDA_ROLE_ARN }}
          SECRET_ADMIN_TOKEN: ${{ secrets.SECRET_ADMIN_TOKEN }}
        run: pnpm --filter @bobops/scripts run deploy:ci
```

- [ ] **Step 4 (COULD tier): Create `scripts/ci/deploy.ts`**

```ts
/**
 * @file      scripts/ci/deploy.ts
 * @phase     P12 (COULD)
 * @owner     Product & Experience
 * @purpose   CI deployment entry for deploy.yml: deploys the demo app to ONE provider through the same adapter the
 *            orchestrator uses, then verifies /health (non-zero exit if unhealthy).
 * @depends   ../lib/env, @bobops/core, @bobops/provider-ibm-cloud, @bobops/provider-aws
 * @usedBy    .github/workflows/deploy.yml
 * @agentNotes V1 uses the reference plan (examplePlan). V2: consume the orchestrator-approved plan exported with the run.
 */
import path from 'node:path';
import { REPO_ROOT, requireEnv } from '../lib/env';
import { ProviderIdSchema, examplePlan, probeHealth, type CloudProvider } from '@bobops/core';
import { AwsLambdaProvider } from '@bobops/provider-aws';
import { IbmCloudProvider } from '@bobops/provider-ibm-cloud';

const providerId = ProviderIdSchema.parse(process.env.DEPLOY_PROVIDER);
const target = examplePlan([providerId]).targets[0]!;
const provider: CloudProvider =
  providerId === 'ibm-cloud'
    ? new IbmCloudProvider({
        apiKey: requireEnv('IBMCLOUD_API_KEY'),
        region: process.env.IBMCLOUD_REGION ?? 'us-south',
        resourceGroup: process.env.IBMCLOUD_RESOURCE_GROUP ?? 'Default',
        project: process.env.IBM_CE_PROJECT ?? 'bobops-demo',
      })
    : new AwsLambdaProvider({ region: process.env.AWS_REGION ?? 'us-east-1', roleArn: requireEnv('AWS_LAMBDA_ROLE_ARN') });

const adminToken = process.env.SECRET_ADMIN_TOKEN;
const result = await provider.deploy(
  {
    runId: `ci-${process.env.GITHUB_RUN_ID ?? 'local'}`,
    target: { ...target, env: { ...target.env, APP_VERSION: process.env.GITHUB_SHA?.slice(0, 7) ?? target.env.APP_VERSION ?? 'ci' } },
    sourceDir: path.join(REPO_ROOT, 'apps', 'demo-service'),
    secrets: adminToken ? { ADMIN_TOKEN: adminToken } : {},
  },
  (e) => console.log(`[${e.type}] ${e.message}`),
);
await new Promise((r) => setTimeout(r, 5000));
const check = await probeHealth({ provider: providerId, endpoint: result.endpoint, healthPath: target.healthPath });
console.log(JSON.stringify({ endpoint: result.endpoint, revision: result.revision, health: { ok: check.ok, statusCode: check.statusCode } }, null, 2));
if (!check.ok) process.exit(1);
```

- [ ] **Step 5:** `pnpm install; pnpm typecheck; pnpm test` → Expected: green. Then commit and push. Expected: the
  **validate** workflow run is green on GitHub (`gh run list --workflow validate.yml`).

### Task 12.5 — Live sentinel test (HUMAN, ~10 min)

- [ ] **Step 1:** Fill in `.env`: `GITHUB_TOKEN=<output of gh auth token>`, `GITHUB_OWNER=<you>`, `GITHUB_REPO=bobops`.
- [ ] **Step 2:** `pnpm demo:golden`, then `pnpm dev:api`. Expected log: `GitHub sentinel sync: ON (...)`.
- [ ] **Step 3:** `pnpm api:e2e --targets aws`. Expected: the run is healthy, and its audit trail contains `sentinel.armed`.
  `gh variable list` shows `SENTINEL_TARGETS`.
- [ ] **Step 3b (verify the user-defined interval is honored, not just the default):** Create a second run with a
  30-minute cadence directly against the API:
  ```powershell
  Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/runs -ContentType 'application/json' -Body '{"projectName":"nimbus-books","repoPath":"apps/demo-service","objective":"interval test","targets":["aws"],"sentinelIntervalMinutes":30}'
  ```
  Deploy it the same way as Step 3 (analysis → plan → approve → execute for that run id), then `gh variable get SENTINEL_TARGETS`
  and confirm the new target's `intervalMinutes` is `30`. Run `gh workflow run health-sentinel.yml; gh run watch` at a
  moment that is NOT a multiple of 30 minutes past the hour — expect that target's row in the job summary to read
  `⏭️ not due (every 30m)` while the first (5-minute) run still shows `✅ healthy`. This proves the fixed 5-minute cron
  correctly samples down to a slower, user-chosen cadence with no extra state.
- [ ] **Step 4:** `gh workflow run health-sentinel.yml`, then `gh run watch`. Expected: a green run whose job summary shows
  `✅ healthy`.
- [ ] **Step 5:** `pnpm demo:fault --provider aws`, then `gh workflow run health-sentinel.yml` and `gh run watch`.
  Expected: a **red** run (exit 1), and `gh issue list --label sentinel-incident` shows
  `[sentinel] aws/bobops-nimbus-books is failing health checks` with the JSON block.
- [ ] **Step 6:** Within 60 s the orchestrator logs `[sentinel-sync] imported 1 incident(s)`, and the Control Center shows
  the incident with source "GitHub health sentinel" and a link to the issue.
- [ ] **Step 7 (clean up the test):** `gh issue close <n> --comment "phase 12 test"`, then restore health with
  `pnpm api:e2e --targets aws` (it redeploys with CATALOG_MODE). Stop the API.
- [ ] **Step 8 (optional, COULD):** Set up deploy.yml: create the GitHub Environment `production` with yourself as a
  required reviewer, add the secrets with `gh secret set …` and the variable with `gh variable set AWS_LAMBDA_ROLE_ARN …`.

## HANDOFF

```text
✅ PHASE 12 COMPLETE — GitHub sentinel, incident sync, CI/CD
BUILT:
  - packages/github (Octokit: issues, label, comments, close, SENTINEL_TARGETS variable)
  - orchestrator: GitHub port, sentinel arming after healthy deploys, 60 s incident sync, auto-close on verified recovery
  - scripts/sentinel/run-sentinel.ts (honors each run's user-defined sentinelIntervalMinutes via shouldProbeNow, on top
    of GitHub's fixed 5-min cron floor); workflows validate.yml, health-sentinel.yml (*/5 + dispatch), deploy.yml (COULD)
DO THIS (human):
  1. .env GITHUB_TOKEN/OWNER/REPO; pnpm dev:api; pnpm api:e2e --targets aws
  2. gh workflow run health-sentinel.yml; gh run watch   (green)
  3. pnpm demo:fault --provider aws; gh workflow run health-sentinel.yml; gh run watch   (red + issue)
  4. Watch the incident appear in the Control Center within 60 s
EXPECT:
  - validate workflow green; sentinel green then red; issue with JSON evidence; incident imported with GitHub link
IF IT FAILS:
  - "Resource not accessible by integration" in Actions → workflow permissions issues: write (check YAML)
  - Variable update 403 locally → GITHUB_TOKEN lacks repo scope; use `gh auth refresh -s repo` then `gh auth token`
  - Sentinel says "No sentinel targets" → run a deploy after GITHUB_* were set (sentinel.armed event)
EVIDENCE:
  - Screenshot the red sentinel run + the incident issue → evidence/demo-runs/sentinel-incident.png
  - Screenshot Bob's task summary → evidence/bob-task-summaries/phase-12-github-sentinel.png
  - git add -A; git commit -m "feat(p12): GitHub sentinel + CI"; git push
```
