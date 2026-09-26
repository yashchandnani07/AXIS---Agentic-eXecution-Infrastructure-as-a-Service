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
