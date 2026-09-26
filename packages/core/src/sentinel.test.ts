/**
 * @file      packages/core/src/sentinel.test.ts
 * @phase     P2
 * @owner     Product & Experience
 * @purpose   Round-trip of the machine-readable incident block embedded in GitHub issues + failure streak logic.
 * @depends   vitest, ./sentinel
 * @usedBy    pnpm test
 * @agentNotes The issue body format is a cross-process contract (GitHub Actions ⇄ orchestrator). Never change it silently.
 */
import { describe, expect, it } from 'vitest';
import type { HealthCheck } from './schemas';
import {
  SentinelTargetSchema,
  consecutiveFailures,
  parseIssueBody,
  renderIssueBody,
  shouldProbeNow,
  type SentinelIncidentPayload,
} from './sentinel';

const probe = (ok: boolean): HealthCheck => ({
  id: crypto.randomUUID(),
  provider: 'ibm-cloud',
  endpoint: 'https://x.appdomain.cloud/health',
  ok,
  statusCode: ok ? 200 : 503,
  latencyMs: 120,
  checkedAt: '2026-09-27T10:00:00.000Z',
});

describe('sentinel format', () => {
  it('counts trailing consecutive failures', () => {
    expect(consecutiveFailures([probe(true), probe(false), probe(false)])).toBe(2);
    expect(consecutiveFailures([probe(false), probe(true)])).toBe(0);
  });

  it('round-trips the incident payload through the issue body', () => {
    const payload: SentinelIncidentPayload = {
      version: 1,
      runId: 'run_abc',
      provider: 'ibm-cloud',
      appName: 'bobops-nimbus-books',
      endpoint: 'https://x.appdomain.cloud',
      threshold: 3,
      consecutiveFailures: 3,
      probes: [probe(false), probe(false), probe(false)],
      detectedAt: '2026-09-27T10:00:30.000Z',
      workflowRunUrl: 'https://github.com/o/r/actions/runs/1',
    };
    const body = renderIssueBody(payload);
    expect(body).toContain('Health sentinel incident');
    expect(parseIssueBody(body)).toEqual(payload);
  });

  it('ignores unrelated issue bodies', () => {
    expect(parseIssueBody('just a normal issue')).toBeNull();
  });

  it('rejects an interval that is not a multiple of the 5-minute cron floor', () => {
    const base = { runId: 'r', provider: 'aws' as const, appName: 'bobops-x', endpoint: 'https://x.example.com' };
    expect(SentinelTargetSchema.safeParse({ ...base, intervalMinutes: 7 }).success).toBe(false);
    expect(SentinelTargetSchema.safeParse({ ...base, intervalMinutes: 15 }).success).toBe(true);
  });

  it('samples a user-chosen interval on a fixed 5-minute cron without any external state', () => {
    const every5 = { intervalMinutes: 5 };
    const every15 = { intervalMinutes: 15 };
    expect(shouldProbeNow(every5, new Date('2026-09-27T10:00:00Z'))).toBe(true);
    expect(shouldProbeNow(every5, new Date('2026-09-27T10:05:00Z'))).toBe(true);
    expect(shouldProbeNow(every15, new Date('2026-09-27T10:00:00Z'))).toBe(true);
    expect(shouldProbeNow(every15, new Date('2026-09-27T10:05:00Z'))).toBe(false);
    expect(shouldProbeNow(every15, new Date('2026-09-27T10:10:00Z'))).toBe(false);
    expect(shouldProbeNow(every15, new Date('2026-09-27T10:15:00Z'))).toBe(true);
  });
});
