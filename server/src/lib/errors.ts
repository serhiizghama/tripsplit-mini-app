/**
 * Central error handling. Every API error response is JSON shaped as
 * `{ code, message }` with the matching HTTP status — see IMPLEMENTATION_PLAN.md
 * §5. Route/middleware code throws `AppError`; `app.onError` in `src/index.ts`
 * turns it into the JSON response. Anything else (a genuine bug) becomes a
 * generic 500 so internals never leak to the client.
 */
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export interface ErrorBody {
  code: string;
  message: string;
}

export function toErrorBody(err: AppError): ErrorBody {
  return { code: err.code, message: err.message };
}
