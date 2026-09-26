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
