/**
 * @file      apps/orchestrator/src/lib/errors.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   Typed HTTP errors. Services throw these; app.ts onError turns them into { error, code } JSON.
 * @depends   —
 * @usedBy    services/*, routes/*, app.ts
 * @agentNotes Routes must not construct error responses themselves — throw one of these.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, 'bad_request', message);
  }
}

export class NotFoundError extends HttpError {
  constructor(what: string) {
    super(404, 'not_found', `${what} not found`);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, 'conflict', message);
  }
}

export class ApprovalRequiredError extends HttpError {
  constructor(message: string) {
    super(403, 'approval_required', message);
  }
}
