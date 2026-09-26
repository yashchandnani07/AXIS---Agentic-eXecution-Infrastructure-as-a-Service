/**
 * @file      apps/bob-mcp/src/index.ts
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   MCP stdio server entry. IBM Bob launches it (see .bob/mcp.json) and talks MCP over stdin/stdout.
 * @depends   @modelcontextprotocol/sdk, ./client, ./tools
 * @usedBy    dist/bob-mcp.mjs (bundled), `pnpm --filter @bobops/bob-mcp dev`
 * @agentNotes stdout = protocol. NEVER console.log here; use console.error for diagnostics.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OrchestratorClient } from './client';
import { registerTools } from './tools';

const orchestratorUrl = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000';
const controlCenterUrl = process.env.CONTROL_CENTER_URL ?? 'http://localhost:3000';

const server = new McpServer({ name: 'bobops-orchestrator', version: '1.0.0' });
registerTools(server, new OrchestratorClient(orchestratorUrl), controlCenterUrl);
await server.connect(new StdioServerTransport());
console.error(`[bobops-mcp] ready on stdio → orchestrator ${orchestratorUrl}`);
