/**
 * `expect.poll` retries a failed *assertion*, not a thrown exception:
 * `playwright/lib/matchers/expect.js` awaits the poll generator outside its
 * own try/catch, so an exception the generator throws propagates immediately
 * instead of being retried (docs/reference/renderer-recovery-reload.md).
 *
 * A `page.evaluate()` call inside a poll generator can throw exactly this way
 * when a navigation destroys the page's JS execution context mid-call — e.g.
 * a lazy chunk load reload during early app hydration. This predicate lets a
 * poll generator retry *only* that one, narrowly-scoped failure, while any
 * other thrown error (a real bug in the evaluated code) still fails fast.
 */
const EXECUTION_CONTEXT_DESTROYED_PATTERN = /Execution context was destroyed/

export function isExecutionContextDestroyedError(error: unknown): boolean {
  return error instanceof Error && EXECUTION_CONTEXT_DESTROYED_PATTERN.test(error.message)
}
