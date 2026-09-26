/**
 * @file      apps/orchestrator/src/github.ts
 * @phase     P12
 * @owner     Orchestration & Cloud
 * @purpose   Builds the GitHubPort from config (null when GitHub is not configured — the lifecycle still works).
 * @depends   @bobops/github, ./config, ./ports
 * @usedBy    deps.ts
 * @agentNotes GITHUB_TOKEN needs issues:write + variables:write on the repo (`gh auth token` works for your own repo).
 */
import { GitHubClient } from '@bobops/github';
import type { Config } from './config';
import type { GitHubPort } from './ports';

export function createGitHubPort(config: Config): GitHubPort | null {
  if (!config.GITHUB_TOKEN || !config.GITHUB_OWNER || !config.GITHUB_REPO) return null;
  return new GitHubClient({ token: config.GITHUB_TOKEN, owner: config.GITHUB_OWNER, repo: config.GITHUB_REPO });
}
