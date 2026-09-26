/**
 * @file      apps/orchestrator/src/ports.ts
 * @phase     P5
 * @owner     Orchestration & Cloud
 * @purpose   Interfaces for outbound integrations the lifecycle depends on (so tests can pass null / fakes).
 * @depends   @bobops/core (types)
 * @usedBy    LifecycleService, deps.ts; implemented by packages/github GitHubClient (Phase 12)
 * @agentNotes Keep ports minimal — add a method only when the lifecycle actually calls it.
 */
import type { SentinelIncidentPayload, SentinelTarget } from '@bobops/core';

export interface GitHubPort {
  /** Writes the endpoints the scheduled sentinel must probe (GitHub repo variable SENTINEL_TARGETS). */
  publishSentinelTargets(targets: SentinelTarget[]): Promise<void>;
  /** Open issues labelled sentinel-incident whose body carries a valid incident payload. */
  listOpenSentinelIncidents(): Promise<Array<{ issueNumber: number; url: string; payload: SentinelIncidentPayload }>>;
  /** Posts the recovery evidence and closes the issue. */
  commentAndCloseIncident(issueNumber: number, body: string): Promise<void>;
}
