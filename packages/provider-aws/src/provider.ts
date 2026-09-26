/**
 * @file      packages/provider-aws/src/provider.ts
 * @phase     P7
 * @owner     Orchestration & Cloud
 * @purpose   AWS Lambda implementation of the CloudProvider contract (V1 second cloud).
 *            deploy = esbuild bundle → create/update function → publish version → alias "live" → public Function URL.
 *            setEnv = new config → new version → alias; rollback = alias → previous version; logs = CloudWatch.
 * @depends   @aws-sdk/client-lambda, @aws-sdk/client-cloudwatch-logs, @aws-sdk/client-sts, @bobops/core, ./bundle, ./versions
 * @usedBy    apps/orchestrator/src/providers/registry.ts, scripts/smoke/deploy-aws.ts
 * @agentNotes Credentials come from the default AWS SDK chain (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in .env).
 *             A public Function URL needs TWO permissions (InvokeFunctionUrl + InvokeFunction via URL) — keep both.
 */
import path from 'node:path';
import {
  AddPermissionCommand,
  CreateAliasCommand,
  CreateFunctionCommand,
  CreateFunctionUrlConfigCommand,
  GetAliasCommand,
  GetFunctionConfigurationCommand,
  GetFunctionUrlConfigCommand,
  LambdaClient,
  ListVersionsByFunctionCommand,
  PublishVersionCommand,
  UpdateAliasCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionActiveV2,
  waitUntilFunctionUpdatedV2,
  type AddPermissionCommandInput,
} from '@aws-sdk/client-lambda';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import {
  describeEnvChange,
  evidence,
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
import { bundleLambda } from './bundle';
import { pickPreviousVersion } from './versions';

export interface AwsConfig {
  region: string;
  roleArn?: string;
}

export const LAMBDA_ALIAS = 'live';

const errorName = (err: unknown) => (err as { name?: string } | null)?.name;
const isNotFound = (err: unknown) => errorName(err) === 'ResourceNotFoundException';
const isConflict = (err: unknown) => errorName(err) === 'ResourceConflictException';

export class AwsLambdaProvider implements CloudProvider {
  readonly id = 'aws' as const;
  private readonly lambda: LambdaClient;
  private readonly logsClient: CloudWatchLogsClient;
  private readonly sts: STSClient;
  private capsCache?: { at: number; value: ProviderCapabilities };

  constructor(private readonly cfg: AwsConfig) {
    this.lambda = new LambdaClient({ region: cfg.region });
    this.logsClient = new CloudWatchLogsClient({ region: cfg.region });
    this.sts = new STSClient({ region: cfg.region });
  }

  async capabilities(): Promise<ProviderCapabilities> {
    if (this.capsCache && Date.now() - this.capsCache.at < 60_000) return this.capsCache.value;
    const base = {
      provider: 'aws' as const,
      displayName: 'AWS Lambda + Function URL',
      region: this.cfg.region,
      services: ['lambda', 'lambda-function-url', 'cloudwatch-logs'],
      supportsRollback: true,
    };
    let value: ProviderCapabilities;
    try {
      const me = await this.sts.send(new GetCallerIdentityCommand({}));
      const notes = [`Identity: ${me.Arn ?? 'unknown'}`];
      if (!this.cfg.roleArn) notes.push('AWS_LAMBDA_ROLE_ARN is not set — deployments will fail');
      value = { ...base, authenticated: true, account: me.Account, notes };
    } catch (err) {
      value = { ...base, authenticated: false, notes: [err instanceof Error ? err.message : String(err)] };
    }
    this.capsCache = { at: Date.now(), value };
    return value;
  }

  planResources(target: TargetPlan): Resource[] {
    return [
      { type: 'lambda-function', name: target.appName, action: 'create' },
      { type: 'lambda-version', name: `${target.appName}:<n>`, action: 'create' },
      { type: 'lambda-alias', name: LAMBDA_ALIAS, action: 'create' },
      { type: 'lambda-function-url', name: `${target.appName}:${LAMBDA_ALIAS}`, action: 'create' },
      { type: 'cloudwatch-log-group', name: `/aws/lambda/${target.appName}`, action: 'create' },
    ];
  }

  private async functionExists(name: string): Promise<boolean> {
    try {
      await this.lambda.send(new GetFunctionConfigurationCommand({ FunctionName: name }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  private async pointAlias(name: string, version: string): Promise<void> {
    try {
      await this.lambda.send(new GetAliasCommand({ FunctionName: name, Name: LAMBDA_ALIAS }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
      await this.lambda.send(new CreateAliasCommand({ FunctionName: name, Name: LAMBDA_ALIAS, FunctionVersion: version }));
      return;
    }
    await this.lambda.send(new UpdateAliasCommand({ FunctionName: name, Name: LAMBDA_ALIAS, FunctionVersion: version }));
  }

  private async getUrl(name: string): Promise<string | undefined> {
    try {
      const res = await this.lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: name, Qualifier: LAMBDA_ALIAS }));
      return res.FunctionUrl;
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  private async addPermission(name: string, input: Omit<AddPermissionCommandInput, 'FunctionName' | 'Qualifier'>): Promise<void> {
    try {
      await this.lambda.send(new AddPermissionCommand({ FunctionName: name, Qualifier: LAMBDA_ALIAS, ...input }));
    } catch (err) {
      if (!isConflict(err)) throw err; // statement already exists → fine
    }
  }

  private async ensureFunctionUrl(name: string, progress: ProgressFn): Promise<string> {
    const existing = await this.getUrl(name);
    if (existing) return existing;
    const created = await this.lambda.send(new CreateFunctionUrlConfigCommand({ FunctionName: name, Qualifier: LAMBDA_ALIAS, AuthType: 'NONE' }));
    await this.addPermission(name, { StatementId: 'bobops-public-url', Action: 'lambda:InvokeFunctionUrl', Principal: '*', FunctionUrlAuthType: 'NONE' });
    await this.addPermission(name, { StatementId: 'bobops-public-invoke', Action: 'lambda:InvokeFunction', Principal: '*', InvokedViaFunctionUrl: true });
    progress({ type: 'provision.completed', message: `Public Function URL created for ${name}:${LAMBDA_ALIAS}` });
    if (!created.FunctionUrl) throw new Error('Lambda did not return a Function URL');
    return created.FunctionUrl;
  }

  private async waitUpdated(name: string): Promise<void> {
    await waitUntilFunctionUpdatedV2({ client: this.lambda, maxWaitTime: 120 }, { FunctionName: name });
  }

  private async publishAndPoint(name: string, description: string): Promise<string> {
    const { Version } = await this.lambda.send(new PublishVersionCommand({ FunctionName: name, Description: description }));
    if (!Version) throw new Error('Lambda did not return a version number');
    await this.pointAlias(name, Version);
    return Version;
  }

  async deploy(input: DeployInput, progress: ProgressFn): Promise<DeployResult> {
    const { target, sourceDir, secrets } = input;
    const name = target.appName;
    if (!this.cfg.roleArn) throw new Error('AWS_LAMBDA_ROLE_ARN is not set in the root .env (see infra/aws/README.md)');

    progress({ type: 'build.started', message: `Bundling ${path.basename(sourceDir)}/src/lambda.ts with esbuild (ESM, node22)` });
    const bundle = await bundleLambda(sourceDir);
    progress({ type: 'build.completed', message: `Lambda bundle ready (${(bundle.bytes / 1024).toFixed(1)} KiB zipped)` });

    const variables = { ...target.env, ...secrets };
    if (!(await this.functionExists(name))) {
      progress({ type: 'provision.started', message: `Creating Lambda function ${name} (nodejs22.x, arm64, 256 MB) in ${this.cfg.region}` });
      await this.lambda.send(
        new CreateFunctionCommand({
          FunctionName: name,
          Runtime: 'nodejs22.x',
          Role: this.cfg.roleArn,
          Handler: 'lambda.handler',
          Code: { ZipFile: bundle.zip },
          Environment: { Variables: variables },
          MemorySize: 256,
          Timeout: 10,
          Architectures: ['arm64'],
          Description: 'Deployed by the BobOps orchestrator',
        }),
      );
      await waitUntilFunctionActiveV2({ client: this.lambda, maxWaitTime: 120 }, { FunctionName: name });
    } else {
      progress({ type: 'provision.started', message: `Updating existing Lambda function ${name} in ${this.cfg.region}` });
      await this.lambda.send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: bundle.zip }));
      await this.waitUpdated(name);
      await this.lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: name, Environment: { Variables: variables } }));
      await this.waitUpdated(name);
    }

    const version = await this.publishAndPoint(name, `BobOps run ${input.runId}`);
    const endpoint = await this.ensureFunctionUrl(name, progress);
    progress({ type: 'provision.completed', message: `Alias ${LAMBDA_ALIAS} → version ${version}` });
    return {
      endpoint,
      revision: version,
      evidence: [
        evidence('Lambda deployment', 'AWS Lambda API', {
          functionName: name,
          version,
          alias: LAMBDA_ALIAS,
          url: endpoint,
          runtime: 'nodejs22.x',
          region: this.cfg.region,
          bundleBytes: bundle.bytes,
        }),
      ],
    };
  }

  async status(ref: DeploymentRef): Promise<ProviderStatus> {
    try {
      const cfg = await this.lambda.send(new GetFunctionConfigurationCommand({ FunctionName: ref.appName, Qualifier: LAMBDA_ALIAS }));
      const state: ProviderStatus['state'] =
        cfg.State === 'Failed' || cfg.LastUpdateStatus === 'Failed' ? 'failed' : cfg.State === 'Active' ? 'ready' : 'deploying';
      return {
        state,
        revision: cfg.Version,
        endpoint: await this.getUrl(ref.appName),
        env: cfg.Environment?.Variables ?? {},
        raw: { runtime: cfg.Runtime, state: cfg.State, lastUpdateStatus: cfg.LastUpdateStatus, lastModified: cfg.LastModified },
      };
    } catch (err) {
      if (isNotFound(err)) return { state: 'not_found', env: {}, raw: null };
      throw err;
    }
  }

  async logs(ref: DeploymentRef, lines: number): Promise<string[]> {
    try {
      const res = await this.logsClient.send(
        new FilterLogEventsCommand({ logGroupName: `/aws/lambda/${ref.appName}`, startTime: Date.now() - 30 * 60_000, limit: 1000 }),
      );
      return (res.events ?? [])
        .map((e) => `${new Date(e.timestamp ?? 0).toISOString()} ${(e.message ?? '').trim()}`)
        .slice(-lines);
    } catch (err) {
      if (isNotFound(err)) return ['(no CloudWatch log group yet — the function has not been invoked)'];
      throw err;
    }
  }

  async setEnv(ref: DeploymentRef, change: EnvChange, progress: ProgressFn): Promise<DeployResult> {
    const name = ref.appName;
    const current = await this.lambda.send(new GetFunctionConfigurationCommand({ FunctionName: name, Qualifier: LAMBDA_ALIAS }));
    const variables: Record<string, string> = { ...(current.Environment?.Variables ?? {}), ...(change.set ?? {}) };
    for (const key of change.remove ?? []) delete variables[key];
    progress({ type: 'provider.progress', message: `Updating Lambda ${name} configuration (${describeEnvChange(change)}) and publishing a new version` });
    await this.lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: name, Environment: { Variables: variables } }));
    await this.waitUpdated(name);
    const version = await this.publishAndPoint(name, `BobOps config change: ${describeEnvChange(change)}`);
    return {
      endpoint: (await this.getUrl(name)) ?? ref.endpoint ?? '',
      revision: version,
      evidence: [evidence('Lambda configuration change', 'AWS Lambda API', { functionName: name, version, change: describeEnvChange(change) })],
    };
  }

  async rollback(ref: DeploymentRef, progress: ProgressFn, toRevision?: string): Promise<DeployResult> {
    const name = ref.appName;
    const alias = await this.lambda.send(new GetAliasCommand({ FunctionName: name, Name: LAMBDA_ALIAS }));
    const versions: string[] = [];
    let marker: string | undefined;
    do {
      const page = await this.lambda.send(new ListVersionsByFunctionCommand({ FunctionName: name, Marker: marker, MaxItems: 50 }));
      for (const v of page.Versions ?? []) if (v.Version) versions.push(v.Version);
      marker = page.NextMarker;
    } while (marker);
    const target = toRevision ?? pickPreviousVersion(versions, alias.FunctionVersion ?? '');
    if (!target) throw new Error(`No published version earlier than ${alias.FunctionVersion} exists for ${name}`);
    progress({ type: 'provider.progress', message: `Moving alias ${LAMBDA_ALIAS} of ${name} from version ${alias.FunctionVersion} to ${target}` });
    await this.pointAlias(name, target);
    return {
      endpoint: (await this.getUrl(name)) ?? ref.endpoint ?? '',
      revision: target,
      evidence: [evidence('Lambda rollback', 'AWS Lambda API', { functionName: name, from: alias.FunctionVersion, to: target })],
    };
  }
}
