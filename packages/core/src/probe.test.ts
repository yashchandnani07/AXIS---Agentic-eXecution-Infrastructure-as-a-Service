/**
 * @file      packages/core/src/probe.test.ts
 * @phase     P2
 * @owner     Orchestration & Cloud
 * @purpose   Probe semantics: 2xx = ok, revision extracted from JSON body, network errors = statusCode 0.
 * @depends   vitest, ./probe
 * @usedBy    pnpm test
 * @agentNotes Uses an injected fetchImpl — never hits the network.
 */
import { describe, expect, it } from 'vitest';
import { probeHealth } from './probe';

describe('probeHealth', () => {
  it('reports a healthy JSON endpoint with its revision', async () => {
    const check = await probeHealth({
      provider: 'aws',
      endpoint: 'https://abc.lambda-url.us-east-1.on.aws/',
      healthPath: '/health',
      fetchImpl: async () => new Response(JSON.stringify({ status: 'healthy', revision: '7' }), { status: 200 }),
    });
    expect(check.ok).toBe(true);
    expect(check.statusCode).toBe(200);
    expect(check.revision).toBe('7');
    expect(check.endpoint).toBe('https://abc.lambda-url.us-east-1.on.aws/health');
  });

  it('reports 503 as not ok and keeps the body as evidence', async () => {
    const check = await probeHealth({
      provider: 'ibm-cloud',
      endpoint: 'https://app.example.appdomain.cloud',
      healthPath: '/health',
      fetchImpl: async () => new Response(JSON.stringify({ status: 'unhealthy', checks: { config: { ok: false } } }), { status: 503 }),
    });
    expect(check.ok).toBe(false);
    expect(check.statusCode).toBe(503);
    expect(check.body).toMatchObject({ status: 'unhealthy' });
  });

  it('reports network errors with statusCode 0', async () => {
    const check = await probeHealth({
      provider: 'aws',
      endpoint: 'https://down.example.com',
      healthPath: '/health',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(check.ok).toBe(false);
    expect(check.statusCode).toBe(0);
    expect(check.error).toContain('ECONNREFUSED');
  });
});
