<!--
@file     docs/plan/phase-11-control-center.md
@purpose  Build the Deployment Control Center (Next.js 15 + Tailwind v4, IBM Carbon-inspired dark UI).
@owner    Product & Experience (P)
-->
# Phase 11 — Deployment Control Center (~3 h)

**Goal:** Build the product surface judges will look at most (PRD §8). It shows providers, runs, the 8-stage lifecycle,
business metrics, **human approval cards** (the only place approvals happen), Bob's specialist analysis, the plan, live
environments with health evidence, incidents with Bob's diagnosis, runtime logs and a filterable **audit trail**. It updates
live over SSE. It also has a **replay mode**, a static export built from the exported evidence, which serves as the public
demo URL (Phase 14).

**Depends on:** Phase 02 (types). It uses the Phase 05 API live, so it can start right after Phase 02, with P using
`pnpm api:e2e --targets aws` data once Phase 08 is available.

**Design language:** IBM Carbon g100 dark palette, IBM Plex Sans/Mono. Purple = Bob, blue = IBM Cloud, orange = AWS,
green = verified, red = incident, yellow = needs a human.

---

### Task 11.1 — Scaffold (HUMAN or agent)

- [ ] **Step 1:** From the repo root:
  ```powershell
  pnpm dlx create-next-app@15 apps/control-center --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-pnpm --skip-install --disable-git --yes
  ```
  Check that `apps/control-center/app/globals.css` starts with `@import "tailwindcss";` (Tailwind v4). If it contains
  `@tailwind base;` instead, you got v3: delete the folder and re-run the command pinned as `create-next-app@15.5`.
- [ ] **Step 2: Edit `apps/control-center/package.json`**
  - set `"name": "@bobops/control-center"`
  - in `"scripts"`: set `"dev": "next dev -p 3000"` and add `"typecheck": "tsc --noEmit"`
  - in `"dependencies"` add `"@bobops/core": "workspace:*"`, `"clsx": "^2.1.1"` and `"zod": "^3.25.0"`
- [ ] **Step 3:** Delete `apps/control-center/public/*.svg` (template assets) and `apps/control-center/README.md`.
- [ ] **Step 4:** `pnpm install`

- [ ] **Step 5: Replace `apps/control-center/next.config.ts`**

```ts
/**
 * @file      apps/control-center/next.config.ts
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Next config: compile the workspace TS package @bobops/core; static export when NEXT_PUBLIC_MODE=replay.
 * @depends   next
 * @usedBy    next dev / next build
 * @agentNotes Replay build = `pnpm demo:replay` (Phase 14). Live mode needs the orchestrator on :4000.
 */
import type { NextConfig } from 'next';

const replay = process.env.NEXT_PUBLIC_MODE === 'replay';

const nextConfig: NextConfig = {
  transpilePackages: ['@bobops/core'],
  eslint: { ignoreDuringBuilds: true },
  ...(replay ? { output: 'export' as const, images: { unoptimized: true } } : {}),
};

export default nextConfig;
```

- [ ] **Step 6: Create `apps/control-center/.env.local.example`**, then copy it to `.env.local` (HUMAN, and set the token):

```dotenv
# @file apps/control-center/.env.local.example  @phase P11
# @purpose Control Center config. NEXT_PUBLIC_APPROVAL_TOKEN must equal APPROVAL_TOKEN in the root .env.
NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:4000
NEXT_PUBLIC_APPROVAL_TOKEN=change-me-to-the-same-value-as-APPROVAL_TOKEN
NEXT_PUBLIC_MODE=live
```

### Task 11.2 — Theme and layout

- [ ] **Step 1: Replace `apps/control-center/app/globals.css`**

```css
/*
 * @file      apps/control-center/app/globals.css
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Tailwind v4 + design tokens (IBM Carbon g100-inspired). Tokens become utilities: bg-layer, text-bob, border-line…
 * @agentNotes Use these tokens only; do not hard-code hex colors in components.
 */
@import "tailwindcss";

@theme {
  --color-canvas: #161616;
  --color-layer: #262626;
  --color-layer-2: #393939;
  --color-line: #393939;
  --color-line-strong: #6f6f6f;
  --color-fg: #f4f4f4;
  --color-muted: #a8a8a8;
  --color-ibm: #0f62fe;
  --color-ibm-soft: #78a9ff;
  --color-bob: #be95ff;
  --color-aws: #ff9900;
  --color-ok: #42be65;
  --color-warn: #f1c21b;
  --color-bad: #fa4d56;
  --color-info: #4589ff;
  --font-sans: var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, monospace;
}

html,
body {
  background: var(--color-canvas);
  color: var(--color-fg);
}
```

- [ ] **Step 2: Replace `apps/control-center/app/layout.tsx`**

```tsx
/**
 * @file      apps/control-center/app/layout.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   App shell: IBM Plex fonts, header with product identity ("powered by IBM Bob") and LIVE/REPLAY mode badge.
 * @depends   next/font/google, @/lib/api
 * @usedBy    every page
 * @agentNotes Keep "powered by IBM Bob" visible on every screen — judges must see Bob as the core component.
 */
import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { MODE } from '@/lib/api';
import './globals.css';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: 'BobOps Control Center',
  description: 'Agentic Multi-Cloud DevOps Engineer powered by IBM Bob',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-line bg-layer/70">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded bg-ibm font-mono text-sm font-semibold">B/</span>
              <span>
                <span className="font-semibold">BobOps</span> <span className="text-muted">Control Center</span>
              </span>
            </Link>
            <div className="flex items-center gap-3 text-xs">
              <span className="hidden text-muted md:inline">
                Agentic Multi-Cloud DevOps Engineer · powered by <span className="font-semibold text-bob">IBM Bob</span>
              </span>
              <span className={`rounded px-2 py-0.5 font-mono ${MODE === 'live' ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'}`}>
                {MODE === 'live' ? '● LIVE' : '▶ REPLAY'}
              </span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
```

### Task 11.3 — Data layer

- [ ] **Step 1: Create `apps/control-center/lib/api.ts`**

```ts
/**
 * @file      apps/control-center/lib/api.ts
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   All HTTP/SSE access to the orchestrator, plus REPLAY mode (static JSON in /public/replay) for the public demo URL.
 * @depends   @bobops/core (types only)
 * @usedBy    every page/component that loads or mutates data
 * @agentNotes The approval token is sent ONLY from decide() and injectFault() — human actions in this UI.
 */
import type { Approval, ProviderCapabilities, ProviderId, Run, RunAggregate, RunEvent } from '@bobops/core';

export const MODE: 'live' | 'replay' = process.env.NEXT_PUBLIC_MODE === 'replay' ? 'replay' : 'live';
export const API = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';
const TOKEN = process.env.NEXT_PUBLIC_APPROVAL_TOKEN ?? '';

async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

async function replay<T>(file: string): Promise<T> {
  const res = await fetch(`/replay/${file}`);
  if (!res.ok) throw new Error(`Replay file ${file} is missing`);
  return (await res.json()) as T;
}

const post = (body: unknown = {}, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers,
});

export const api = {
  listRuns: () => (MODE === 'replay' ? replay<Run[]>('runs.json') : http<Run[]>('/api/runs')),
  getRun: (id: string) => (MODE === 'replay' ? replay<RunAggregate>(`${id}.json`) : http<RunAggregate>(`/api/runs/${id}`)),
  providers: () => (MODE === 'replay' ? replay<ProviderCapabilities[]>('providers.json') : http<ProviderCapabilities[]>('/api/providers')),
  decide: (approvalId: string, decision: 'approved' | 'rejected', comment?: string) =>
    http<Approval>(`/api/approvals/${approvalId}/decision`, post({ decision, decidedBy: 'developer', comment }, { 'x-approval-token': TOKEN })),
  verify: (runId: string) => http(`/api/runs/${runId}/verify`, post()),
  logs: (runId: string, provider: ProviderId) => http<{ lines: string[] }>(`/api/runs/${runId}/logs?provider=${provider}&lines=60`),
  syncIncidents: () => http<{ imported: number; open: number; note?: string }>('/api/incidents/sync', post()),
  injectFault: (runId: string, provider: ProviderId) => http('/api/demo/fault', post({ runId, provider }, { 'x-approval-token': TOKEN })),
  exportEvidence: (runId: string) => http<{ json: string; markdown: string }>(`/api/runs/${runId}/export`, post()),
};

/** Live audit events (SSE). Returns an unsubscribe function. No-op in replay mode. */
export function subscribeEvents(onEvent: (event: RunEvent) => void): () => void {
  if (MODE === 'replay' || typeof window === 'undefined') return () => {};
  const source = new EventSource(`${API}/api/events/stream`);
  source.addEventListener('run-event', (msg) => onEvent(JSON.parse((msg as MessageEvent<string>).data) as RunEvent));
  return () => source.close();
}
```

- [ ] **Step 2: Create `apps/control-center/lib/use-run.ts`**

```ts
/**
 * @file      apps/control-center/lib/use-run.ts
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   React hook: loads a RunAggregate and keeps it fresh (SSE-triggered refetch, debounced; 10 s poll fallback).
 * @depends   react, ./api
 * @usedBy    app/run/page.tsx
 * @agentNotes Refetching the whole aggregate is intentional (simple + always consistent).
 */
'use client';
import { useCallback, useEffect, useState } from 'react';
import type { RunAggregate } from '@bobops/core';
import { MODE, api, subscribeEvents } from './api';
import { errorText } from './format';

export function useRun(runId: string | null) {
  const [data, setData] = useState<RunAggregate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!runId) return;
    try {
      setData(await api.getRun(runId));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [runId]);

  useEffect(() => {
    void refresh();
    if (!runId || MODE === 'replay') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeEvents((event) => {
      if (event.runId !== runId) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    });
    const poll = setInterval(() => void refresh(), 10_000);
    return () => {
      unsubscribe();
      clearInterval(poll);
      clearTimeout(timer);
    };
  }, [runId, refresh]);

  return { data, error, refresh };
}
```

- [ ] **Step 3: Create `apps/control-center/lib/format.ts`**

```ts
/**
 * @file      apps/control-center/lib/format.ts
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Tiny display helpers.
 * @depends   —
 * @usedBy    components
 * @agentNotes Keep pure.
 */
export const fmtTime = (iso?: string): string =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const json = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
```

### Task 11.4 — UI primitives

- [ ] **Step 1: Create `apps/control-center/components/ui.tsx`**

```tsx
/**
 * @file      apps/control-center/components/ui.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Shared visual primitives: Panel, StateBadge, KindChip, ActorBadge, ProviderBadge, SeverityDot.
 * @depends   clsx, @bobops/core (types)
 * @usedBy    all components
 * @agentNotes Colour semantics: purple=Bob, blue=IBM Cloud, orange=AWS, green=verified, red=incident, yellow=needs human.
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { Actor, EventKind, ProviderId, RunState, Severity } from '@bobops/core';

export function Panel({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-layer">
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {right}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

const STATE_TONE: Record<RunState, string> = {
  created: 'bg-layer-2 text-fg',
  analyzed: 'bg-info/15 text-info',
  awaiting_approval: 'bg-warn/15 text-warn',
  approved: 'bg-info/15 text-info',
  rejected: 'bg-bad/15 text-bad',
  deploying: 'bg-ibm/25 text-ibm-soft',
  verifying: 'bg-ibm/25 text-ibm-soft',
  healthy: 'bg-ok/15 text-ok',
  failed: 'bg-bad/15 text-bad',
  incident: 'bg-bad/15 text-bad',
  awaiting_remediation_approval: 'bg-warn/15 text-warn',
  remediating: 'bg-ibm/25 text-ibm-soft',
};

export function StateBadge({ state }: { state: RunState }) {
  return <span className={clsx('rounded px-2 py-0.5 font-mono text-xs uppercase', STATE_TONE[state])}>{state.replace(/_/g, ' ')}</span>;
}

const KIND_TONE: Record<EventKind, string> = {
  observation: 'border-info/50 text-info',
  inference: 'border-bob/50 text-bob',
  proposal: 'border-warn/50 text-warn',
  action: 'border-ibm-soft/50 text-ibm-soft',
  verification: 'border-ok/50 text-ok',
};

export function KindChip({ kind }: { kind: EventKind }) {
  return <span className={clsx('rounded border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider', KIND_TONE[kind])}>{kind}</span>;
}

const ACTOR: Record<Actor, { label: string; cls: string }> = {
  bob: { label: '◆ IBM Bob', cls: 'bg-bob/15 text-bob' },
  human: { label: '● Developer', cls: 'bg-layer-2 text-fg' },
  orchestrator: { label: '▣ Orchestrator', cls: 'bg-layer-2 text-muted' },
  sentinel: { label: '⏱ GitHub Sentinel', cls: 'bg-warn/15 text-warn' },
  'provider:ibm-cloud': { label: 'IBM Cloud', cls: 'bg-ibm/25 text-ibm-soft' },
  'provider:aws': { label: 'AWS', cls: 'bg-aws/15 text-aws' },
};

export function ActorBadge({ actor }: { actor: Actor }) {
  const a = ACTOR[actor];
  return <span className={clsx('rounded px-1.5 py-px text-[10px] font-semibold', a.cls)}>{a.label}</span>;
}

const PROVIDER: Record<ProviderId, { label: string; dot: string }> = {
  'ibm-cloud': { label: 'IBM Cloud', dot: 'bg-ibm' },
  aws: { label: 'AWS', dot: 'bg-aws' },
};

export function ProviderBadge({ provider }: { provider: ProviderId }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold">
      <span className={clsx('h-2.5 w-2.5 rounded-full', PROVIDER[provider].dot)} />
      {PROVIDER[provider].label}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: Severity }) {
  const tone = severity === 'high' ? 'bg-bad' : severity === 'medium' ? 'bg-warn' : 'bg-ok';
  return <span className={clsx('mr-1 inline-block h-2 w-2 rounded-full', tone)} title={severity} />;
}
```

### Task 11.5 — Dashboard page

- [ ] **Step 1: Create `apps/control-center/components/provider-cards.tsx`**

```tsx
/**
 * @file      apps/control-center/components/provider-cards.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Provider connection cards (IBM Cloud, AWS live) + V2 roadmap slots (Vercel, Railway) — the "provider contract" story.
 * @depends   clsx, @bobops/core, ./ui
 * @usedBy    app/page.tsx
 * @agentNotes V2 cards are intentionally disabled — V1 must not claim simulated support (PRD §5).
 */
import clsx from 'clsx';
import type { ProviderCapabilities } from '@bobops/core';
import { ProviderBadge } from './ui';

const V2 = ['Vercel', 'Railway'];

export function ProviderCards({ providers }: { providers: ProviderCapabilities[] | null }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {providers === null && <div className="rounded-lg border border-line bg-layer p-4 text-xs text-muted">Checking providers…</div>}
      {(providers ?? []).map((p) => (
        <div key={p.provider} className="rounded-lg border border-line bg-layer p-4">
          <div className="flex items-center justify-between">
            <ProviderBadge provider={p.provider} />
            <span className={clsx('font-mono text-[10px]', p.authenticated ? 'text-ok' : 'text-bad')}>
              {p.authenticated ? '● connected' : '● not connected'}
            </span>
          </div>
          <p className="mt-2 text-sm">{p.displayName}</p>
          <p className="text-xs text-muted">
            {p.region}
            {p.account ? ` · ${p.account}` : ''}
          </p>
          <p className="mt-2 text-[10px] text-muted">{p.services.join(' · ')}</p>
          {!p.authenticated && p.notes[0] && <p className="mt-2 text-[10px] text-bad">{p.notes[0]}</p>}
        </div>
      ))}
      {V2.map((name) => (
        <div key={name} className="rounded-lg border border-dashed border-line p-4 opacity-60">
          <span className="text-sm font-semibold">{name}</span>
          <p className="mt-2 text-xs text-muted">V2 adapter · same provider contract, no workflow changes</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/control-center/components/runs-table.tsx`**

```tsx
/**
 * @file      apps/control-center/components/runs-table.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   List of deployment runs with state and a link to the run page.
 * @depends   next/link, @bobops/core, ./ui, @/lib/format
 * @usedBy    app/page.tsx
 * @agentNotes Empty state teaches the judge how a run is started (from IBM Bob, not from this UI).
 */
import Link from 'next/link';
import type { Run } from '@bobops/core';
import { fmtTime } from '@/lib/format';
import { StateBadge } from './ui';

export function RunsTable({ runs }: { runs: Run[] }) {
  if (!runs.length) {
    return (
      <p className="text-sm text-muted">
        No runs yet. In IBM Bob choose <b className="text-bob">🛰️ Multi-Cloud DevOps Engineer</b> and type{' '}
        <code className="font-mono text-bob">/deploy apps/demo-service</code>.
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
        <tr>
          <th className="py-2">Run</th>
          <th>Project</th>
          <th>Targets</th>
          <th>State</th>
          <th>Created</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} className="border-t border-line">
            <td className="py-2 font-mono text-xs">{r.id}</td>
            <td>{r.projectName}</td>
            <td className="text-xs text-muted">{r.targets.join(' + ')}</td>
            <td>
              <StateBadge state={r.state} />
            </td>
            <td className="text-xs text-muted">{fmtTime(r.createdAt)}</td>
            <td className="text-right">
              <Link href={`/run?id=${r.id}`} className="text-info hover:underline">
                Open →
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Replace `apps/control-center/app/page.tsx`**

```tsx
/**
 * @file      apps/control-center/app/page.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Home: product promise, provider connections (+V2 slots), how-it-works, and all runs (live via SSE).
 * @depends   react, @bobops/core, @/lib/api, components
 * @usedBy    route "/"
 * @agentNotes Runs are created by Bob (MCP), not here — the UI is for oversight and approvals.
 */
'use client';
import { useEffect, useState } from 'react';
import type { ProviderCapabilities, Run } from '@bobops/core';
import { ProviderCards } from '@/components/provider-cards';
import { RunsTable } from '@/components/runs-table';
import { Panel } from '@/components/ui';
import { API, MODE, api, subscribeEvents } from '@/lib/api';
import { errorText } from '@/lib/format';

const STEPS = [
  ['1 · Understand', 'Bob runs 4 specialist subagents in parallel over your repo and synthesizes one application profile.'],
  ['2 · You approve', 'Bob proposes one plan. It is hashed; only a human here can approve it. Bob has no approve tool.'],
  ['3 · Deploy + verify', 'Tests gate the release; IBM Cloud Code Engine and AWS Lambda deploy in parallel; health is proven.'],
  ['4 · Recover', 'A GitHub sentinel files incidents with evidence; Bob diagnoses, you approve the fix, it is re-verified.'],
];

export default function Home() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [providers, setProviders] = useState<ProviderCapabilities[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api
        .listRuns()
        .then((r) => {
          setRuns(r);
          setError(null);
        })
        .catch((err) => setError(errorText(err)));
    void load();
    api.providers().then(setProviders).catch(() => setProviders([]));
    return subscribeEvents(() => void load());
  }, []);

  return (
    <div className="space-y-8">
      <section>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-bob">IBM Bob · agentic DevOps</p>
        <h1 className="mt-2 max-w-4xl text-3xl font-semibold leading-tight">
          Repository → verified IBM Cloud + AWS deployment → evidence-driven recovery
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted">
          Bob is the DevOps engineer, you are the approver, and the orchestrator is the enforcement layer. Every claim is
          evidence; every cloud change is approved.
        </p>
      </section>

      <ProviderCards providers={providers} />

      <div className="grid gap-3 md:grid-cols-4">
        {STEPS.map(([title, text]) => (
          <div key={title} className="rounded-lg border border-line bg-layer p-4">
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-xs text-muted">{text}</p>
          </div>
        ))}
      </div>

      <Panel title="Deployment runs" subtitle="Live — updates as Bob and the orchestrator work">
        {error && MODE === 'live' && (
          <p className="mb-3 text-sm text-bad">
            Orchestrator not reachable at {API} ({error}). Start it with <code className="font-mono">pnpm dev:api</code>.
          </p>
        )}
        {runs ? <RunsTable runs={runs} /> : <p className="text-sm text-muted">Loading…</p>}
      </Panel>
    </div>
  );
}
```

### Task 11.6 — Run page components

- [ ] **Step 1: Create `apps/control-center/components/lifecycle-stepper.tsx`**

```tsx
/**
 * @file      apps/control-center/components/lifecycle-stepper.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   The 8-stage lifecycle bar (PRD §3). Stage done = at least one event of that stage; current = stage of run state.
 * @depends   clsx, @bobops/core (LIFECYCLE_STAGES, stageForEvent, stageForState)
 * @usedBy    app/run/page.tsx
 * @agentNotes RECOVER shows "standby" until an incident exists — recovery is a stage, not the product's identity.
 */
import clsx from 'clsx';
import { LIFECYCLE_STAGES, stageForEvent, stageForState, type RunAggregate } from '@bobops/core';

export function LifecycleStepper({ agg }: { agg: RunAggregate }) {
  const reached = new Set(agg.events.map((e) => stageForEvent(e.type)).filter(Boolean));
  const current = stageForState(agg.run.state);
  const settled = agg.run.state === 'healthy';
  const failed = agg.run.state === 'failed' || agg.run.state === 'incident';
  const recovered = agg.incidents.some((i) => i.status === 'resolved');

  return (
    <ol className="grid grid-cols-4 gap-2 md:grid-cols-8">
      {LIFECYCLE_STAGES.map((stage, i) => {
        const isCurrent = stage === current && !settled;
        const done = reached.has(stage) && !isCurrent;
        const label =
          stage === 'RECOVER' && recovered ? 'recovered ✓' : isCurrent ? (failed ? 'attention' : 'in progress') : done ? 'done' : stage === 'RECOVER' ? 'standby' : 'pending';
        return (
          <li
            key={stage}
            className={clsx(
              'rounded-md border bg-layer px-3 py-2',
              isCurrent ? (failed ? 'border-bad text-bad' : 'border-ibm text-ibm-soft') : done ? 'border-ok/60 text-ok' : 'border-line text-muted',
            )}
          >
            <div className="font-mono text-[10px] opacity-70">{String(i + 1).padStart(2, '0')}</div>
            <div className="text-xs font-semibold tracking-wider">{stage}</div>
            <div className={clsx('mt-0.5 text-[10px]', isCurrent && !failed && 'animate-pulse')}>{label}</div>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: Create `apps/control-center/components/metrics-strip.tsx`**

```tsx
/**
 * @file      apps/control-center/components/metrics-strip.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Business-value numbers (time to verified multi-cloud, MTTR, approvals, Bob actions, unsafe actions blocked).
 * @depends   @bobops/core (computeMetrics, formatDuration)
 * @usedBy    app/run/page.tsx
 * @agentNotes These numbers are quoted in the pitch — keep labels honest (time includes human approval time).
 */
import { computeMetrics, formatDuration, type RunAggregate } from '@bobops/core';

export function MetricsStrip({ agg }: { agg: RunAggregate }) {
  const m = computeMetrics(agg);
  const items: Array<[string, string]> = [
    ['Run → verified on all clouds', m.timeToHealthyMs !== undefined ? formatDuration(m.timeToHealthyMs) : '—'],
    ['Mean time to recovery', m.mttrMs !== undefined ? formatDuration(m.mttrMs) : '—'],
    ['Clouds healthy', `${m.providersLive} / ${agg.run.targets.length}`],
    ['Human approvals', String(m.approvals)],
    ['Bob actions logged', String(m.bobActions)],
    ['Unsafe actions blocked', String(m.guardBlocks)],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-line bg-layer px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
          <div className="mt-1 font-mono text-xl">{value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/control-center/components/approval-queue.tsx`**

```tsx
/**
 * @file      apps/control-center/components/approval-queue.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   THE human approval gate UI: pending plan/remediation approvals with hash, risk, comment, Approve/Reject.
 * @depends   react, @bobops/core, @/lib/api, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes This is the only place approvals can be decided (Bob's MCP bridge has no approve tool).
 */
'use client';
import { useState } from 'react';
import type { RunAggregate } from '@bobops/core';
import { MODE, api } from '@/lib/api';
import { errorText } from '@/lib/format';
import { Panel } from './ui';

export function ApprovalQueue({ agg, onDecided }: { agg: RunAggregate; onDecided: () => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = agg.approvals.filter((a) => a.status === 'pending');
  const decided = agg.approvals.filter((a) => a.status !== 'pending').slice(-4).reverse();
  if (!pending.length && !decided.length) return null;

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusy(id + decision);
    setError(null);
    try {
      await api.decide(id, decision, comment || undefined);
      setComment('');
      onDecided();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Approval gates" subtitle="Bob proposes. You decide. Approvals are bound to the exact hash of what you reviewed.">
      {pending.map((a) => (
        <div key={a.id} className="mb-4 rounded-md border border-warn/70 bg-warn/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-warn">
              {a.kind === 'deploy_plan' ? '⚑ Deployment plan approval' : '⚑ Remediation approval'}
            </span>
            <span className="font-mono text-[10px] text-muted">
              risk {a.risk} · sha256 {a.subjectHash.slice(0, 12)}…
            </span>
          </div>
          <p className="mt-2 text-sm">{a.summary}</p>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional note for Bob (e.g. why you reject)"
            disabled={MODE === 'replay'}
            className="mt-3 w-full rounded border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-ibm"
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => decide(a.id, 'approved')}
              disabled={busy !== null || MODE === 'replay'}
              className="rounded bg-ibm px-4 py-2 text-sm font-medium hover:bg-ibm/80 disabled:opacity-50"
            >
              {busy === a.id + 'approved' ? 'Approving…' : 'Approve'}
            </button>
            <button
              onClick={() => decide(a.id, 'rejected')}
              disabled={busy !== null || MODE === 'replay'}
              className="rounded border border-line-strong px-4 py-2 text-sm hover:border-bad hover:text-bad disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
      {error && <p className="mb-2 text-sm text-bad">{error}</p>}
      {decided.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {decided.map((a) => (
            <li key={a.id}>
              • {a.kind === 'deploy_plan' ? 'Plan' : 'Remediation'} <b className={a.status === 'approved' ? 'text-ok' : 'text-bad'}>{a.status}</b> by{' '}
              {a.decidedBy}
              {a.comment ? ` — "${a.comment}"` : ''} <span className="font-mono">({a.subjectHash.slice(0, 8)})</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
```

- [ ] **Step 4: Create `apps/control-center/components/analysis-panel.tsx`**

```tsx
/**
 * @file      apps/control-center/components/analysis-panel.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   UNDERSTAND view: Bob's synthesized app profile + one card per parallel specialist subagent (with evidence refs).
 * @depends   @bobops/core, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes Specialist cards are the visible proof of Bob's subagents — keep the evidence line.
 */
import type { RunAggregate, Specialist } from '@bobops/core';
import { Panel } from './ui';

const ICON: Record<Specialist, string> = {
  'application-analyst': '⌘',
  'cloud-architect': '☁',
  'security-reviewer': '⛨',
  'release-verifier': '✓',
  'incident-investigator': '⌕',
};

export function AnalysisPanel({ agg }: { agg: RunAggregate }) {
  const p = agg.run.profile;
  if (!p) {
    return (
      <Panel title="UNDERSTAND — Bob's repository analysis" subtitle="Waiting for Bob's specialist subagents…">
        <p className="text-sm text-muted">No analysis recorded yet.</p>
      </Panel>
    );
  }
  const facts: Array<[string, string]> = [
    ['Runtime', `${p.runtime} ${p.runtimeVersion}`],
    ['Framework', p.framework],
    ['Build', p.buildCommand],
    ['Start', p.startCommand],
    ['Port', String(p.port)],
    ['Health', p.healthPath],
    ['Required env', p.requiredEnv.join(', ') || '—'],
    ['Secrets', p.secretEnv.join(', ') || '—'],
  ];
  return (
    <Panel
      title="UNDERSTAND — Bob's repository analysis"
      subtitle={`${p.specialistFindings.length} specialist subagents ran in parallel; Bob synthesized one profile`}
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
            <dd className="font-mono text-xs">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {p.specialistFindings.map((f) => (
          <article key={f.specialist} className="rounded-md border border-line bg-canvas p-4">
            <header className="flex items-center justify-between">
              <span className="text-sm font-semibold text-bob">
                {ICON[f.specialist]} {f.specialist}
              </span>
              <span className="font-mono text-[10px] text-muted">confidence: {f.confidence}</span>
            </header>
            <p className="mt-2 text-sm">{f.summary}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
              {f.findings.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            {f.evidence.length > 0 && <p className="mt-2 break-all font-mono text-[10px] text-info">{f.evidence.join(' · ')}</p>}
          </article>
        ))}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 5: Create `apps/control-center/components/plan-panel.tsx`**

```tsx
/**
 * @file      apps/control-center/components/plan-panel.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   PLAN view: per-cloud ARCHITECTURE CHOICE (with the rationale Bob gave for it vs. the other real option),
 *            resources, env, secret refs, risks, generated assets, rollback, gates, cost.
 * @depends   @bobops/core, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes Secret refs render as 🔒 names only — values never reach the UI. The kind badge + rationale are the
 *             centerpiece of this panel: they are the proof that Bob made a real decision, not a fixed mapping.
 */
import { describeService, servicesForProvider, type RunAggregate } from '@bobops/core';
import { Panel, ProviderBadge, SeverityDot } from './ui';

export function PlanPanel({ agg }: { agg: RunAggregate }) {
  const plan = agg.run.plan;
  if (!plan) return null;
  return (
    <Panel
      title="PLAN — synthesized deployment plan"
      subtitle={plan.summary}
      right={<span className="font-mono text-[10px] text-muted">sha256 {agg.run.planHash?.slice(0, 12)}…</span>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {plan.targets.map((t) => {
          const chosen = describeService(t.service);
          const alternative = servicesForProvider(t.provider).find((s) => s.service !== t.service);
          return (
            <div key={t.provider} className="rounded-md border border-line bg-canvas p-4">
              <div className="flex items-center justify-between">
                <ProviderBadge provider={t.provider} />
                <span className="font-mono text-xs text-muted">{t.region}</span>
              </div>
              <p className="mt-2 font-mono text-sm">{t.appName}</p>
              <div className="mt-3 flex items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${chosen.kind === 'warm' ? 'bg-ok/15 text-ok' : 'bg-info/15 text-info'}`}
                >
                  {chosen.kind === 'warm' ? '● always warm' : '◐ cost-optimized'}
                </span>
                <span className="text-xs font-semibold">{chosen.label}</span>
              </div>
              <p className="mt-2 rounded bg-bob/10 p-2 text-xs">
                <span className="font-semibold text-bob">Why this architecture: </span>
                {t.architectureRationale}
              </p>
              {alternative && (
                <p className="mt-1 text-[10px] text-muted">
                  Not chosen: <span className="font-mono">{alternative.label}</span> — {alternative.description}
                </p>
              )}
              <table className="mt-3 w-full text-xs">
                <tbody>
                  {t.resources.map((r) => (
                    <tr key={r.type + r.name} className="border-t border-line">
                      <td className="py-1 pr-2 text-muted">{r.action}</td>
                      <td className="py-1 pr-2">{r.type}</td>
                      <td className="py-1 font-mono">{r.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex flex-wrap gap-1">
                {Object.entries(t.env).map(([k, v]) => (
                  <span key={k} className="rounded bg-layer-2 px-2 py-0.5 font-mono text-[10px]">
                    {k}={v}
                  </span>
                ))}
                {t.secretRefs.map((s) => (
                  <span key={s} className="rounded bg-bob/15 px-2 py-0.5 font-mono text-[10px] text-bob">
                    🔒 {s}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-5 grid gap-6 text-sm md:grid-cols-3">
        <div>
          <h3 className="text-[10px] uppercase tracking-wider text-muted">Risks</h3>
          <ul className="mt-2 space-y-2">
            {plan.risks.map((r) => (
              <li key={r.id}>
                <SeverityDot severity={r.severity} />
                {r.title}
                <p className="text-xs text-muted">↳ {r.mitigation}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-[10px] uppercase tracking-wider text-muted">Generated by Bob</h3>
          <ul className="mt-2 space-y-1 text-xs">
            {plan.generatedAssets.map((a) => (
              <li key={a.path}>
                <span className="font-mono text-info">{a.path}</span> — {a.purpose}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-[10px] uppercase tracking-wider text-muted">Rollback &amp; approval gates</h3>
          <p className="mt-2 text-xs">{plan.rollbackStrategy}</p>
          <ul className="mt-2 list-disc pl-4 text-xs text-warn">
            {plan.approvalGates.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          {plan.estimatedMonthlyCostUsd !== undefined && (
            <p className="mt-2 text-xs text-muted">Estimated cost ≈ ${plan.estimatedMonthlyCostUsd}/month</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 6: Create `apps/control-center/components/deployments-panel.tsx`**

```tsx
/**
 * @file      apps/control-center/components/deployments-panel.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   DEPLOY + VERIFY view: live endpoint per cloud, revision, HTTP health + latency, re-verify, demo fault control.
 * @depends   react, clsx, @bobops/core, @/lib/api, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes The ⚡ fault button only renders with ?demo=1 in LIVE mode (presenter control, human token).
 */
'use client';
import clsx from 'clsx';
import { useState } from 'react';
import type { Deployment, HealthCheck, ProviderId, RunAggregate } from '@bobops/core';
import { MODE, api } from '@/lib/api';
import { errorText, fmtTime } from '@/lib/format';
import { Panel, ProviderBadge } from './ui';

export function DeploymentsPanel({ agg, onChanged, demo }: { agg: RunAggregate; onChanged: () => void; demo: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const latest = new Map<ProviderId, Deployment>();
  for (const d of agg.deployments) latest.set(d.provider, d);
  const health = new Map<ProviderId, HealthCheck>();
  for (const h of agg.healthChecks) health.set(h.provider, h);
  if (!latest.size) return null;

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title="DEPLOY + VERIFY — live environments"
      subtitle="Provider-native status plus independent HTTP health probes"
      right={
        MODE === 'live' ? (
          <button onClick={() => act('verify', () => api.verify(agg.run.id))} className="rounded border border-line-strong px-3 py-1 text-xs hover:border-ibm">
            {busy === 'verify' ? 'Verifying…' : 'Re-verify now'}
          </button>
        ) : undefined
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {[...latest.values()].map((d) => {
          const h = health.get(d.provider);
          return (
            <div key={d.provider} className={clsx('rounded-md border bg-canvas p-4', h ? (h.ok ? 'border-ok/60' : 'border-bad/80') : 'border-line')}>
              <div className="flex items-center justify-between">
                <ProviderBadge provider={d.provider} />
                <span className={clsx('font-mono text-xs', d.status === 'succeeded' ? 'text-ok' : d.status === 'failed' ? 'text-bad' : 'text-ibm-soft')}>
                  {d.status.replace('_', ' ')}
                </span>
              </div>
              {d.endpoint && (
                <a
                  href={`${d.endpoint.replace(/\/$/, '')}${d.healthPath}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block truncate font-mono text-xs text-info hover:underline"
                >
                  {d.endpoint}
                </a>
              )}
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted">Revision</dt>
                  <dd className="truncate font-mono">{d.revision ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted">Health</dt>
                  <dd className={clsx('font-mono', h?.ok ? 'text-ok' : 'text-bad')}>
                    {h ? (h.statusCode ? `HTTP ${h.statusCode}` : 'no response') : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Latency</dt>
                  <dd className="font-mono">{h ? `${h.latencyMs} ms` : '—'}</dd>
                </div>
              </dl>
              {h && <p className="mt-2 text-[10px] text-muted">checked {fmtTime(h.checkedAt)}</p>}
              {d.error && <p className="mt-2 text-xs text-bad">{d.error}</p>}
              {d.note && <p className="mt-1 text-[10px] text-muted">last change: {d.note}</p>}
              {demo && MODE === 'live' && d.status === 'succeeded' && (
                <button
                  onClick={() => act(`fault-${d.provider}`, () => api.injectFault(agg.run.id, d.provider))}
                  className="mt-3 rounded border border-bad/70 px-3 py-1 text-xs text-bad hover:bg-bad/10"
                >
                  {busy === `fault-${d.provider}` ? 'Injecting…' : '⚡ Inject controlled fault (demo)'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {message && <p className="mt-3 text-sm text-bad">{message}</p>}
    </Panel>
  );
}
```

- [ ] **Step 7: Create `apps/control-center/components/incidents-panel.tsx`**

```tsx
/**
 * @file      apps/control-center/components/incidents-panel.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   RECOVER view: incidents (sentinel/orchestrator), failing probes, GitHub issue link, Bob's diagnosis, remediation.
 * @depends   react, clsx, @bobops/core, @/lib/api, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes "Sync sentinel" pulls GitHub issues immediately (the orchestrator also syncs every 60 s).
 */
'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { describeAction, formatDuration, type RunAggregate } from '@bobops/core';
import { MODE, api } from '@/lib/api';
import { errorText, fmtTime } from '@/lib/format';
import { Panel, ProviderBadge } from './ui';

export function IncidentsPanel({ agg, onChanged }: { agg: RunAggregate; onChanged: () => void }) {
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const showSync = MODE === 'live' && ['healthy', 'incident', 'failed'].includes(agg.run.state);
  if (!agg.incidents.length && !showSync) return null;

  async function sync() {
    try {
      const r = await api.syncIncidents();
      setSyncNote(r.note ?? `Imported ${r.imported} of ${r.open} open sentinel issue(s)`);
      onChanged();
    } catch (err) {
      setSyncNote(errorText(err));
    }
  }

  return (
    <Panel
      title="RECOVER — incidents"
      subtitle="Detected by the GitHub health sentinel or orchestrator probes · diagnosed by Bob · fixed only after approval"
      right={
        showSync ? (
          <button onClick={sync} className="rounded border border-line-strong px-3 py-1 text-xs hover:border-warn">
            Sync sentinel
          </button>
        ) : undefined
      }
    >
      {syncNote && <p className="mb-3 text-xs text-muted">{syncNote}</p>}
      {!agg.incidents.length && <p className="text-sm text-muted">No incidents. The sentinel probes every endpoint every 5 minutes.</p>}
      <div className="space-y-4">
        {agg.incidents
          .slice()
          .reverse()
          .map((i) => (
            <article key={i.id} className={clsx('rounded-md border p-4', i.status === 'resolved' ? 'border-ok/60' : 'border-bad/80 bg-bad/5')}>
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <ProviderBadge provider={i.provider} />
                  <span className="text-sm font-semibold">{i.title}</span>
                </div>
                <span className={clsx('rounded px-2 py-0.5 font-mono text-[10px] uppercase', i.status === 'resolved' ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad')}>
                  {i.status.replace(/_/g, ' ')}
                </span>
              </header>
              <p className="mt-1 text-xs text-muted">
                opened {fmtTime(i.openedAt)} by {i.source === 'sentinel' ? 'the GitHub health sentinel' : 'an orchestrator probe'}
                {i.githubIssueUrl && (
                  <>
                    {' · '}
                    <a href={i.githubIssueUrl} target="_blank" rel="noreferrer" className="text-info hover:underline">
                      GitHub issue #{i.githubIssueNumber}
                    </a>
                  </>
                )}
                {i.resolvedAt && ` · resolved ${fmtTime(i.resolvedAt)} (MTTR ${formatDuration(Date.parse(i.resolvedAt) - Date.parse(i.openedAt))})`}
              </p>
              <table className="mt-3 w-full text-xs">
                <tbody>
                  {i.probes.slice(-4).map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="py-1 pr-2 font-mono text-muted">{fmtTime(p.checkedAt)}</td>
                      <td className={clsx('py-1 pr-2 font-mono', p.ok ? 'text-ok' : 'text-bad')}>{p.statusCode || 'ERR'}</td>
                      <td className="py-1 pr-2 font-mono">{p.latencyMs} ms</td>
                      <td className="truncate py-1 font-mono text-muted">{p.error ?? JSON.stringify(p.body ?? '').slice(0, 110)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {i.diagnosis && (
                <div className="mt-3 rounded bg-bob/10 p-3 text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-bob">◆ Bob&apos;s diagnosis · {i.diagnosis.confidence} confidence</div>
                  <p className="mt-1">{i.diagnosis.rootCause}</p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-muted">
                    {i.diagnosis.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {i.remediation && (
                <div className="mt-3 rounded bg-layer-2 p-3 text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-warn">Remediation · {i.remediation.status}</div>
                  <p className="mt-1 font-mono text-xs">{describeAction(i.remediation.action)}</p>
                  <p className="text-xs text-muted">{i.remediation.rationale}</p>
                </div>
              )}
            </article>
          ))}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 8: Create `apps/control-center/components/logs-panel.tsx`**

```tsx
/**
 * @file      apps/control-center/components/logs-panel.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Runtime logs per provider (Code Engine / CloudWatch), fetched on demand.
 * @depends   react, clsx, @bobops/core, @/lib/api, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes Hidden in replay mode (logs are live-only).
 */
'use client';
import clsx from 'clsx';
import { useState } from 'react';
import type { ProviderId, RunAggregate } from '@bobops/core';
import { MODE, api } from '@/lib/api';
import { errorText } from '@/lib/format';
import { Panel } from './ui';

export function LogsPanel({ agg }: { agg: RunAggregate }) {
  const [active, setActive] = useState<ProviderId | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providers = [...new Set(agg.deployments.filter((d) => d.status === 'succeeded').map((d) => d.provider))];
  if (!providers.length || MODE === 'replay') return null;

  async function load(provider: ProviderId) {
    setActive(provider);
    setLoading(true);
    setError(null);
    try {
      setLines((await api.logs(agg.run.id, provider)).lines);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      title="Runtime logs"
      subtitle="Fetched live from Code Engine / CloudWatch"
      right={
        <div className="flex gap-2">
          {providers.map((p) => (
            <button key={p} onClick={() => load(p)} className={clsx('rounded px-3 py-1 text-xs', active === p ? 'bg-ibm' : 'border border-line-strong')}>
              {p}
            </button>
          ))}
        </div>
      }
    >
      {loading ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : error ? (
        <p className="text-xs text-bad">{error}</p>
      ) : active ? (
        <pre className="max-h-72 overflow-auto rounded bg-canvas p-3 font-mono text-[11px] leading-relaxed">{lines.join('\n') || '(no log lines)'}</pre>
      ) : (
        <p className="text-xs text-muted">Choose a provider to load its recent logs.</p>
      )}
    </Panel>
  );
}
```

- [ ] **Step 9: Create `apps/control-center/components/audit-trail.tsx`**

```tsx
/**
 * @file      apps/control-center/components/audit-trail.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   The audit trail: every event with actor, evidence kind, message and expandable evidence JSON; kind filter; export.
 * @depends   react, clsx, @bobops/core, @/lib/api, ./ui
 * @usedBy    app/run/page.tsx
 * @agentNotes This panel is the closing shot of the demo (repository → plan → approval → deployment → incident → recovery).
 */
'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { EventKindSchema, type EventKind, type RunAggregate } from '@bobops/core';
import { MODE, api } from '@/lib/api';
import { errorText, fmtTime, json } from '@/lib/format';
import { ActorBadge, KindChip, Panel } from './ui';

const FILTERS: Array<EventKind | 'all'> = ['all', ...EventKindSchema.options];

export function AuditTrail({ agg }: { agg: RunAggregate }) {
  const [filter, setFilter] = useState<EventKind | 'all'>('all');
  const [note, setNote] = useState<string | null>(null);
  const events = agg.events
    .slice()
    .reverse()
    .filter((e) => filter === 'all' || e.kind === filter);

  async function exportTrail() {
    try {
      const r = await api.exportEvidence(agg.run.id);
      setNote(`Saved ${r.markdown}`);
    } catch (err) {
      setNote(errorText(err));
    }
  }

  return (
    <aside className="xl:sticky xl:top-6 xl:self-start">
      <Panel
        title="Audit trail"
        subtitle="Observation · inference · proposal · action · verification — with evidence"
        right={
          MODE === 'live' ? (
            <button onClick={exportTrail} className="rounded border border-line-strong px-3 py-1 text-xs hover:border-ok">
              Export
            </button>
          ) : undefined
        }
      >
        <div className="mb-3 flex flex-wrap gap-1">
          {FILTERS.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={clsx('rounded px-2 py-0.5 text-[10px] uppercase tracking-wider', filter === k ? 'bg-ibm text-fg' : 'bg-layer-2 text-muted')}
            >
              {k}
            </button>
          ))}
        </div>
        {note && <p className="mb-2 text-[11px] text-ok">{note}</p>}
        <ol className="max-h-[75vh] space-y-3 overflow-auto pr-1">
          {events.map((e) => (
            <li key={e.id} className={clsx('border-l-2 pl-3', e.type === 'guard.blocked' ? 'border-bad' : e.actor === 'bob' ? 'border-bob' : 'border-line')}>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span className="font-mono text-muted">{fmtTime(e.at)}</span>
                <ActorBadge actor={e.actor} />
                <KindChip kind={e.kind} />
              </div>
              <p className="mt-1 text-xs leading-relaxed">{e.message}</p>
              {e.evidence.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[10px] text-info">evidence ({e.evidence.length})</summary>
                  {e.evidence.map((ev, idx) => (
                    <div key={idx} className="mt-1">
                      <div className="text-[10px] text-muted">
                        {ev.label} · {ev.source}
                      </div>
                      <pre className="max-h-48 overflow-auto rounded bg-canvas p-2 font-mono text-[10px]">{json(ev.data)}</pre>
                    </div>
                  ))}
                </details>
              )}
            </li>
          ))}
        </ol>
      </Panel>
    </aside>
  );
}
```

### Task 11.7 — The run page

- [ ] **Step 1: Create `apps/control-center/app/run/page.tsx`**

```tsx
/**
 * @file      apps/control-center/app/run/page.tsx
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   One run, end to end: header, lifecycle, metrics, approvals, incidents, environments, plan, analysis, logs, audit.
 * @depends   next/navigation, @/lib/use-run, components
 * @usedBy    route "/run?id=<runId>[&demo=1]" (query param keeps static export simple)
 * @agentNotes Order = what needs a human first (approvals, incidents), then evidence. `demo=1` shows the fault control.
 */
'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AnalysisPanel } from '@/components/analysis-panel';
import { ApprovalQueue } from '@/components/approval-queue';
import { AuditTrail } from '@/components/audit-trail';
import { DeploymentsPanel } from '@/components/deployments-panel';
import { IncidentsPanel } from '@/components/incidents-panel';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import { LogsPanel } from '@/components/logs-panel';
import { MetricsStrip } from '@/components/metrics-strip';
import { PlanPanel } from '@/components/plan-panel';
import { StateBadge } from '@/components/ui';
import { useRun } from '@/lib/use-run';

export default function RunPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading run…</p>}>
      <RunView />
    </Suspense>
  );
}

function RunView() {
  const params = useSearchParams();
  const id = params.get('id');
  const demo = params.get('demo') === '1';
  const { data, error, refresh } = useRun(id);

  if (!id) {
    return (
      <p className="text-sm text-muted">
        No run selected. <Link href="/" className="text-info">Back to runs</Link>
      </p>
    );
  }
  if (error && !data) return <p className="text-sm text-bad">Could not load run {id}: {error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading run {id}…</p>;

  const latest = data.events.at(-1);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-muted hover:text-fg">
            ← All runs
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            {data.run.projectName} <span className="font-mono text-sm text-muted">{data.run.id}</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {data.run.objective} · <span className="font-mono">{data.run.repoPath}</span> · {data.run.targets.join(' + ')}
            {' · sentinel check-in every '}
            <span className="font-mono">{data.run.sentinelIntervalMinutes}</span> min
          </p>
        </div>
        <div className="text-right">
          <StateBadge state={data.run.state} />
          {latest && <p className="mt-2 max-w-md text-xs text-muted">Now: {latest.message}</p>}
        </div>
      </header>

      <LifecycleStepper agg={data} />
      <MetricsStrip agg={data} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <ApprovalQueue agg={data} onDecided={refresh} />
          <IncidentsPanel agg={data} onChanged={refresh} />
          <DeploymentsPanel agg={data} onChanged={refresh} demo={demo} />
          <PlanPanel agg={data} />
          <AnalysisPanel agg={data} />
          <LogsPanel agg={data} />
        </div>
        <AuditTrail agg={data} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** `pnpm install; pnpm typecheck; pnpm test` → Expected: green. (`pnpm typecheck` now also checks the control center.)

### Task 11.8 — Visual verification (HUMAN)

- [ ] **Step 1:** Make sure `apps/control-center/.env.local` has `NEXT_PUBLIC_APPROVAL_TOKEN` equal to the root `APPROVAL_TOKEN`.
- [ ] **Step 2:** `pnpm demo:golden`, then `pnpm dev` (starts API :4000 and UI :3000). Open `http://localhost:3000`.
  Expected: the hero section, two provider cards showing **● connected**, two dashed V2 cards, "How it works", and an empty runs table.
- [ ] **Step 3 (fast AWS-only loop, about 2 min):** in another terminal run
  `pnpm api:e2e --targets aws --with-recovery --ui-approval`. Open the printed Control Center link and add `&demo=1`.
  Expected, live without refreshing:
  - the header shows `sentinel check-in every 5 min` (the `api:e2e` script doesn't set a custom interval)
  - the stepper advances UNDERSTAND → PLAN, and the plan panel shows a kind badge (● always warm or ◐ cost-optimized)
    plus a "Why this architecture" rationale sentence and the alternative that was NOT chosen, for each cloud
  - the **approval card** appears with the hash. Click **Approve**.
  - TEST → PROVISION → BUILD → DEPLOY → VERIFY turn green. The AWS card shows the endpoint, HTTP 200 and the latency.
  - An incident appears (red), then the diagnosis card (purple) and a **remediation approval card**. Click **Approve**.
  - The incident turns **resolved** and shows its MTTR. The metrics strip fills in. The audit trail shows a red
    `guard.blocked` entry.
- [ ] **Step 4:** Click the audit-trail filter chips, expand some evidence, press **Export**, and load the logs for `aws`.
- [ ] **Step 5:** Stop everything, then run `pnpm demo:reset`.

## HANDOFF

```text
✅ PHASE 11 COMPLETE — Deployment Control Center
BUILT:
  - apps/control-center (Next.js 15, Tailwind v4, IBM Plex, Carbon-inspired dark theme)
  - Home (providers + V2 slots, how-it-works, runs) and Run page (stepper, metrics, approvals, incidents, environments,
    plan, analysis, logs, audit trail with evidence + export); live via SSE; replay mode ready
DO THIS (human):
  1. apps/control-center/.env.local with NEXT_PUBLIC_APPROVAL_TOKEN = APPROVAL_TOKEN
  2. pnpm demo:golden; pnpm dev → http://localhost:3000
  3. pnpm api:e2e --targets aws --with-recovery --ui-approval → open the link + &demo=1 → approve twice in the UI
EXPECT:
  - Live stepper/metrics updates; two approval cards; incident → resolved with MTTR; guard.blocked in the audit trail
IF IT FAILS:
  - CORS error in the browser console → CONTROL_CENTER_ORIGIN in .env must be http://localhost:3000
  - "Only a human using the Control Center can decide approvals" → token mismatch between .env and .env.local
  - Module not found '@bobops/core' → package.json dependency + transpilePackages in next.config.ts
  - Tailwind classes not applied → globals.css must start with @import "tailwindcss";
EVIDENCE:
  - Screenshots: home, run page mid-deploy, approval card, recovered incident → evidence/demo-runs/ui-*.png
  - Screenshot Bob's task summary → evidence/bob-task-summaries/phase-11-control-center.png
  - git add -A; git commit -m "feat(p11): control center"; git push
```
