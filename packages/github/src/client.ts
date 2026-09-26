/**
 * @file      packages/github/src/client.ts
 * @phase     P12
 * @owner     Product & Experience
 * @purpose   Octokit wrapper for the sentinel + orchestrator: incident issues (create/find/comment/close/list), the
 *            sentinel-incident label, and the SENTINEL_TARGETS repository variable.
 * @depends   @octokit/rest, @bobops/core (sentinel format)
 * @usedBy    scripts/sentinel/run-sentinel.ts (GitHub Actions), apps/orchestrator/src/github.ts (GitHubPort)
 * @agentNotes Issue bodies are rendered/parsed ONLY via core renderIssueBody/parseIssueBody (cross-process contract).
 */
import { Octokit } from '@octokit/rest';
import {
  SENTINEL_LABEL,
  parseIssueBody,
  renderIssueBody,
  type SentinelIncidentPayload,
  type SentinelTarget,
} from '@bobops/core';

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
}

export interface SentinelIssue {
  issueNumber: number;
  url: string;
  title: string;
  payload: SentinelIncidentPayload;
}

/** Reads GITHUB_TOKEN + GITHUB_OWNER/GITHUB_REPO, falling back to GITHUB_REPOSITORY ("owner/repo", set by Actions). */
export function githubConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GitHubConfig | null {
  const token = env.GITHUB_TOKEN;
  let owner = env.GITHUB_OWNER;
  let repo = env.GITHUB_REPO;
  if ((!owner || !repo) && env.GITHUB_REPOSITORY) [owner, repo] = env.GITHUB_REPOSITORY.split('/');
  return token && owner && repo ? { token, owner, repo } : null;
}

export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(private readonly cfg: GitHubConfig) {
    this.octokit = new Octokit({ auth: cfg.token, userAgent: 'bobops/1.0' });
  }

  private get repo() {
    return { owner: this.cfg.owner, repo: this.cfg.repo };
  }

  async ensureLabel(): Promise<void> {
    try {
      await this.octokit.rest.issues.getLabel({ ...this.repo, name: SENTINEL_LABEL });
    } catch {
      await this.octokit.rest.issues.createLabel({
        ...this.repo,
        name: SENTINEL_LABEL,
        color: 'da1e28',
        description: 'Opened by the BobOps health sentinel',
      });
    }
  }

  private async openSentinelIssues() {
    const { data } = await this.octokit.rest.issues.listForRepo({ ...this.repo, state: 'open', labels: SENTINEL_LABEL, per_page: 50 });
    return data.filter((issue) => !issue.pull_request);
  }

  async listOpenSentinelIncidents(): Promise<SentinelIssue[]> {
    const result: SentinelIssue[] = [];
    for (const issue of await this.openSentinelIssues()) {
      const payload = parseIssueBody(issue.body ?? '');
      if (payload) result.push({ issueNumber: issue.number, url: issue.html_url, title: issue.title, payload });
    }
    return result;
  }

  async findOpenIssueByTitle(title: string): Promise<{ number: number; url: string } | null> {
    const match = (await this.openSentinelIssues()).find((issue) => issue.title === title);
    return match ? { number: match.number, url: match.html_url } : null;
  }

  async openIncidentIssue(title: string, payload: SentinelIncidentPayload): Promise<{ number: number; url: string }> {
    await this.ensureLabel();
    const { data } = await this.octokit.rest.issues.create({ ...this.repo, title, body: renderIssueBody(payload), labels: [SENTINEL_LABEL] });
    return { number: data.number, url: data.html_url };
  }

  async comment(issueNumber: number, body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({ ...this.repo, issue_number: issueNumber, body });
  }

  async commentAndCloseIncident(issueNumber: number, body: string): Promise<void> {
    await this.comment(issueNumber, body);
    await this.octokit.rest.issues.update({ ...this.repo, issue_number: issueNumber, state: 'closed', state_reason: 'completed' });
  }

  async publishSentinelTargets(targets: SentinelTarget[]): Promise<void> {
    const value = JSON.stringify(targets);
    try {
      await this.octokit.rest.actions.updateRepoVariable({ ...this.repo, name: 'SENTINEL_TARGETS', value });
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
      await this.octokit.rest.actions.createRepoVariable({ ...this.repo, name: 'SENTINEL_TARGETS', value });
    }
  }
}
