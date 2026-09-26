/**
 * @file      apps/orchestrator/src/services/test-runner.ts
 * @phase     P5
 * @owner     Orchestration & Cloud
 * @purpose   TEST stage: runs the target application's Vitest suite before anything is deployed.
 * @depends   execa
 * @usedBy    deps.ts (default runTests), LifecycleService.executePlan
 * @agentNotes Runs `pnpm exec vitest run` inside the app folder. Output is trimmed to the last 20 lines for evidence.
 */
import { execa } from 'execa';

export interface TestResult {
  ok: boolean;
  output: string;
}

export async function runPackageTests(sourceDir: string): Promise<TestResult> {
  const result = await execa('pnpm', ['exec', 'vitest', 'run'], {
    cwd: sourceDir,
    reject: false,
    all: true,
    timeout: 180_000,
    env: { CI: 'true', FORCE_COLOR: '0' },
  });
  const tail = String(result.all ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-20)
    .join('\n');
  const shortMessage = (result as { shortMessage?: string }).shortMessage ?? '';
  return { ok: result.exitCode === 0, output: tail || shortMessage };
}
