/**
 * @file      scripts/setup/init-dev.ts
 * @phase     P14 / Onboarding
 * @owner     Orchestration & Cloud
 * @purpose   One-shot teammate onboarding script: validates environment, configures local MCP paths,
 *            syncs tokens to UI .env.local, builds MCP bundle, and verifies test suites.
 * @usedBy    `pnpm setup` or `npx tsx scripts/setup/init-dev.ts`
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

console.log('\n============================================================');
console.log('🛰️  AXIS (BobOps) Teammate Environment Onboarding');
console.log('============================================================\n');

// 1. Check Node.js version
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.warn(`⚠️  Warning: Node.js version is ${process.version}. Recommended version is Node 22+ (LTS).`);
} else {
  console.log(`✔ Node.js version: ${process.version} (OK)`);
}

// 2. Validate / Setup Root .env
const rootEnvPath = path.join(REPO_ROOT, '.env');
const rootEnvExamplePath = path.join(REPO_ROOT, '.env.example');

let approvalToken = 'test-approval-token-local';

if (!fs.existsSync(rootEnvPath)) {
  if (fs.existsSync(rootEnvExamplePath)) {
    fs.copyFileSync(rootEnvExamplePath, rootEnvPath);
    console.log('✔ Created .env from .env.example');
    console.log('👉 ACTION REQUIRED: Paste your shared IBM Cloud & AWS credentials into .env');
  } else {
    console.warn('⚠️  Neither .env nor .env.example found at repo root.');
  }
} else {
  console.log('✔ Root .env is present');
  const envContent = fs.readFileSync(rootEnvPath, 'utf8');
  const match = envContent.match(/^APPROVAL_TOKEN=(.+)$/m);
  if (match && match[1].trim()) {
    approvalToken = match[1].trim().replace(/^["']|["']$/g, '');
  }
}

// 3. Configure apps/control-center/.env.local
const uiEnvPath = path.join(REPO_ROOT, 'apps', 'control-center', '.env.local');
const uiEnvContent = [
  'NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:4000',
  `NEXT_PUBLIC_APPROVAL_TOKEN=${approvalToken}`,
  'NEXT_PUBLIC_MODE=live',
  ''
].join('\n');

fs.writeFileSync(uiEnvPath, uiEnvContent, 'utf8');
console.log('✔ Configured apps/control-center/.env.local with matching APPROVAL_TOKEN');

// 4. Build Bob MCP Server bundle
console.log('\n▶ Building apps/bob-mcp bundle with esbuild...');
try {
  execSync('node build.mjs', { cwd: path.join(REPO_ROOT, 'apps', 'bob-mcp'), stdio: 'inherit' });
  console.log('✔ Built apps/bob-mcp/dist/bob-mcp.mjs');
} catch (err) {
  console.error('❌ Failed to build bob-mcp bundle:', err);
}

// 5. Update .bob/mcp.json with Teammate Local Absolute Path
const mcpJsonPath = path.join(REPO_ROOT, '.bob', 'mcp.json');
const bundlePath = path.join(REPO_ROOT, 'apps', 'bob-mcp', 'dist', 'bob-mcp.mjs').replace(/\\/g, '/');

if (fs.existsSync(mcpJsonPath)) {
  try {
    const mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'));
    if (mcpConfig.mcpServers?.['bobops-orchestrator']) {
      mcpConfig.mcpServers['bobops-orchestrator'].args = [bundlePath];
      fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), 'utf8');
      console.log(`✔ Configured .bob/mcp.json path:\n   -> ${bundlePath}`);
    }
  } catch (err) {
    console.warn('⚠️  Could not update .bob/mcp.json:', err);
  }
}

// 6. Stage Golden Demo Assets
console.log('\n▶ Staging golden demo microservice assets...');
try {
  execSync('npx tsx scripts/demo/golden.ts', { cwd: REPO_ROOT, stdio: 'inherit' });
} catch (err) {
  console.warn('⚠️  Could not stage golden assets:', err);
}

// 7. Run Vitest verification
console.log('\n▶ Running vitest suite verification...');
try {
  execSync('pnpm test', { cwd: REPO_ROOT, stdio: 'inherit' });
  console.log('✔ All test suites verified successfully!');
} catch (err) {
  console.error('❌ Vitest verification encountered issues. Review test output above.');
}

console.log('\n============================================================');
console.log('🚀 Teammate Onboarding Complete!');
console.log('============================================================');
console.log('\nNext steps:');
console.log('1. Check that your .env contains shared IBM & AWS keys');
console.log('2. In IBM Bob, ensure mode "🛰️ Multi-Cloud DevOps Engineer" is active');
console.log('3. Start the dev environment:');
console.log('     pnpm dev            (runs both UI :3000 & API :4000)');
console.log('4. Open http://localhost:3000 in your browser to view the Control Center.\n');
