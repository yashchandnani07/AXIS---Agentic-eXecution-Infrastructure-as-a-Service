/**
 * @file      vitest.config.ts
 * @phase     P1
 * @owner     Orchestration & Cloud
 * @purpose   Root Vitest config: one `pnpm test` runs every package's *.test.ts.
 * @depends   vitest
 * @usedBy    `pnpm test`, GitHub Actions validate.yml
 * @agentNotes Tests must never call real clouds or the network. Keep include globs in sync with the workspace layout.
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@bobops/core': path.resolve('./packages/core/src/index.ts'),
      '@bobops/provider-ibm-cloud': path.resolve('./packages/provider-ibm-cloud/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
