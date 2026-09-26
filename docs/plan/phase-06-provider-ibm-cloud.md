<!--
@file     docs/plan/phase-06-provider-ibm-cloud.md
@purpose  Real IBM Cloud Code Engine adapter (primary cloud) + IaC bootstrap + live smoke deployment.
@owner    Orchestration & Cloud (O)
-->
# Phase 06 — Provider: IBM Cloud Code Engine (~90 min)

**Goal:** Implement `IbmCloudProvider` against the `CloudProvider` contract using the `ibmcloud` CLI with the Code Engine
plugin. It builds from local source using the app's Dockerfile, keeps secrets in Code Engine secrets, reads logs, applies env
changes and rolls back. Then **deploy Nimbus Books to Code Engine for real** with a smoke script. That deploy also pre-warms
the app for the demo.

**Depends on:** Phase 02 (contract) and Phase 03 (demo app plus golden assets).
**Interfaces produced:** `IbmCloudProvider(cfg: IbmCloudConfig)` and `IbmCloudConfig { apiKey?, region, resourceGroup, project }`,
exported from `@bobops/provider-ibm-cloud`. Also `parseCodeEngineApp`, `parseRevisions` and `extractJson`.

**Why the CLI and not the REST API?** The CLI handles the source upload, the Container Registry namespace and the build run
for us. A REST-based "build from local source" would take hours. The CLI output is parsed from JSON by tolerant, unit-tested
parsers.

---

### Task 6.1 — Package scaffold

- [ ] **Step 1: Create `packages/provider-ibm-cloud/package.json`**

```json
{
  "name": "@bobops/provider-ibm-cloud",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": {
    "@bobops/core": "workspace:*",
    "execa": "^9.5.2"
  }
}
```

- [ ] **Step 2: Create `packages/provider-ibm-cloud/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3:** `pnpm install`

### Task 6.2 — Parsers (test first)

- [ ] **Step 1: Write `packages/provider-ibm-cloud/src/parse.test.ts`**

```ts
/**
 * @file      packages/provider-ibm-cloud/src/parse.test.ts
 * @phase     P6
 * @owner     Orchestration & Cloud
 * @purpose   Locks the tolerant parsing of `ibmcloud ce … --output json` for both known output shapes.
 * @depends   vitest, ./parse
 * @usedBy    pnpm test
 * @agentNotes If real CLI output differs, ADD a new fixture + path in parse.ts; never delete an existing shape.
 */
import { describe, expect, it } from 'vitest';
import { extractJson, parseCodeEngineApp, parseRevisions } from './parse';

const KNATIVE_SHAPE = {
  metadata: { name: 'bobops-nimbus-books' },
  spec: {
    template: {
      spec: {
        containers: [
          {
            image: 'private.us-south.icr.io/ce--abc/app-bobops-nimbus-books:20260927',
            env: [
              { name: 'CATALOG_MODE', value: 'featured' },
              { name: 'ADMIN_TOKEN', valueFrom: { secretKeyRef: { name: 's', key: 'ADMIN_TOKEN' } } },
            ],
          },
        ],
      },
    },
  },
  status: {
    url: 'https://bobops-nimbus-books.abc123.us-south.codeengine.appdomain.cloud',
    latestReadyRevisionName: 'bobops-nimbus-books-00002',
    conditions: [{ type: 'Ready', status: 'True' }],
  },
};

const V2_SHAPE = {
  name: 'bobops-nimbus-books',
  endpoint: 'https://bobops-nimbus-books.xyz.us-south.codeengine.appdomain.cloud',
  status: 'ready',
  latest_ready_revision: 'bobops-nimbus-books-00003',
  image_reference: 'private.us-south.icr.io/ce--abc/app:2',
  run_env_variables: [{ type: 'literal', name: 'CATALOG_MODE', value: 'all' }],
};

describe('Code Engine parsers', () => {
  it('extracts JSON after a CLI preamble', () => {
    expect(extractJson('Getting application...\nOK\n\n{"a":1}')).toEqual({ a: 1 });
  });

  it('parses the Knative-style app shape', () => {
    const app = parseCodeEngineApp(KNATIVE_SHAPE);
    expect(app.url).toContain('codeengine.appdomain.cloud');
    expect(app.revision).toBe('bobops-nimbus-books-00002');
    expect(app.ready).toBe(true);
    expect(app.env).toEqual({ CATALOG_MODE: 'featured' });
    expect(app.image).toContain('icr.io');
  });

  it('parses the v2 API app shape', () => {
    const app = parseCodeEngineApp(V2_SHAPE);
    expect(app.url).toContain('xyz');
    expect(app.revision).toBe('bobops-nimbus-books-00003');
    expect(app.ready).toBe(true);
    expect(app.env).toEqual({ CATALOG_MODE: 'all' });
  });

  it('parses and orders revisions (both shapes)', () => {
    const knative = parseRevisions({
      items: [
        { metadata: { name: 'r-00002', creationTimestamp: '2026-09-27T10:05:00Z' }, spec: { containers: [{ image: 'img:2' }] } },
        { metadata: { name: 'r-00001', creationTimestamp: '2026-09-27T10:00:00Z' }, spec: { containers: [{ image: 'img:1' }] } },
      ],
    });
    expect(knative.map((r) => r.name)).toEqual(['r-00001', 'r-00002']);
    const v2 = parseRevisions({ revisions: [{ name: 'r-1', created_at: '2026-09-27T10:00:00Z', image_reference: 'img:1' }] });
    expect(v2[0]?.image).toBe('img:1');
  });
});
```

- [ ] **Step 2:** `pnpm vitest run packages/provider-ibm-cloud` → Expected: FAIL (module not found).

- [ ] **Step 3: Create `packages/provider-ibm-cloud/src/parse.ts`**

```ts
/**
 * @file      packages/provider-ibm-cloud/src/parse.ts
 * @phase     P6
 * @owner     Orchestration & Cloud
 * @purpose   Tolerant parsers for `ibmcloud ce` JSON output (Knative-style and v2-API-style shapes).
 * @depends   —
 * @usedBy    ./provider.ts
 * @agentNotes Pure functions only. Unknown shapes must degrade to undefined fields, never throw.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ParsedCodeEngineApp {
  url?: string;
  revision?: string;
  ready: boolean;
  env: Record<string, string>;
  image?: string;
}

export function extractJson(stdout: string): unknown {
  const start = stdout.search(/[[{]/);
  if (start < 0) throw new Error(`Expected JSON output from ibmcloud, got: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(start));
}

export function parseCodeEngineApp(raw: unknown): ParsedCodeEngineApp {
  const r = (raw ?? {}) as any;
  const container = r?.spec?.template?.spec?.containers?.[0];
  const conditions: Array<{ type?: string; status?: string }> | undefined = r?.status?.conditions;
  const envList: Array<{ name?: string; value?: unknown }> = container?.env ?? r?.run_env_variables ?? [];
  const env: Record<string, string> = {};
  for (const e of envList) {
    if (e?.name && typeof e.value === 'string') env[e.name] = e.value;
  }
  return {
    url: r?.status?.url ?? r?.endpoint ?? r?.url,
    revision: r?.status?.latestReadyRevisionName ?? r?.latest_ready_revision ?? r?.status_details?.latest_ready_revision,
    ready: Array.isArray(conditions) ? conditions.some((c) => c.type === 'Ready' && c.status === 'True') : r?.status === 'ready',
    env,
    image: container?.image ?? r?.image_reference,
  };
}

export function parseRevisions(raw: unknown): Array<{ name: string; image?: string; createdAt: string }> {
  const r = (raw ?? {}) as any;
  const items: any[] = r?.items ?? r?.revisions ?? (Array.isArray(r) ? r : []);
  return items
    .map((it) => ({
      name: String(it?.metadata?.name ?? it?.name ?? ''),
      image: it?.spec?.containers?.[0]?.image ?? it?.image_reference,
      createdAt: String(it?.metadata?.creationTimestamp ?? it?.created_at ?? ''),
    }))
    .filter((rev) => rev.name)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
```

- [ ] **Step 4:** `pnpm vitest run packages/provider-ibm-cloud` → Expected: PASS (4 tests).

### Task 6.3 — CLI wrapper and provider

- [ ] **Step 1: Create `packages/provider-ibm-cloud/src/cli.ts`**

```ts
/**
 * @file      packages/provider-ibm-cloud/src/cli.ts
 * @phase     P6
 * @owner     Orchestration & Cloud
 * @purpose   Runs `ibmcloud` non-interactively with redaction of secrets in errors and output.
 * @depends   execa, @bobops/core (redactText)
 * @usedBy    ./provider.ts
 * @agentNotes stdin is ignored so a prompt can never hang the orchestrator. ALWAYS pass secret values in opts.secrets.
 */
import { execa } from 'execa';
import { redactText } from '@bobops/core';

export class IbmCloudCliError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
    this.name = 'IbmCloudCliError';
  }
}

export interface CliOptions {
  secrets?: string[];
  timeoutMs?: number;
}

export const tail = (text: string, lines: number): string =>
  text.split(/\r?\n/).filter(Boolean).slice(-lines).join('\n');

export async function ibmcloud(args: string[], opts: CliOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const secrets = opts.secrets ?? [];
  const result = await execa('ibmcloud', args, {
    reject: false,
    stdin: 'ignore',
    timeout: opts.timeoutMs ?? 15 * 60_000,
    env: { IBMCLOUD_COLOR: 'false', IBMCLOUD_VERSION_CHECK: 'false' },
  });
  const stdout = redactText(String(result.stdout ?? ''), secrets);
  const stderr = redactText(String(result.stderr ?? ''), secrets);
  if (result.failed) {
    const cmd = redactText(`ibmcloud ${args.join(' ')}`, secrets);
    const why = result.timedOut ? 'timed out' : `exit ${String(result.exitCode)}`;
    throw new IbmCloudCliError(`${cmd} failed (${why}): ${tail(stderr || stdout, 8)}`, `${stdout}\n${stderr}`);
  }
  return { stdout, stderr };
}
```

- [ ] **Step 2: Create `packages/provider-ibm-cloud/src/provider.ts`**

```ts
/**
 * @file      packages/provider-ibm-cloud/src/provider.ts
 * @phase     P6
 * @owner     Orchestration & Cloud
 * @purpose   IBM Cloud Code Engine implementation of the CloudProvider contract (V1 primary cloud).
 *            deploy = build from local source (Dockerfile) + create/update app; secrets = Code Engine secret;
 *            logs = `ce app logs`; setEnv = `ce app update --env/--env-rm`; rollback = previous revision image.
 * @depends   @bobops/core, ./cli, ./parse, node:fs
 * @usedBy    apps/orchestrator/src/providers/registry.ts, scripts/smoke/deploy-ibm.ts
 * @agentNotes Session (login + project select) is cached for 20 min. Never log the API key; pass secrets to ibmcloud().
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  describeEnvChange,
  evidence,
  redactEnv,
  type CloudProvider,
  type DeployInput,
  type DeployResult,
  type DeploymentRef,
  type EnvChange,
  type ProgressFn,
  type ProviderCapabilities,
  type ProviderStatus,
  type Resource,
  type TargetPlan,
} from '@bobops/core';
import { IbmCloudCliError, ibmcloud, tail } from './cli';
import { extractJson, parseCodeEngineApp, parseRevisions, type ParsedCodeEngineApp } from './parse';

export interface IbmCloudConfig {
  apiKey?: string;
  region: string;
  resourceGroup: string;
  project: string;
}

const SESSION_TTL_MS = 20 * 60_000;

export class IbmCloudProvider implements CloudProvider {
  readonly id = 'ibm-cloud' as const;
  private sessionAt = 0;
  private capsCache?: { at: number; value: ProviderCapabilities };

  constructor(private readonly cfg: IbmCloudConfig) {}

  private async session(): Promise<void> {
    if (Date.now() - this.sessionAt < SESSION_TTL_MS) return;
    if (!this.cfg.apiKey) throw new Error('IBMCLOUD_API_KEY is not set in the root .env');
    await ibmcloud(['login', '--apikey', this.cfg.apiKey, '-r', this.cfg.region, '-g', this.cfg.resourceGroup], {
      secrets: [this.cfg.apiKey],
      timeoutMs: 120_000,
    });
    await ibmcloud(['ce', 'project', 'select', '--name', this.cfg.project], { timeoutMs: 120_000 });
    this.sessionAt = Date.now();
  }

  private async getApp(name: string): Promise<ParsedCodeEngineApp | null> {
    try {
      const { stdout } = await ibmcloud(['ce', 'app', 'get', '--name', name, '--output', 'json'], { timeoutMs: 60_000 });
      return parseCodeEngineApp(extractJson(stdout));
    } catch (err) {
      if (err instanceof IbmCloudCliError) return null;
      throw err;
    }
  }

  private async resultFor(appName: string, fallbackEndpoint: string | undefined, label: string): Promise<DeployResult> {
    const app = await this.getApp(appName);
    return {
      endpoint: app?.url ?? fallbackEndpoint ?? '',
      revision: app?.revision ?? 'unknown',
      evidence: [evidence(label, 'ibmcloud ce app get', { url: app?.url, revision: app?.revision, ready: app?.ready, image: app?.image, env: redactEnv(app?.env ?? {}) })],
    };
  }

  async capabilities(): Promise<ProviderCapabilities> {
    if (this.capsCache && Date.now() - this.capsCache.at < 60_000) return this.capsCache.value;
    const base = {
      provider: 'ibm-cloud' as const,
      displayName: 'IBM Cloud Code Engine',
      region: this.cfg.region,
      services: ['code-engine', 'container-registry', 'code-engine-secrets'],
      supportsRollback: true,
    };
    let value: ProviderCapabilities;
    try {
      await this.session();
      const { stdout } = await ibmcloud(['target', '--output', 'json'], { timeoutMs: 60_000 });
      const target = extractJson(stdout) as { account?: { name?: string; guid?: string } };
      value = { ...base, authenticated: true, account: target.account?.name ?? target.account?.guid, notes: [`Code Engine project: ${this.cfg.project}`] };
    } catch (err) {
      value = { ...base, authenticated: false, notes: [err instanceof Error ? err.message : String(err)] };
    }
    this.capsCache = { at: Date.now(), value };
    return value;
  }

  planResources(target: TargetPlan): Resource[] {
    return [
      { type: 'code-engine-project', name: this.cfg.project, action: 'reuse' },
      { type: 'code-engine-build-run', name: `${target.appName}-build`, action: 'create' },
      { type: 'container-image (ICR)', name: `${target.appName}:<timestamp>`, action: 'create' },
      ...(target.secretRefs.length ? [{ type: 'code-engine-secret', name: `${target.appName}-secrets`, action: 'create' as const }] : []),
      { type: 'code-engine-app', name: target.appName, action: 'create' },
    ];
  }

  async deploy(input: DeployInput, progress: ProgressFn): Promise<DeployResult> {
    const { target, sourceDir, secrets } = input;
    if (!fs.existsSync(path.join(sourceDir, 'Dockerfile'))) {
      throw new Error(`No Dockerfile in ${sourceDir}. Generate deployment assets first (Bob skill deployment-asset-authoring, or pnpm demo:golden).`);
    }
    progress({ type: 'provision.started', message: `Connecting to IBM Cloud (${this.cfg.region}) and selecting Code Engine project ${this.cfg.project}` });
    await this.session();
    const existing = await this.getApp(target.appName);
    const secretValues = Object.values(secrets);
    const extra: string[] = [];

    if (Object.keys(secrets).length) {
      const secretName = `${target.appName}-secrets`;
      const literals = Object.entries(secrets).flatMap(([k, v]) => ['--from-literal', `${k}=${v}`]);
      const exists = await ibmcloud(['ce', 'secret', 'get', '--name', secretName], { timeoutMs: 60_000 }).then(
        () => true,
        () => false,
      );
      await ibmcloud(['ce', 'secret', exists ? 'update' : 'create', '--name', secretName, ...literals], {
        secrets: secretValues,
        timeoutMs: 120_000,
      });
      if (!existing) extra.push('--env-from-secret', secretName);
      progress({
        type: 'provision.completed',
        message: `Code Engine secret ${secretName} ${exists ? 'updated' : 'created'} with ${Object.keys(secrets).length} key(s) (values redacted)`,
      });
    } else {
      progress({ type: 'provision.completed', message: `Code Engine project ${this.cfg.project} ready` });
    }

    for (const [k, v] of Object.entries(target.env)) extra.push('--env', `${k}=${v}`);
    const verb = existing ? 'update' : 'create';
    progress({
      type: 'build.started',
      message: `Code Engine is building ${target.appName} from source with its Dockerfile, then will ${verb} the app (typically 2–5 min)`,
    });
    const out = await ibmcloud(
      [
        'ce', 'app', verb,
        '--name', target.appName,
        '--build-source', sourceDir,
        '--port', String(target.port),
        '--min-scale', '1',
        '--max-scale', '2',
        '--cpu', '0.25',
        '--memory', '0.5G',
        '--wait-timeout', '900',
        ...extra,
      ],
      { secrets: secretValues, timeoutMs: 25 * 60_000 },
    );
    progress({
      type: 'build.completed',
      message: `Code Engine build finished and app ${target.appName} ${verb === 'create' ? 'created' : 'updated'}`,
      evidence: [evidence('ibmcloud output (tail)', `ibmcloud ce app ${verb}`, tail(out.stdout, 25))],
    });
    const result = await this.resultFor(target.appName, undefined, 'Code Engine app status');
    if (!result.endpoint) throw new Error(`Code Engine did not report a URL for ${target.appName} (check: ibmcloud ce app get --name ${target.appName})`);
    return result;
  }

  async status(ref: DeploymentRef): Promise<ProviderStatus> {
    await this.session();
    const app = await this.getApp(ref.appName);
    if (!app) return { state: 'not_found', env: {}, raw: null };
    return { state: app.ready ? 'ready' : 'deploying', revision: app.revision, endpoint: app.url, env: app.env, raw: { image: app.image } };
  }

  async logs(ref: DeploymentRef, lines: number): Promise<string[]> {
    await this.session();
    const read = async (args: string[]) => (await ibmcloud(args, { timeoutMs: 60_000 })).stdout;
    let text: string;
    try {
      text = await read(['ce', 'app', 'logs', '--app', ref.appName, '--tail', String(lines)]);
    } catch {
      text = await read(['ce', 'app', 'logs', '--app', ref.appName]);
    }
    return text.split(/\r?\n/).filter(Boolean).slice(-lines);
  }

  async setEnv(ref: DeploymentRef, change: EnvChange, progress: ProgressFn): Promise<DeployResult> {
    await this.session();
    const args = ['ce', 'app', 'update', '--name', ref.appName, '--wait-timeout', '600'];
    for (const [k, v] of Object.entries(change.set ?? {})) args.push('--env', `${k}=${v}`);
    for (const k of change.remove ?? []) args.push('--env-rm', k);
    progress({ type: 'provider.progress', message: `Updating Code Engine app ${ref.appName} configuration (${describeEnvChange(change)}) → new revision` });
    await ibmcloud(args, { timeoutMs: 15 * 60_000 });
    return this.resultFor(ref.appName, ref.endpoint, 'Code Engine app after configuration change');
  }

  async rollback(ref: DeploymentRef, progress: ProgressFn, toRevision?: string): Promise<DeployResult> {
    await this.session();
    let image = toRevision && toRevision.includes('/') ? toRevision : undefined;
    if (!image) {
      const { stdout } = await ibmcloud(['ce', 'revision', 'list', '--app', ref.appName, '--output', 'json'], { timeoutMs: 60_000 });
      const revisions = parseRevisions(extractJson(stdout));
      const index = toRevision ? revisions.findIndex((r) => r.name === toRevision) : revisions.length - 2;
      image = revisions[index]?.image;
      if (!image) throw new Error('Could not determine the previous revision image; pass toRevision as an image reference');
    }
    progress({ type: 'provider.progress', message: `Rolling back ${ref.appName} to image ${image}` });
    await ibmcloud(['ce', 'app', 'update', '--name', ref.appName, '--image', image, '--wait-timeout', '600'], { timeoutMs: 15 * 60_000 });
    return this.resultFor(ref.appName, ref.endpoint, 'Code Engine app after rollback');
  }
}
```

- [ ] **Step 3: Create `packages/provider-ibm-cloud/src/index.ts`**

```ts
/**
 * @file      packages/provider-ibm-cloud/src/index.ts
 * @phase     P6
 * @owner     Orchestration & Cloud
 * @purpose   Public API of @bobops/provider-ibm-cloud.
 * @depends   ./provider, ./parse
 * @usedBy    orchestrator registry, scripts
 * @agentNotes Export only what other packages need.
 */
export { IbmCloudProvider, type IbmCloudConfig } from './provider';
export { extractJson, parseCodeEngineApp, parseRevisions, type ParsedCodeEngineApp } from './parse';
```

- [ ] **Step 4:** `pnpm test; pnpm typecheck` → Expected: all green (46 tests).

### Task 6.4 — Infrastructure as code (bootstrap, versioned)

- [ ] **Step 1: Create `infra/ibm-cloud/bootstrap.ps1`**

```powershell
# @file      infra/ibm-cloud/bootstrap.ps1
# @phase     P6
# @owner     Orchestration & Cloud
# @purpose   Idempotent IBM Cloud bootstrap: target region/resource group, install the Code Engine plugin,
#            ensure the Code Engine project exists and is selected. Safe to run repeatedly.
# @usage     pwsh infra/ibm-cloud/bootstrap.ps1  (after `ibmcloud login --sso` or `ibmcloud login --apikey ...`)
# @agentNotes HUMAN runs this. Agents must not execute cloud-mutating commands.
param(
  [string]$Project = "bobops-demo",
  [string]$Region = "us-south",
  [string]$ResourceGroup = "Default"
)

ibmcloud target -r $Region -g $ResourceGroup
ibmcloud plugin install code-engine -f

ibmcloud ce project get --name $Project *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating Code Engine project $Project ..."
  ibmcloud ce project create --name $Project
} else {
  Write-Host "Code Engine project $Project already exists"
}
ibmcloud ce project select --name $Project
ibmcloud ce project current
```

- [ ] **Step 2: Create `infra/ibm-cloud/README.md`**

```markdown
<!-- @file infra/ibm-cloud/README.md  @phase P6  @purpose How IBM Cloud resources for BobOps are created and owned. -->
# IBM Cloud infrastructure (V1 primary cloud)

| Resource | Created by | Name |
|---|---|---|
| Code Engine project | `bootstrap.ps1` (human, once) | `bobops-demo` (us-south) |
| Container Registry namespace + registry secret | Code Engine automatically on first `--build-source` build | `ce--…` |
| Build run + image | orchestrator (`IbmCloudProvider.deploy`) after plan approval | `<app>-build-…` |
| App | orchestrator after plan approval | `bobops-nimbus-books` |
| Secret | orchestrator from `plan.secretRefs` (`SECRET_<NAME>` in .env) | `bobops-nimbus-books-secrets` |
| Replay Control Center (Phase 14) | human | `bobops-control-center` |

All app/secret names are constrained by the core schema to `^bobops-[a-z0-9-]{3,40}$`.
Clean up after the hackathon: `ibmcloud ce project delete --name bobops-demo -f --hard` (human only).
```

### Task 6.5 — Live smoke deployment (HUMAN runs it; it also pre-warms the demo app)

- [ ] **Step 1: Create `scripts/smoke/deploy-ibm.ts`**

```ts
/**
 * @file      scripts/smoke/deploy-ibm.ts
 * @phase     P6
 * @owner     Orchestration & Cloud
 * @purpose   Deploys Nimbus Books to IBM Cloud Code Engine directly through the adapter (no orchestrator) and probes it.
 *            Proves credentials + adapter + Dockerfile work, and pre-warms the app/registry for the live demo.
 * @depends   ../lib/env, @bobops/core, @bobops/provider-ibm-cloud
 * @usedBy    `pnpm smoke:ibm` (HUMAN — creates real cloud resources)
 * @agentNotes Requires golden assets in apps/demo-service (run `pnpm demo:golden` first).
 */
import path from 'node:path';
import { REPO_ROOT, requireEnv } from '../lib/env';
import { probeHealth } from '@bobops/core';
import { IbmCloudProvider } from '@bobops/provider-ibm-cloud';

const provider = new IbmCloudProvider({
  apiKey: requireEnv('IBMCLOUD_API_KEY'),
  region: process.env.IBMCLOUD_REGION ?? 'us-south',
  resourceGroup: process.env.IBMCLOUD_RESOURCE_GROUP ?? 'Default',
  project: process.env.IBM_CE_PROJECT ?? 'bobops-demo',
});

console.log('Capabilities:', await provider.capabilities());
const adminToken = process.env.SECRET_ADMIN_TOKEN;
const result = await provider.deploy(
  {
    runId: 'smoke',
    sourceDir: path.join(REPO_ROOT, 'apps', 'demo-service'),
    secrets: adminToken ? { ADMIN_TOKEN: adminToken } : {},
    target: {
      provider: 'ibm-cloud',
      service: 'code-engine',
      region: process.env.IBMCLOUD_REGION ?? 'us-south',
      appName: 'bobops-nimbus-books',
      port: 8080,
      healthPath: '/health',
      env: { CATALOG_MODE: 'featured', APP_VERSION: 'smoke-1', DEPLOY_PROVIDER: 'ibm-cloud' },
      secretRefs: ['ADMIN_TOKEN'],
      resources: [],
    },
  },
  (e) => console.log(`[${e.type}] ${e.message}`),
);
console.log('Deploy result:', { endpoint: result.endpoint, revision: result.revision });
console.log('Health probe:', await probeHealth({ provider: 'ibm-cloud', endpoint: result.endpoint, healthPath: '/health' }));
console.log('Logs (last 10):', await provider.logs({ provider: 'ibm-cloud', appName: 'bobops-nimbus-books', region: 'us-south' }, 10));
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
    "smoke:ibm": "tsx smoke/deploy-ibm.ts"
  },
  "dependencies": {
    "@bobops/core": "workspace:*",
    "@bobops/provider-ibm-cloud": "workspace:*",
    "dotenv": "^16.4.7"
  }
}
```

- [ ] **Step 3:** `pnpm install; pnpm typecheck`
- [ ] **Step 4 (HUMAN):** Commit the infra files first. Then:
  ```powershell
  pnpm demo:golden
  pnpm smoke:ibm
  ```
  Expected (after 2–5 min): the `[provision.*]` / `[build.*]` lines, then
  `Deploy result: { endpoint: 'https://bobops-nimbus-books.<hash>.us-south.codeengine.appdomain.cloud', revision: 'bobops-nimbus-books-0000N' }`,
  then `Health probe: { ok: true, statusCode: 200, ... revision: 'smoke-1' }`, and a few log lines.
- [ ] **Step 5 (HUMAN):** Open the endpoint plus `/api/books` in a browser. Expected: 3 featured books.
- [ ] **Step 6 (HUMAN):** `pnpm demo:reset`. The app **keeps running** on IBM Cloud; the demo will update it in place.

### Task 6.6 — RETROFIT (post-phase-9): this ONE class now serves both real IBM architectures

> Depends on Task 2.13 (core). `IbmCloudProvider` already only ever built `--min-scale 1`. It now branches on
> `target.service`/`ref.service` between `code-engine` (min-scale 1, always-on) and `code-engine-scale-to-zero`
> (min-scale 0) — no new class, no new credentials.

- [ ] **Step 1: In `src/provider.ts`**, import `type ServiceId` from `@bobops/core` alongside the existing imports, and
  add, right after `const SESSION_TTL_MS = 20 * 60_000;`:

```ts
/** The one place the two IBM architectures differ in the actual `ibmcloud ce app` call: min-scale. */
function minScaleFor(service: ServiceId): string {
  return service === 'code-engine-scale-to-zero' ? '0' : '1';
}
```

- [ ] **Step 2:** In `capabilities()`, add `offeredServices: ['code-engine', 'code-engine-scale-to-zero'] as ServiceId[],`
  to the `base` object (alongside `services: [...]`).

- [ ] **Step 3:** In `planResources()`, change the last resource's `type` from `'code-engine-app'` to
  `` `code-engine-app (min-scale ${minScaleFor(target.service)})` ``.

- [ ] **Step 4:** In `deploy()`, replace the hardcoded `'--min-scale', '1',` with `'--min-scale', minScale,` where
  `const minScale = minScaleFor(target.service);` is declared right before the `progress({ type: 'build.started', ... })`
  call, and mention `${target.service}, min-scale ${minScale}` in that progress message.

- [ ] **Step 5:** In `setEnv()`, add `'--min-scale', minScaleFor(ref.service),` to the `ce app update` args (idempotent
  re-assertion — guards against scaling-mode drift from a manual `ibmcloud` command).

- [ ] **Step 6:** In `rollback()`, add `'--min-scale', minScaleFor(ref.service),` to the final `ce app update` args too.

- [ ] **Step 7:** `pnpm test` → still 4/4 parser tests pass unchanged (the retrofit doesn't touch parsing).

## HANDOFF

```text
✅ PHASE 06 COMPLETE — IBM Cloud Code Engine provider
BUILT:
  - packages/provider-ibm-cloud (CLI wrapper w/ redaction, tolerant parsers + 4 tests, IbmCloudProvider)
  - infra/ibm-cloud/bootstrap.ps1 + README
  - scripts/smoke/deploy-ibm.ts (pnpm smoke:ibm)
DO THIS (human):
  1. pnpm test; pnpm typecheck
  2. pnpm demo:golden; pnpm smoke:ibm   (2–5 minutes)
  3. Open <endpoint>/health and <endpoint>/api/books
  4. pnpm demo:reset
EXPECT:
  - Health probe ok:true statusCode:200 revision 'smoke-1'; /api/books lists 3 featured books
IF IT FAILS:
  - "Code Engine did not report a URL" → run: ibmcloud ce app get --name bobops-nimbus-books --output json > ce-app.json
    then ask Bob: "Add the URL/revision paths from ce-app.json to parseCodeEngineApp + a test fixture" (don't commit ce-app.json)
  - Build fails "npm install" → check docs/demo/golden/Dockerfile was copied (pnpm demo:golden)
  - "not authorized" on registry → account needs Container Registry; use the hackathon account
  - --tail flag unsupported for logs → handled automatically (falls back to full logs)
EVIDENCE:
  - Screenshot Bob's task summary → evidence/bob-task-summaries/phase-06-provider-ibm.png
  - Screenshot the IBM Cloud console Code Engine app page → evidence/demo-runs/ibm-code-engine-app.png
  - git add -A; git commit -m "feat(p06): IBM Cloud Code Engine provider"; git push
```
