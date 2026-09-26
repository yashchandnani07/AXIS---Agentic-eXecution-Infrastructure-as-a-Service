/**
 * @file      packages/provider-ibm-cloud/src/parse.test.ts
 * @phase     P6
 * @owner     Orchestration & Cloud
 * @purpose   Locks the tolerant parsing of `ibmcloud ce … --output json` for both known output shapes.
 * @depends   vitest, ./parse
 * @usedBy    pnpm test
 * @agentNotes If real CLI output differs, ADD a new fixture + path in parse.ts; never delete an existing shape.
 */
import { describe, expect, it } from 'vitest';
import { extractJson, parseCodeEngineApp, parseRevisions } from './parse';

const KNATIVE_SHAPE = {
  metadata: { name: 'bobops-nimbus-books' },
  spec: {
    template: {
      spec: {
        containers: [
          {
            image: 'private.us-south.icr.io/ce--abc/app-bobops-nimbus-books:20260927',
            env: [
              { name: 'CATALOG_MODE', value: 'featured' },
              { name: 'ADMIN_TOKEN', valueFrom: { secretKeyRef: { name: 's', key: 'ADMIN_TOKEN' } } },
            ],
          },
        ],
      },
    },
  },
  status: {
    url: 'https://bobops-nimbus-books.abc123.us-south.codeengine.appdomain.cloud',
    latestReadyRevisionName: 'bobops-nimbus-books-00002',
    conditions: [{ type: 'Ready', status: 'True' }],
  },
};

const V2_SHAPE = {
  name: 'bobops-nimbus-books',
  endpoint: 'https://bobops-nimbus-books.xyz.us-south.codeengine.appdomain.cloud',
  status: 'ready',
  latest_ready_revision: 'bobops-nimbus-books-00003',
  image_reference: 'private.us-south.icr.io/ce--abc/app:2',
  run_env_variables: [{ type: 'literal', name: 'CATALOG_MODE', value: 'all' }],
};

describe('Code Engine parsers', () => {
  it('extracts JSON after a CLI preamble', () => {
    expect(extractJson('Getting application...\nOK\n\n{"a":1}')).toEqual({ a: 1 });
  });

  it('parses the Knative-style app shape', () => {
    const app = parseCodeEngineApp(KNATIVE_SHAPE);
    expect(app.url).toContain('codeengine.appdomain.cloud');
    expect(app.revision).toBe('bobops-nimbus-books-00002');
    expect(app.ready).toBe(true);
    expect(app.env).toEqual({ CATALOG_MODE: 'featured' });
    expect(app.image).toContain('icr.io');
  });

  it('parses the v2 API app shape', () => {
    const app = parseCodeEngineApp(V2_SHAPE);
    expect(app.url).toContain('xyz');
    expect(app.revision).toBe('bobops-nimbus-books-00003');
    expect(app.ready).toBe(true);
    expect(app.env).toEqual({ CATALOG_MODE: 'all' });
  });

  it('parses and orders revisions (both shapes)', () => {
    const knative = parseRevisions({
      items: [
        { metadata: { name: 'r-00002', creationTimestamp: '2026-09-27T10:05:00Z' }, spec: { containers: [{ image: 'img:2' }] } },
        { metadata: { name: 'r-00001', creationTimestamp: '2026-09-27T10:00:00Z' }, spec: { containers: [{ image: 'img:1' }] } },
      ],
    });
    expect(knative.map((r) => r.name)).toEqual(['r-00001', 'r-00002']);
    const v2 = parseRevisions({ revisions: [{ name: 'r-1', created_at: '2026-09-27T10:00:00Z', image_reference: 'img:1' }] });
    expect(v2[0]?.image).toBe('img:1');
  });
});
