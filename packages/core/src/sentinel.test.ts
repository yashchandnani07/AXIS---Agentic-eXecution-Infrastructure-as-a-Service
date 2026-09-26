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
import { consecutiveFailures, parseIssueBody, renderIssueBody, type SentinelIncidentPayload } from './sentinel';

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
});
