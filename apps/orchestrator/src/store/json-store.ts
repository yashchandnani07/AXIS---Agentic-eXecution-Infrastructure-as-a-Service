/**
 * @file      apps/orchestrator/src/store/json-store.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   Tiny persistence layer: all state in one JSON file (atomic write via tmp + rename). file=null → in-memory.
 * @depends   node:fs, @bobops/core (types), ../lib/errors
 * @usedBy    every service, routes (read-only)
 * @agentNotes Always mutate via upsert() so the file is persisted. Items are matched by `id`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Approval, Deployment, HealthCheck, Incident, Run, RunAggregate, RunEvent } from '@bobops/core';
import { NotFoundError } from '../lib/errors';

export interface StoreData {
  runs: Run[];
  approvals: Approval[];
  deployments: Deployment[];
  healthChecks: HealthCheck[];
  incidents: Incident[];
  events: RunEvent[];
}

const empty = (): StoreData => ({ runs: [], approvals: [], deployments: [], healthChecks: [], incidents: [], events: [] });

export class JsonStore {
  readonly data: StoreData;

  constructor(private readonly file: string | null) {
    this.data =
      file && fs.existsSync(file) ? { ...empty(), ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<StoreData>) } : empty();
  }

  persist(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  upsert<K extends keyof StoreData>(collection: K, item: StoreData[K][number]): void {
    const list = this.data[collection] as unknown as Array<{ id: string }>;
    const withId = item as unknown as { id: string };
    const idx = list.findIndex((x) => x.id === withId.id);
    if (idx >= 0) list[idx] = withId;
    else list.push(withId);
    this.persist();
  }

  getRun(id: string): Run {
    const run = this.data.runs.find((r) => r.id === id);
    if (!run) throw new NotFoundError(`Run ${id}`);
    return run;
  }

  getApproval(id: string): Approval {
    const approval = this.data.approvals.find((a) => a.id === id);
    if (!approval) throw new NotFoundError(`Approval ${id}`);
    return approval;
  }

  getIncident(id: string): Incident {
    const incident = this.data.incidents.find((i) => i.id === id);
    if (!incident) throw new NotFoundError(`Incident ${id}`);
    return incident;
  }

  aggregate(runId: string): RunAggregate {
    const run = this.getRun(runId);
    const mine = <T extends { runId?: string }>(list: T[]) => list.filter((x) => x.runId === runId);
    return {
      run,
      approvals: mine(this.data.approvals),
      deployments: mine(this.data.deployments),
      healthChecks: mine(this.data.healthChecks).slice(-50),
      incidents: mine(this.data.incidents),
      events: mine(this.data.events),
    };
  }
}
