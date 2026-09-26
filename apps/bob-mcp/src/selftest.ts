/**
 * @file      apps/bob-mcp/src/selftest.ts
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   Launches the BUILT bundle exactly like Bob does (stdio), lists tools, asserts there is no approve tool,
 *            and calls devops_list_providers. Proves the MCP server works before involving Bob.
 * @depends   @modelcontextprotocol/sdk client
 * @usedBy    `pnpm --filter @bobops/bob-mcp selftest` (needs `pnpm build:mcp` and `pnpm dev:api` running)
 * @agentNotes Diagnostic tool only; not part of the bundle.
 */
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const bundle = fileURLToPath(new URL('../dist/bob-mcp.mjs', import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [bundle] });
const client = new Client({ name: 'bobops-selftest', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
if (tools.some((t) => /approv|decide/i.test(t.name))) throw new Error('SECURITY: an approve/decide tool must never exist');

const result = await client.callTool({ name: 'devops_list_providers', arguments: {} });
console.log(JSON.stringify(result.content, null, 2).slice(0, 2000));
await client.close();
