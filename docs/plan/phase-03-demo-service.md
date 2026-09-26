<!--
@file     docs/plan/phase-03-demo-service.md
@purpose  Build the "Nimbus Books" demo application Bob will deploy, plus golden deployment assets and demo reset tooling.
@owner    Product & Experience (P)
-->
# Phase 03 — Demo service "Nimbus Books" (~45 min)

**Goal:** Build a small, real Hono API with a meaningful `/health` endpoint. That endpoint is the target of the controlled
fault: removing `CATALOG_MODE` makes it return 503. The repo deliberately ships **without** deployment assets, because Bob
generates them live. Golden copies of those assets go to `docs/demo/golden/`, and two scripts (`demo:golden`, `demo:reset`)
copy them in or remove them.

**Depends on:** Phase 01 (this phase can run in parallel with Phase 02).
**Interfaces produced:**
- `createApp(env: Record<string, string | undefined>): Hono` in `apps/demo-service/src/app.ts`
- `GET /health` returns 200 `{status:'healthy', revision, provider, checks:{config:{ok:true}}}`, or 503
  `{status:'unhealthy', checks:{config:{ok:false, missing:[...]}}}`
- `GET /api/books`, `GET /api/admin/stats` (guarded by the `ADMIN_TOKEN` header `x-admin-token`)
- Generated assets contract: `Dockerfile`, `.dockerignore`, `.ceignore`, `src/lambda.ts` (exports `handler`)

---

### Task 3.1 — Package scaffold

- [ ] **Step 1: Create `apps/demo-service/package.json`**

This package must stay installable with plain `npm install` inside Docker, so it has **no workspace dependencies**.

```json
{
  "name": "@bobops/demo-service",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "esbuild src/server.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/server.mjs",
    "start": "node dist/server.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "esbuild": "^0.25.0",
    "tsx": "^4.19.2",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create `apps/demo-service/tsconfig.json`** (standalone on purpose, because the Docker build context has no root tsconfig)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3:** `pnpm install` → Expected: `Done`.

### Task 3.2 — Config, catalog and app (test first)

- [ ] **Step 1: Write the failing test `apps/demo-service/src/app.test.ts`**

```ts
/**
 * @file      apps/demo-service/src/app.test.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Pre-deploy test gate (the orchestrator runs this suite in the TEST stage before every deployment).
 * @depends   vitest, ./app
 * @usedBy    `pnpm test`, orchestrator TEST stage (`pnpm exec vitest run` in this folder)
 * @agentNotes Tests use explicit env objects — never read process.env here.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

const healthyEnv = { CATALOG_MODE: 'featured', APP_VERSION: 'test-1', DEPLOY_PROVIDER: 'local', ADMIN_TOKEN: 'admin-secret' };

describe('nimbus-books', () => {
  it('GET /health → 200 when configuration is complete', async () => {
    const res = await createApp(healthyEnv).request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; revision: string; checks: { config: { ok: boolean } } };
    expect(body.status).toBe('healthy');
    expect(body.revision).toBe('test-1');
    expect(body.checks.config.ok).toBe(true);
  });

  it('GET /health → 503 naming the missing variable when CATALOG_MODE is absent', async () => {
    const res = await createApp({ APP_VERSION: 'test-1' }).request('/health');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; checks: { config: { ok: boolean; missing: string[] } } };
    expect(body.status).toBe('unhealthy');
    expect(body.checks.config.missing).toEqual(['CATALOG_MODE']);
  });

  it('GET /api/books returns only featured books in featured mode', async () => {
    const res = await createApp(healthyEnv).request('/api/books');
    const body = (await res.json()) as { mode: string; books: Array<{ featured: boolean }> };
    expect(body.mode).toBe('featured');
    expect(body.books.length).toBeGreaterThan(0);
    expect(body.books.every((b) => b.featured)).toBe(true);
  });

  it('GET /api/books returns all books in all mode', async () => {
    const res = await createApp({ ...healthyEnv, CATALOG_MODE: 'all' }).request('/api/books');
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(6);
  });

  it('GET /api/books → 500 when configuration is missing', async () => {
    const res = await createApp({}).request('/api/books');
    expect(res.status).toBe(500);
  });

  it('GET /api/admin/stats → 401 without the admin token, 200 with it', async () => {
    const app = createApp(healthyEnv);
    expect((await app.request('/api/admin/stats')).status).toBe(401);
    expect((await app.request('/api/admin/stats', { headers: { 'x-admin-token': 'admin-secret' } })).status).toBe(200);
  });
});
```

- [ ] **Step 2:** `pnpm vitest run apps/demo-service` → Expected: FAIL (`Failed to resolve import "./app"`).

- [ ] **Step 3: Create `apps/demo-service/src/catalog.ts`**

```ts
/**
 * @file      apps/demo-service/src/catalog.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Static, public-domain book catalog (no personal or confidential data — hackathon data rules).
 * @depends   —
 * @usedBy    ./app.ts
 * @agentNotes Tests expect exactly 6 books and at least one featured book.
 */
export interface Book {
  id: string;
  title: string;
  author: string;
  year: number;
  featured: boolean;
}

export const BOOKS: Book[] = [
  { id: 'b1', title: 'Pride and Prejudice', author: 'Jane Austen', year: 1813, featured: true },
  { id: 'b2', title: 'Moby-Dick', author: 'Herman Melville', year: 1851, featured: false },
  { id: 'b3', title: 'Frankenstein', author: 'Mary Shelley', year: 1818, featured: true },
  { id: 'b4', title: 'The Time Machine', author: 'H. G. Wells', year: 1895, featured: true },
  { id: 'b5', title: 'Little Women', author: 'Louisa May Alcott', year: 1868, featured: false },
  { id: 'b6', title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle', year: 1892, featured: false },
];
```

- [ ] **Step 4: Create `apps/demo-service/src/config.ts`**

```ts
/**
 * @file      apps/demo-service/src/config.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Reads runtime configuration. CATALOG_MODE is REQUIRED — its absence is the demo's controlled fault.
 * @depends   —
 * @usedBy    ./app.ts
 * @agentNotes Keep REQUIRED_ENV = ['CATALOG_MODE']: the fixtures, rules, fault script and remediation all rely on it.
 */
export const REQUIRED_ENV = ['CATALOG_MODE'] as const;

export interface ServiceConfig {
  catalogMode: 'featured' | 'all';
  appVersion: string;
  provider: string;
  adminToken?: string;
  missing: string[];
}

export function readConfig(env: Record<string, string | undefined>): ServiceConfig {
  const missing = REQUIRED_ENV.filter((key) => !env[key] || env[key]!.trim() === '');
  return {
    catalogMode: env.CATALOG_MODE === 'all' ? 'all' : 'featured',
    appVersion: env.APP_VERSION ?? 'dev',
    provider: env.DEPLOY_PROVIDER ?? 'local',
    adminToken: env.ADMIN_TOKEN,
    missing: [...missing],
  };
}
```

- [ ] **Step 5: Create `apps/demo-service/src/app.ts`**

```ts
/**
 * @file      apps/demo-service/src/app.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   The Nimbus Books HTTP API (runtime-agnostic): works on Node (Code Engine) and AWS Lambda.
 * @depends   hono, ./config, ./catalog
 * @usedBy    ./server.ts (Node), ./lambda.ts (generated by Bob), ./app.test.ts
 * @agentNotes Config is read PER REQUEST from the env object so tests can inject env. Errors go to console.error so they
 *             appear in Code Engine logs / CloudWatch — Bob's diagnosis cites these lines.
 */
import { Hono } from 'hono';
import { BOOKS } from './catalog';
import { readConfig } from './config';

export function createApp(env: Record<string, string | undefined>): Hono {
  const app = new Hono();
  const startedAt = new Date().toISOString();

  app.get('/', (c) =>
    c.json({ service: 'nimbus-books', message: 'Nimbus Books catalog API', endpoints: ['/health', '/api/books'] }),
  );

  app.get('/health', (c) => {
    const cfg = readConfig(env);
    const ok = cfg.missing.length === 0;
    if (!ok) console.error(`[health] FAIL missing required env: ${cfg.missing.join(', ')}`);
    return c.json(
      {
        status: ok ? 'healthy' : 'unhealthy',
        service: 'nimbus-books',
        revision: cfg.appVersion,
        provider: cfg.provider,
        startedAt,
        checks: {
          config: ok
            ? { ok: true }
            : { ok: false, missing: cfg.missing, hint: 'Set the missing environment variables and redeploy' },
        },
      },
      ok ? 200 : 503,
    );
  });

  app.get('/api/books', (c) => {
    const cfg = readConfig(env);
    if (cfg.missing.length) {
      console.error(`[books] cannot serve catalog: missing ${cfg.missing.join(', ')}`);
      return c.json({ error: 'catalog_unavailable', missing: cfg.missing }, 500);
    }
    const books = cfg.catalogMode === 'featured' ? BOOKS.filter((b) => b.featured) : BOOKS;
    return c.json({ mode: cfg.catalogMode, count: books.length, books });
  });

  app.get('/api/admin/stats', (c) => {
    const cfg = readConfig(env);
    if (!cfg.adminToken || c.req.header('x-admin-token') !== cfg.adminToken) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return c.json({ books: BOOKS.length, featured: BOOKS.filter((b) => b.featured).length, startedAt });
  });

  return app;
}
```

- [ ] **Step 6: Create `apps/demo-service/src/server.ts`**

```ts
/**
 * @file      apps/demo-service/src/server.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Node entry point (used locally and inside the Code Engine container). Listens on PORT (default 8080).
 * @depends   @hono/node-server, ./app
 * @usedBy    `pnpm --filter @bobops/demo-service dev`, Dockerfile CMD (via dist/server.mjs)
 * @agentNotes Code Engine injects PORT=8080. Do not hard-code another port.
 */
import { serve } from '@hono/node-server';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: createApp(process.env).fetch, port }, (info) => {
  console.log(`nimbus-books listening on :${info.port}`);
});
```

- [ ] **Step 7:** `pnpm vitest run apps/demo-service` → Expected: PASS (6 tests).

### Task 3.3 — Golden deployment assets (fallback plus smoke tests; Bob regenerates these live in the demo)

- [ ] **Step 1: Create `docs/demo/golden/Dockerfile`**

```dockerfile
# @file apps/demo-service/Dockerfile (golden copy: docs/demo/golden/Dockerfile)
# @phase P3 (golden) / generated live by IBM Bob (deployment-asset-authoring skill)
# @purpose Multi-stage build for IBM Cloud Code Engine "build from source". Produces a tiny runtime image on port 8080.
# @agentNotes Build context is apps/demo-service only — do not COPY files from outside it.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/dist/server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
```

- [ ] **Step 2: Create `docs/demo/golden/.dockerignore`**

```gitignore
# @file apps/demo-service/.dockerignore (golden)  @purpose keep the image build context small
node_modules
dist
*.test.ts
.env*
```

- [ ] **Step 3: Create `docs/demo/golden/.ceignore`**

```gitignore
# @file apps/demo-service/.ceignore (golden)  @purpose files NOT uploaded by `ibmcloud ce app create --build-source`
node_modules
dist
*.test.ts
.env*
```

- [ ] **Step 4: Create `docs/demo/golden/lambda.ts`**

```ts
/**
 * @file      apps/demo-service/src/lambda.ts  (golden copy: docs/demo/golden/lambda.ts)
 * @phase     P3 (golden) / generated live by IBM Bob (deployment-asset-authoring skill)
 * @owner     Product & Experience
 * @purpose   AWS Lambda entry point: adapts Lambda Function URL events to the runtime-agnostic Hono app.
 * @depends   hono/aws-lambda, ./app
 * @usedBy    packages/provider-aws bundleLambda() (esbuild entry src/lambda.ts, handler "lambda.handler")
 * @agentNotes The export MUST be named `handler`.
 */
import { handle } from 'hono/aws-lambda';
import { createApp } from './app';

export const handler = handle(createApp(process.env));
```

### Task 3.4 — Demo asset scripts

- [ ] **Step 1: Create `scripts/demo/golden.ts`**

```ts
/**
 * @file      scripts/demo/golden.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Copies the golden deployment assets into apps/demo-service (for smoke tests, or as a fallback if Bob's
 *            generated assets are broken during a live demo).
 * @depends   ../lib/env
 * @usedBy    `pnpm demo:golden`
 * @agentNotes Overwrites existing generated assets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/env';

const GOLDEN = path.join(REPO_ROOT, 'docs', 'demo', 'golden');
const APP = path.join(REPO_ROOT, 'apps', 'demo-service');
const COPIES: Array<[string, string]> = [
  ['Dockerfile', 'Dockerfile'],
  ['.dockerignore', '.dockerignore'],
  ['.ceignore', '.ceignore'],
  ['lambda.ts', path.join('src', 'lambda.ts')],
];

for (const [from, to] of COPIES) {
  fs.copyFileSync(path.join(GOLDEN, from), path.join(APP, to));
  console.log(`copied docs/demo/golden/${from} → apps/demo-service/${to.replace(/\\/g, '/')}`);
}
```

- [ ] **Step 2: Create `scripts/demo/reset.ts`**

```ts
/**
 * @file      scripts/demo/reset.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Resets the repo to the "before Bob" demo state: removes generated deployment assets and the orchestrator's
 *            local store so the recorded demo starts clean.
 * @depends   ../lib/env
 * @usedBy    `pnpm demo:reset` (run BEFORE a rehearsal/recording, with the orchestrator STOPPED)
 * @agentNotes Does NOT touch cloud resources (the deployed apps keep running; the next deploy updates them in place).
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/env';

const TARGETS = [
  'apps/demo-service/Dockerfile',
  'apps/demo-service/.dockerignore',
  'apps/demo-service/.ceignore',
  'apps/demo-service/src/lambda.ts',
  'apps/orchestrator/.data/store.json',
];

for (const rel of TARGETS) {
  const abs = path.join(REPO_ROOT, rel);
  if (fs.existsSync(abs)) {
    fs.rmSync(abs);
    console.log(`removed ${rel}`);
  } else {
    console.log(`(absent) ${rel}`);
  }
}
console.log('Demo reset complete. Bob will regenerate deployment assets during /deploy.');
```

- [ ] **Step 3: Replace `scripts/package.json`** with:

```json
{
  "name": "@bobops/scripts",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "demo:golden": "tsx demo/golden.ts",
    "demo:reset": "tsx demo/reset.ts"
  },
  "dependencies": {
    "dotenv": "^16.4.7"
  }
}
```

### Task 3.5 — Verify locally

- [ ] **Step 1:** `pnpm install; pnpm test; pnpm typecheck` → Expected: all green (core 23 plus demo-service 6).
- [ ] **Step 2 (HUMAN): Run the app locally**
  ```powershell
  $env:CATALOG_MODE="featured"; $env:APP_VERSION="local-1"; pnpm --filter @bobops/demo-service dev
  ```
  In a second terminal:
  ```powershell
  curl.exe -s http://localhost:8080/health
  curl.exe -s http://localhost:8080/api/books
  ```
  Expected: `{"status":"healthy",...,"revision":"local-1",...}` and a JSON list of 3 featured books.
  Stop the server with Ctrl+C. Restart it **without** `CATALOG_MODE` (run `Remove-Item Env:CATALOG_MODE`), and
  `/health` should return `{"status":"unhealthy",...,"missing":["CATALOG_MODE"]...}`.
- [ ] **Step 3:** `pnpm demo:golden` then `pnpm --filter @bobops/demo-service build` → Expected: `dist/server.mjs` is created.
  Then `pnpm demo:reset` → Expected: the 4 generated assets are removed.

## HANDOFF

```text
✅ PHASE 03 COMPLETE — Demo service "Nimbus Books"
BUILT:
  - apps/demo-service (Hono API: /health, /api/books, /api/admin/stats) + 6 tests
  - docs/demo/golden/{Dockerfile,.dockerignore,.ceignore,lambda.ts}
  - scripts: demo:golden, demo:reset
DO THIS (human):
  1. pnpm test; pnpm typecheck
  2. Run the service locally with and without CATALOG_MODE (see Task 3.5 Step 2) and curl /health
  3. pnpm demo:golden; pnpm --filter @bobops/demo-service build; pnpm demo:reset
EXPECT:
  - 29 tests pass
  - /health → 200 healthy with CATALOG_MODE, 503 unhealthy + missing ["CATALOG_MODE"] without it
  - dist/server.mjs builds; demo:reset removes the 4 generated assets
IF IT FAILS:
  - Port 8080 busy → $env:PORT="8081" before starting
  - esbuild not found → pnpm install at repo root
EVIDENCE:
  - Screenshot Bob's task summary → evidence/bob-task-summaries/phase-03-demo-service.png
  - git add -A; git commit -m "feat(p03): demo service"; git push
```
