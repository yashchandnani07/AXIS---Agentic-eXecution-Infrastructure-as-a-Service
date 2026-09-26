/**
 * @file      packages/core/src/state-machine.test.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Locks the run lifecycle: allowed and forbidden transitions.
 * @depends   vitest, ./state-machine
 * @usedBy    pnpm test
 * @agentNotes If you change TRANSITIONS, update these tests AND the diagram in 00-MASTER-PLAN.md §4.2.
 */
import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, InvalidTransitionError } from './state-machine';

describe('run state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('created', 'analyzed')).toBe(true);
    expect(canTransition('analyzed', 'awaiting_approval')).toBe(true);
    expect(canTransition('awaiting_approval', 'approved')).toBe(true);
    expect(canTransition('approved', 'deploying')).toBe(true);
    expect(canTransition('deploying', 'verifying')).toBe(true);
    expect(canTransition('verifying', 'healthy')).toBe(true);
  });

  it('allows the recovery loop', () => {
    expect(canTransition('healthy', 'incident')).toBe(true);
    expect(canTransition('incident', 'awaiting_remediation_approval')).toBe(true);
    expect(canTransition('awaiting_remediation_approval', 'remediating')).toBe(true);
    expect(canTransition('remediating', 'verifying')).toBe(true);
  });

  it('forbids skipping the human approval gate', () => {
    expect(canTransition('analyzed', 'deploying')).toBe(false);
    expect(canTransition('awaiting_approval', 'deploying')).toBe(false);
    expect(canTransition('incident', 'remediating')).toBe(false);
  });

  it('assertTransition throws a descriptive error', () => {
    expect(() => assertTransition('created', 'healthy')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('created', 'healthy')).toThrow(/created → healthy/);
  });
});
