/**
 * @file      apps/demo-service/src/server.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Node entry point (used locally and inside the Code Engine container). Listens on PORT (default 8080).
 * @depends   @hono/node-server, ./app
 * @usedBy    `pnpm --filter @bobops/demo-service dev`, Dockerfile CMD (via dist/server.mjs)
 * @agentNotes Code Engine injects PORT=8080. Do not hard-code another port.
 */
import { serve } from '@hono/node-server';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: createApp(process.env).fetch, port }, (info) => {
  console.log(`nimbus-books listening on :${info.port}`);
});
