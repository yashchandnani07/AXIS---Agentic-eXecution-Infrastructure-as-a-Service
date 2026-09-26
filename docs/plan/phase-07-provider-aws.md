<!--
@file     docs/plan/phase-07-provider-aws.md
@purpose  Real AWS Lambda adapter (second cloud) + least-privilege IAM + live smoke deployment.
@owner    Orchestration & Cloud (O) — can be done by Product & Experience (P) in parallel with Phase 06.
-->
# Phase 07 — Provider: AWS Lambda (~75 min)

**Goal:** Implement `AwsLambdaProvider` against the same `CloudProvider` contract. It bundles `src/lambda.ts` with esbuild,
creates or updates the function, publishes an immutable **version**, points the **`live` alias** at it, and exposes a public
**Function URL**. Rollback moves the alias back to the previous version. Logs come from CloudWatch. Then deploy for real with
a least-privilege IAM user.

**Depends on:** Phase 02 and Phase 03.
**Interfaces produced:** `AwsLambdaProvider(cfg: AwsConfig)`, `AwsConfig { region, roleArn? }`, `LAMBDA_ALIAS = 'live'`,
`bundleLambda(sourceDir)` and `pickPreviousVersion(versions, current)`, all exported from `@bobops/provider-aws`.

---

### Task 7.1 — IAM (HUMAN, one-time, ~10 min)

- [ ] **Step 1: Create `infra/aws/lambda-execution-role.yaml`**

```yaml
# @file      infra/aws/lambda-execution-role.yaml
# @phase     P7
# @owner     Orchestration & Cloud
# @purpose   CloudFormation: the execution role every BobOps-deployed Lambda function assumes (CloudWatch logging only).
# @usage     aws cloudformation deploy --template-file infra/aws/lambda-execution-role.yaml --stack-name bobops-iam --capabilities CAPABILITY_NAMED_IAM --region us-east-1
# @agentNotes HUMAN deploys this with an admin profile. The orchestrator itself cannot create IAM roles (least privilege).
AWSTemplateFormatVersion: '2010-09-09'
Description: BobOps - execution role for Lambda functions deployed by the orchestrator
Resources:
  LambdaExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: bobops-lambda-execution
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
Outputs:
  RoleArn:
    Value: !GetAtt LambdaExecutionRole.Arn
```

- [ ] **Step 2: Create `infra/aws/deployer-policy.json`** (the orchestrator's least-privilege permissions; JSON cannot hold comments, so it is documented in `infra/aws/README.md`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ManageBobOpsLambdas",
      "Effect": "Allow",
      "Action": [
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:PublishVersion",
        "lambda:ListVersionsByFunction",
        "lambda:GetAlias",
        "lambda:CreateAlias",
        "lambda:UpdateAlias",
        "lambda:GetFunctionUrlConfig",
        "lambda:CreateFunctionUrlConfig",
        "lambda:AddPermission",
        "lambda:GetPolicy"
      ],
      "Resource": [
        "arn:aws:lambda:*:*:function:bobops-*",
        "arn:aws:lambda:*:*:function:bobops-*:*"
      ]
    },
    {
      "Sid": "PassOnlyTheBobOpsExecutionRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::*:role/bobops-lambda-execution"
    },
    {
      "Sid": "ReadBobOpsLogs",
      "Effect": "Allow",
      "Action": ["logs:FilterLogEvents", "logs:DescribeLogGroups"],
      "Resource": "*"
    },
    {
      "Sid": "WhoAmI",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    }
  ]
}
```

- [ ] **Step 3: Create `infra/aws/README.md`**

````markdown
<!-- @file infra/aws/README.md  @phase P7  @purpose One-time AWS setup for BobOps (human, admin profile). -->
# AWS infrastructure (V1 second cloud)

The orchestrator runs as the **least-privilege IAM user `bobops-deployer`**. It can only touch Lambda functions named
`bobops-*`, can only pass the `bobops-lambda-execution` role, and can read logs. It cannot create IAM roles or delete
anything.

```powershell
# 1) Execution role (CloudFormation)
aws cloudformation deploy --template-file infra/aws/lambda-execution-role.yaml --stack-name bobops-iam --capabilities CAPABILITY_NAMED_IAM --region us-east-1
aws cloudformation describe-stacks --stack-name bobops-iam --region us-east-1 --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text
#    → put the printed ARN into .env as AWS_LAMBDA_ROLE_ARN

# 2) Deployer user with the least-privilege policy
aws iam create-user --user-name bobops-deployer
aws iam put-user-policy --user-name bobops-deployer --policy-name bobops-deployer --policy-document file://infra/aws/deployer-policy.json
aws iam create-access-key --user-name bobops-deployer
#    → put AccessKeyId / SecretAccessKey into .env as AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```

| Resource | Created by | Name |
|---|---|---|
| Execution role | CloudFormation stack `bobops-iam` | `bobops-lambda-execution` |
| Deployer user | human (CLI above) | `bobops-deployer` |
| Function, versions, alias `live`, Function URL | orchestrator after plan approval | `bobops-nimbus-books` |
| Log group | Lambda on first invoke | `/aws/lambda/bobops-nimbus-books` |

Cleanup after the hackathon (human): delete the function, the `bobops-iam` stack and the `bobops-deployer` user.
````

- [ ] **Step 4 (HUMAN):** Run the commands in `infra/aws/README.md` and fill `AWS_LAMBDA_ROLE_ARN`, `AWS_ACCESS_KEY_ID` and
  `AWS_SECRET_ACCESS_KEY` in `.env`.

### Task 7.2 — Package scaffold

- [ ] **Step 1: Create `packages/provider-aws/package.json`**

```json
{
  "name": "@bobops/provider-aws",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": {
    "@aws-sdk/client-cloudwatch-logs": "^3.700.0",
    "@aws-sdk/client-lambda": "^3.700.0",
    "@aws-sdk/client-sts": "^3.700.0",
    "@bobops/core": "workspace:*",
    "adm-zip": "^0.5.16",
    "esbuild": "^0.25.0"
  },
  "devDependencies": {
    "@types/adm-zip": "^0.5.7"
  }
}
```

- [ ] **Step 2: Create `packages/provider-aws/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3:** `pnpm install`

### Task 7.3 — Version logic (test first) and bundler

- [ ] **Step 1: Write `packages/provider-aws/src/versions.test.ts`**

```ts
/**
 * @file      packages/provider-aws/src/versions.test.ts
 * @phase     P7
 * @owner     Orchestration & Cloud
 * @purpose   Rollback target selection: the highest published version below the alias' current version.
 * @depends   vitest, ./versions
 * @usedBy    pnpm test
 * @agentNotes $LATEST is never a rollback target.
 */
import { describe, expect, it } from 'vitest';
import { pickPreviousVersion } from './versions';

describe('pickPreviousVersion', () => {
  it('picks the highest version lower than the current one', () => {
    expect(pickPreviousVersion(['$LATEST', '1', '2', '3', '10'], '10')).toBe('3');
  });
  it('returns undefined when there is no earlier version', () => {
    expect(pickPreviousVersion(['$LATEST', '1'], '1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Create `packages/provider-aws/src/versions.ts`**

```ts
/**
 * @file      packages/provider-aws/src/versions.ts
 * @phase     P7
 * @owner     Orchestration & Cloud
 * @purpose   Pure helper: choose the Lambda version to roll back to.
 * @depends   —
 * @usedBy    ./provider.ts rollback()
 * @agentNotes Numeric compare (10 > 9), never string compare.
 */
export function pickPreviousVersion(versions: string[], current: string): string | undefined {
  const cur = Number(current);
  const previous = versions
    .filter((v) => /^\d+$/.test(v))
    .map(Number)
    .filter((n) => n < cur)
    .sort((a, b) => a - b)
    .pop();
  return previous === undefined ? undefined : String(previous);
}
```

- [ ] **Step 3: Create `packages/provider-aws/src/bundle.ts`**

```ts
/**
 * @file      packages/provider-aws/src/bundle.ts
 * @phase     P7
 * @owner     Orchestration & Cloud
 * @purpose   BUILD stage for AWS: bundles <app>/src/lambda.ts (+ deps) into one ESM file and zips it as lambda.mjs.
 * @depends   esbuild, adm-zip, node:fs, node:path
 * @usedBy    ./provider.ts deploy()
 * @agentNotes Handler must be "lambda.handler" → file lambda.mjs exporting `handler`. The createRequire banner lets
 *             bundled CommonJS dependencies call require() inside an ESM bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { build } from 'esbuild';

export async function bundleLambda(sourceDir: string): Promise<{ zip: Buffer; bytes: number }> {
  const entry = path.join(sourceDir, 'src', 'lambda.ts');
  if (!fs.existsSync(entry)) {
    throw new Error(`Missing ${entry}. Generate deployment assets first (Bob skill deployment-asset-authoring, or pnpm demo:golden).`);
  }
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: 'lambda.mjs',
    write: false,
    minify: true,
    legalComments: 'none',
    banner: { js: "import { createRequire as __bobopsCreateRequire } from 'module'; const require = __bobopsCreateRequire(import.meta.url);" },
    logLevel: 'silent',
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error('esbuild produced no output');
  const zip = new AdmZip();
  zip.addFile('lambda.mjs', Buffer.from(file.contents));
  const buffer = zip.toBuffer();
  return { zip: buffer, bytes: buffer.length };
}
```

- [ ] **Step 4:** `pnpm vitest run packages/provider-aws` → Expected: PASS (2 tests).

### Task 7.4 — The provider

- [ ] **Step 1: Create `packages/provider-aws/src/provider.ts`**

```ts
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
```

- [ ] **Step 2: Create `packages/provider-aws/src/index.ts`**

```ts
/**
 * @file      packages/provider-aws/src/index.ts
 * @phase     P7
 * @owner     Orchestration & Cloud
 * @purpose   Public API of @bobops/provider-aws.
 * @depends   ./provider, ./bundle, ./versions
 * @usedBy    orchestrator registry, scripts
 * @agentNotes Export only what other packages need.
 */
export { AwsLambdaProvider, LAMBDA_ALIAS, type AwsConfig } from './provider';
export { bundleLambda } from './bundle';
export { pickPreviousVersion } from './versions';
```

- [ ] **Step 3:** `pnpm test; pnpm typecheck` → Expected: green (48 tests).
  If typecheck fails with `'InvokedViaFunctionUrl' does not exist`, run
  `pnpm --filter @bobops/provider-aws update @aws-sdk/client-lambda@latest` and retry.

### Task 7.5 — Live smoke deployment (HUMAN)

- [ ] **Step 1: Create `scripts/smoke/deploy-aws.ts`**

```ts
/**
 * @file      scripts/smoke/deploy-aws.ts
 * @phase     P7
 * @owner     Orchestration & Cloud
 * @purpose   Deploys Nimbus Books to AWS Lambda directly through the adapter and probes the public Function URL.
 * @depends   ../lib/env, @bobops/core, @bobops/provider-aws
 * @usedBy    `pnpm smoke:aws` (HUMAN — creates real cloud resources)
 * @agentNotes Requires apps/demo-service/src/lambda.ts (run `pnpm demo:golden` first).
 */
import path from 'node:path';
import { REPO_ROOT, requireEnv } from '../lib/env';
import { probeHealth } from '@bobops/core';
import { AwsLambdaProvider } from '@bobops/provider-aws';

const region = process.env.AWS_REGION ?? 'us-east-1';
const provider = new AwsLambdaProvider({ region, roleArn: requireEnv('AWS_LAMBDA_ROLE_ARN') });

console.log('Capabilities:', await provider.capabilities());
const adminToken = process.env.SECRET_ADMIN_TOKEN;
const result = await provider.deploy(
  {
    runId: 'smoke',
    sourceDir: path.join(REPO_ROOT, 'apps', 'demo-service'),
    secrets: adminToken ? { ADMIN_TOKEN: adminToken } : {},
    target: {
      provider: 'aws',
      service: 'lambda',
      region,
      appName: 'bobops-nimbus-books',
      port: 8080,
      healthPath: '/health',
      env: { CATALOG_MODE: 'featured', APP_VERSION: 'smoke-1', DEPLOY_PROVIDER: 'aws' },
      secretRefs: ['ADMIN_TOKEN'],
      resources: [],
    },
  },
  (e) => console.log(`[${e.type}] ${e.message}`),
);
console.log('Deploy result:', { endpoint: result.endpoint, revision: result.revision });
await new Promise((r) => setTimeout(r, 5000)); // new Function URLs need a few seconds
console.log('Health probe:', await probeHealth({ provider: 'aws', endpoint: result.endpoint, healthPath: '/health' }));
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
    "smoke:ibm": "tsx smoke/deploy-ibm.ts",
    "smoke:aws": "tsx smoke/deploy-aws.ts"
  },
  "dependencies": {
    "@bobops/core": "workspace:*",
    "@bobops/provider-aws": "workspace:*",
    "@bobops/provider-ibm-cloud": "workspace:*",
    "dotenv": "^16.4.7"
  }
}
```

- [ ] **Step 3:** `pnpm install; pnpm typecheck`
- [ ] **Step 4 (HUMAN):**
  ```powershell
  pnpm demo:golden
  pnpm smoke:aws
  ```
  Expected (≈ 30 s): `Deploy result: { endpoint: 'https://<id>.lambda-url.us-east-1.on.aws/', revision: '1' }`
  and `Health probe: { ok: true, statusCode: 200, revision: 'smoke-1' }`.
- [ ] **Step 5 (HUMAN):** `pnpm demo:reset`

## HANDOFF

```text
✅ PHASE 07 COMPLETE — AWS Lambda provider
BUILT:
  - packages/provider-aws (esbuild bundler, version picker + 2 tests, AwsLambdaProvider with alias rollback & Function URL)
  - infra/aws: execution-role CloudFormation, least-privilege deployer policy, README
  - scripts/smoke/deploy-aws.ts (pnpm smoke:aws)
DO THIS (human):
  1. Run infra/aws/README.md commands; fill AWS_* in .env
  2. pnpm test; pnpm typecheck
  3. pnpm demo:golden; pnpm smoke:aws; open <FunctionURL>health ; pnpm demo:reset
EXPECT:
  - 48 tests pass; probe ok:true statusCode 200 revision 'smoke-1'
IF IT FAILS:
  - HTTP 403 "Forbidden" from the Function URL → both permissions are required; run:
    aws lambda get-policy --function-name bobops-nimbus-books --qualifier live   (must list InvokeFunctionUrl AND InvokeFunction)
  - AccessDenied iam:PassRole → AWS_LAMBDA_ROLE_ARN must be the bobops-lambda-execution role ARN
  - "Runtime.ImportModuleError" in CloudWatch → handler must be lambda.handler; check docs/demo/golden/lambda.ts was copied
EVIDENCE:
  - Screenshot Bob's task summary → evidence/bob-task-summaries/phase-07-provider-aws.png
  - Screenshot the AWS Lambda console (function + alias live) → evidence/demo-runs/aws-lambda-function.png
  - git add -A; git commit -m "feat(p07): AWS Lambda provider"; git push
```
