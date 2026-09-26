/**
 * @file      packages/github/src/index.ts
 * @phase     P12
 * @owner     Product & Experience
 * @purpose   Public API of @bobops/github.
 * @depends   ./client
 * @usedBy    orchestrator, scripts
 * @agentNotes —
 */
export { GitHubClient, githubConfigFromEnv, type GitHubConfig, type SentinelIssue } from './client';
