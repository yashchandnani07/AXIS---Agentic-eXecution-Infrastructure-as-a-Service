/**
 * @file      packages/core/src/util.test.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Guarantees stable hashing input and readable action descriptions.
 * @depends   vitest, ./util
 * @usedBy    pnpm test
 * @agentNotes stableStringify drives approval hashes — a regression here silently breaks approvals.
 */
import { describe, expect, it } from 'vitest';
import { describeAction, describeEnvChange, newId, stableStringify } from './util';

describe('util', () => {
  it('stableStringify ignores key order and undefined', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [1, { y: 1, x: 2 }] }, u: undefined })).toBe(
      stableStringify({ a: { c: [1, { x: 2, y: 1 }], d: 2 }, b: 1 }),
    );
  });
  it('newId uses the prefix', () => {
    expect(newId('run')).toMatch(/^run_[0-9a-f]{10}$/);
  });
  it('describes actions and env changes', () => {
    expect(describeAction({ type: 'set_env', key: 'CATALOG_MODE', value: 'featured' })).toBe('Set CATALOG_MODE=featured');
    expect(describeAction({ type: 'rollback' })).toBe('Roll back to the previous revision');
    expect(describeEnvChange({ set: { A: '1' }, remove: ['B'] })).toBe('set A; remove B');
  });
});
