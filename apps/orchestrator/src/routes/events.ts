/**
 * @file      apps/orchestrator/src/routes/events.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   GET /api/events/stream — Server-Sent Events of every audit event (live Control Center updates).
 * @depends   hono/streaming, ../deps
 * @usedBy    control-center lib/api.ts subscribeEvents()
 * @agentNotes Sends a ping every 15 s to keep proxies from closing the stream. Event name is "run-event".
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Deps } from '../deps';

export function eventRoutes(deps: Deps) {
  const r = new Hono();
  r.get('/stream', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = deps.bus.subscribe((event) => {
        void stream.writeSSE({ event: 'run-event', id: event.id, data: JSON.stringify(event) });
      });
      stream.onAbort(() => unsubscribe());
      while (!stream.aborted) {
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
        await stream.sleep(15_000);
      }
      unsubscribe();
    }),
  );
  return r;
}
