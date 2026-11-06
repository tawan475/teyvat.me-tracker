/**
 * An /api error as callers see it (http.ts makes them): the server's `code`,
 * which is what callers branch on, and a `message` safe to show. Its own
 * module so code with no browser APIs (the demo store, inspect.ts, their
 * tests in workerd) can raise one without importing http.ts.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }

  /** First validation message for a field, for inline form errors. */
  issueFor(path: string): string | undefined {
    return this.issues.find((issue) => issue.path === path)?.message
  }
}
