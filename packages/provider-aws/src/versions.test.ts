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
