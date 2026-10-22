import type { AgentPromptSubmitProbe } from '../agent-prompt-submit-probe'

// Why 15 s: longer than any first repaint seen on a loaded machine, so a slow turn
// is recorded, not pressed over; short against the 11-min first-signal deadline.
export const DISPATCH_SUBMIT_RETRY_AFTER_MS = 15_000

// Why 2: a dropped CR is fixed by one more; a second covers one more drop. Past
// that the pane is not taking input, and the deadline names it.
export const DISPATCH_SUBMIT_RETRIES = 2

export type DispatchSubmitRetryResult = {
  presses: number
  outcome: 'turn-seen' | 'stopped' | 'exhausted'
}

/**
 * Finishes a submit the agent never took (ORCA-754). Presses Enter only — the
 * brief is never re-typed — and only while the dispatch still waits for its
 * first turn and our submit is still the pane's last write.
 */
export async function retryUnacceptedDispatchSubmit(params: {
  probe: AgentPromptSubmitProbe
  isAwaitingFirstTurn: () => boolean
  onTurnSeen: () => void
  sleep?: (ms: number) => Promise<void>
}): Promise<DispatchSubmitRetryResult> {
  const sleep =
    params.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let presses = 0
  for (;;) {
    await sleep(DISPATCH_SUBMIT_RETRY_AFTER_MS)
    const state = params.probe.state()
    if (state === 'turn-seen') {
      params.onTurnSeen()
      return { presses, outcome: 'turn-seen' }
    }
    if (state !== 'awaiting-turn' || !params.isAwaitingFirstTurn()) {
      return { presses, outcome: 'stopped' }
    }
    if (presses >= DISPATCH_SUBMIT_RETRIES) {
      return { presses, outcome: 'exhausted' }
    }
    if (!(await params.probe.pressEnter())) {
      return { presses, outcome: 'stopped' }
    }
    presses += 1
  }
}
