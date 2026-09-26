/**
 * @file      scripts/lib/env.ts
 * @phase     P1
 * @owner     Orchestration & Cloud
 * @purpose   Shared helpers for every script: loads the ROOT .env and exposes REPO_ROOT + tiny CLI helpers.
 * @depends   dotenv
 * @usedBy    scripts/smoke/*, scripts/demo/*, scripts/sentinel/*, scripts/ci/*
 * @agentNotes Import this module FIRST in every script (`import { REPO_ROOT } from '../lib/env';`).
 *             In GitHub Actions there is no .env — dotenv silently does nothing and real env vars are used.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
config({ path: path.join(REPO_ROOT, '.env') });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to the root .env (see .env.example).`);
  return value;
}

/** Returns the value after a CLI flag, e.g. arg('--run') for `--run run_123`. */
export function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
