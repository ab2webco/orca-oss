import type { AgentTurnAcceptance } from '../agent-composer-readiness'

/**
 * Records post-submit turn acceptance off the request path (ORCA-191).
 *
 * Deliberately not awaited by its callers. The result is advisory by
 * construction — it never refuses a dispatch and never triggers a resend — so
 * holding an RPC open for it would only spend the caller's timeout budget on
 * information that changes nothing. It lands on the dispatch row, where
 * `dispatch show` reads it and the first-signal deadline's failure reason uses
 * it to say whether the agent ever started a turn at all.
 */
export function recordTurnAcceptanceInBackground(
  db: { recordDispatchTurnAcceptance(dispatchId: string): void },
  dispatchId: string,
  acceptance: Promise<AgentTurnAcceptance>
): Promise<void> {
  return acceptance.then((result) => {
    if (result.accepted) {
      db.recordDispatchTurnAcceptance(dispatchId)
    }
  })
}
