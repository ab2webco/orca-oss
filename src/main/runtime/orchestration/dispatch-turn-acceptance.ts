import type { AgentTurnAcceptance } from '../agent-composer-readiness'
import type { AgentPromptSubmitProbe } from '../agent-prompt-submit-probe'
import type { DispatchContextRow } from './types'
import { retryUnacceptedDispatchSubmit } from './dispatch-submit-retry'

type TurnAcceptanceDb = {
  recordDispatchTurnAcceptance(dispatchId: string): void
  getDispatchContextById(dispatchId: string): DispatchContextRow | undefined
}

/**
 * Records post-submit turn acceptance off the request path (ORCA-191), and
 * finishes a submit the agent never took (ORCA-754).
 *
 * Deliberately not awaited by its callers: it never refuses a dispatch, so
 * holding an RPC open for it would only spend the caller's timeout budget. It
 * lands on the dispatch row, where `dispatch show` reads it and the first-signal
 * deadline's failure reason uses it.
 *
 * `submit` is null for a pane this runtime does not observe (adopted after a
 * restart, an unwatched remote leaf): nothing proves its submit was dropped, so
 * it keeps the pre-ORCA-754 behaviour of recording only.
 */
export function recordTurnAcceptanceInBackground(
  db: TurnAcceptanceDb,
  dispatchId: string,
  acceptance: Promise<AgentTurnAcceptance>,
  submit: AgentPromptSubmitProbe | null = null
): Promise<void> {
  return acceptance.then(async (result) => {
    if (result.accepted) {
      db.recordDispatchTurnAcceptance(dispatchId)
      return
    }
    if (!submit) {
      return
    }
    await retryUnacceptedDispatchSubmit({
      probe: submit,
      isAwaitingFirstTurn: () => {
        const row = db.getDispatchContextById(dispatchId)
        return (
          row?.status === 'dispatched' &&
          row.first_lifecycle_signal_at === null &&
          row.turn_accepted_at === null
        )
      },
      onTurnSeen: () => db.recordDispatchTurnAcceptance(dispatchId)
    })
  })
}
