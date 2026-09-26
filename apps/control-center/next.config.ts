/**
 * @file      apps/control-center/next.config.ts
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   Next config: compile the workspace TS package @bobops/core; static export when NEXT_PUBLIC_MODE=replay.
 * @depends   next
 * @usedBy    next dev / next build
 * @agentNotes Replay build = `pnpm demo:replay` (Phase 14). Live mode needs the orchestrator on :4000.
 */
import type { NextConfig } from 'next';

const replay = process.env.NEXT_PUBLIC_MODE === 'replay';

const nextConfig: NextConfig = {
  transpilePackages: ['@bobops/core'],
  eslint: { ignoreDuringBuilds: true },
  ...(replay ? { output: 'export' as const, images: { unoptimized: true } } : {}),
};

export default nextConfig;
