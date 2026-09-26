/**
 * @file      apps/bob-mcp/build.mjs
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   Bundles the MCP server (+ @bobops/core + SDK + zod) into ONE file: dist/bob-mcp.mjs, launched by Bob via `node`.
 * @depends   esbuild
 * @usedBy    `pnpm build:mcp` (root) / `pnpm --filter @bobops/bob-mcp build`
 * @agentNotes Re-run after ANY change to apps/bob-mcp or packages/core, then restart the MCP server in Bob.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/bob-mcp.mjs',
  banner: { js: "import { createRequire as __bobopsCreateRequire } from 'module'; const require = __bobopsCreateRequire(import.meta.url);" },
  logLevel: 'info',
});
