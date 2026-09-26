/**
 * @file      packages/provider-ibm-cloud/src/provider.ts
 * @phase     P6
 * @owner     Orchestration & Cloud
 * @purpose   IBM Cloud Code Engine implementation of the CloudProvider contract (V1 primary cloud). This ONE class serves
 *            BOTH real IBM architectures in SERVICE_CATALOG — 'code-engine' (always-on, min-scale 1) and
 *            'code-engine-scale-to-zero' (min-scale 0) — branching on target.service / ref.service. Adding a variant
 *            never means a new class or new credentials, only a new min-scale mapping in minScaleFor().
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
  type ServiceId,
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

/** The one place the two IBM architectures differ in the actual `ibmcloud ce app` call: min-scale. */
function minScaleFor(service: ServiceId): string {
  return service === 'code-engine-scale-to-zero' ? '0' : '1';
}

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
      offeredServices: ['code-engine', 'code-engine-scale-to-zero'] as ServiceId[],
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
      { type: `code-engine-app (min-scale ${minScaleFor(target.service)})`, name: target.appName, action: 'create' },
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
    const minScale = minScaleFor(target.service);
    progress({
      type: 'build.started',
      message: `Code Engine is building ${target.appName} from source with its Dockerfile (${target.service}, min-scale ${minScale}), then will ${verb} the app (typically 2–5 min)`,
    });
    const out = await ibmcloud(
      [
        'ce', 'app', verb,
        '--name', target.appName,
        '--build-source', sourceDir,
        '--port', String(target.port),
        '--min-scale', minScale,
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
    // Re-assert min-scale from ref.service on every update: idempotent, and guards against another process (or an
    // earlier manual `ibmcloud ce app update`) having drifted the scaling mode away from what the approved plan chose.
    const args = ['ce', 'app', 'update', '--name', ref.appName, '--min-scale', minScaleFor(ref.service), '--wait-timeout', '600'];
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
    await ibmcloud(
      ['ce', 'app', 'update', '--name', ref.appName, '--image', image, '--min-scale', minScaleFor(ref.service), '--wait-timeout', '600'],
      { timeoutMs: 15 * 60_000 },
    );
    return this.resultFor(ref.appName, ref.endpoint, 'Code Engine app after rollback');
  }
}
