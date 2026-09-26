/**
 * @file      apps/orchestrator/src/testing/fake-provider.ts
 * @phase     P5
 * @owner     Orchestration & Cloud
 * @purpose   In-memory CloudProvider + matching probe so the whole lifecycle is testable without clouds or network.
 * @depends   @bobops/core (types)
 * @usedBy    lifecycle.test.ts
 * @agentNotes Health rule mirrors the real demo app: healthy iff CATALOG_MODE is set in the app's env.
 */
import type {
  CloudProvider,
  DeployInput,
  DeployResult,
  DeploymentRef,
  EnvChange,
  ProbeFn,
  ProgressFn,
  ProviderCapabilities,
  ProviderId,
  ProviderStatus,
  Resource,
  TargetPlan,
} from '@bobops/core';

export class FakeProvider implements CloudProvider {
  private readonly envByApp = new Map<string, Record<string, string>>();
  private revisionCounter = 0;
  deployCalls = 0;
  failNextDeploy = false;

  constructor(readonly id: ProviderId) {}

  endpointFor(appName: string): string {
    return `https://${appName}.${this.id}.fake`;
  }

  private bump(appName: string): DeployResult {
    this.revisionCounter++;
    return { endpoint: this.endpointFor(appName), revision: `r${this.revisionCounter}`, evidence: [] };
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      provider: this.id,
      displayName: `Fake ${this.id}`,
      authenticated: true,
      region: 'fake-1',
      services: ['fake'],
      supportsRollback: true,
      notes: ['in-memory test double'],
    };
  }

  planResources(target: TargetPlan): Resource[] {
    return [{ type: 'fake-app', name: target.appName, action: 'create' }];
  }

  async deploy(input: DeployInput, progress: ProgressFn): Promise<DeployResult> {
    this.deployCalls++;
    if (this.failNextDeploy) {
      this.failNextDeploy = false;
      throw new Error('fake deploy failure');
    }
    progress({ type: 'provision.completed', message: 'fake provision' });
    progress({ type: 'build.completed', message: 'fake build' });
    this.envByApp.set(input.target.appName, { ...input.target.env, ...input.secrets });
    return this.bump(input.target.appName);
  }

  async status(ref: DeploymentRef): Promise<ProviderStatus> {
    return {
      state: 'ready',
      revision: `r${this.revisionCounter}`,
      endpoint: this.endpointFor(ref.appName),
      env: this.envByApp.get(ref.appName) ?? {},
      raw: {},
    };
  }

  async logs(): Promise<string[]> {
    return ['[fake] GET /health 200'];
  }

  async setEnv(ref: DeploymentRef, change: EnvChange, _progress: ProgressFn): Promise<DeployResult> {
    const env = { ...(this.envByApp.get(ref.appName) ?? {}), ...(change.set ?? {}) };
    for (const key of change.remove ?? []) delete env[key];
    this.envByApp.set(ref.appName, env);
    return this.bump(ref.appName);
  }

  async rollback(ref: DeploymentRef): Promise<DeployResult> {
    return this.bump(ref.appName);
  }

  isHealthy(endpoint: string): boolean {
    for (const [app, env] of this.envByApp) {
      if (endpoint.startsWith(this.endpointFor(app))) return Boolean(env.CATALOG_MODE);
    }
    return false;
  }
}

export function fakeProbe(providers: FakeProvider[]): ProbeFn {
  return async (opts) => {
    const ok = providers.find((p) => p.id === opts.provider)?.isHealthy(opts.endpoint) ?? false;
    return {
      id: crypto.randomUUID(),
      provider: opts.provider,
      endpoint: new URL(opts.healthPath, opts.endpoint).toString(),
      ok,
      statusCode: ok ? 200 : 503,
      latencyMs: 5,
      body: ok ? { status: 'healthy' } : { status: 'unhealthy', checks: { config: { ok: false, missing: ['CATALOG_MODE'] } } },
      checkedAt: new Date().toISOString(),
    };
  };
}
