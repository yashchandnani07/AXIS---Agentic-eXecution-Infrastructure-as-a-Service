/**
 * @file      apps/bob-mcp/src/client.ts
 * @phase     P9
 * @owner     Orchestration & Cloud
 * @purpose   Minimal HTTP client for the orchestrator. Tags every call with x-actor: bob. Turns HTTP errors into
 *            readable Error messages (including zod validation issues) so Bob can self-correct.
 * @depends   global fetch
 * @usedBy    ./tools.ts
 * @agentNotes NEVER add the approval token here. Bob must not be able to approve anything.
 */
export class OrchestratorClient {
  constructor(private readonly baseUrl: string) {}

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-actor': 'bob' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Cannot reach the BobOps orchestrator at ${this.baseUrl}. Ask the developer to run "pnpm dev:api". (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const e = (data ?? {}) as { error?: string; code?: string; issues?: unknown };
      const issues = e.issues ? `\nValidation issues: ${JSON.stringify(e.issues).slice(0, 1500)}` : '';
      throw new Error(`${method} ${path} failed with HTTP ${res.status} ${e.code ?? ''}: ${e.error ?? text}${issues}`);
    }
    return data as T;
  }
}
