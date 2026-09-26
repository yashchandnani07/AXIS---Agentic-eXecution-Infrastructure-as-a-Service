/**
 * @file      apps/orchestrator/src/routes/providers.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   GET /api/providers — capability discovery + auth status for every configured cloud provider.
 * @depends   hono, @bobops/core, ../deps
 * @usedBy    control-center ProviderCards, bob-mcp devops_list_providers
 * @agentNotes Never throws for a single broken provider — reports authenticated:false with the error as a note.
 */
import { Hono } from 'hono';
import type { ProviderCapabilities } from '@bobops/core';
import type { Deps } from '../deps';

export function providerRoutes(deps: Deps) {
  const r = new Hono();
  r.get('/', async (c) => {
    const list = await Promise.all(
      [...deps.providers.values()].map(async (p): Promise<ProviderCapabilities> => {
        try {
          return await p.capabilities();
        } catch (err) {
          return {
            provider: p.id,
            displayName: p.id,
            authenticated: false,
            region: 'unknown',
            services: [],
            offeredServices: [],
            supportsRollback: false,
            notes: [err instanceof Error ? err.message : String(err)],
          };
        }
      }),
    );
    return c.json(list);
  });
  return r;
}
