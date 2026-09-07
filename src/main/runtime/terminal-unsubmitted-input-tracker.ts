import { createAgentTurnAcceptanceScanner } from '../../shared/agent-turn-acceptance-scanner'
import type {
  TerminalUnsubmittedInput,
  TerminalUnsubmittedInputPending
} from '../../shared/terminal-unsubmitted-input'

/**
 * Tracks, per PTY, input this runtime wrote that the agent never took.
 *
 * Two shapes reach the same stuck pane and only the first is obvious:
 *
 * - text written with no submit behind it — the composer holds it;
 * - a submit written that no turn followed. This is the shape that cost the
 *   incident: `terminal send --text … --enter` wrote both, so the pane looked
 *   delivered while the CR had outrun the composer (ORCA-437).
 *
 * The second needs the agent's own reaction to clear, which is what
 * `createAgentTurnAcceptanceScanner` proves — a `working` title repaint or the
 * agent's interrupt affordance. Anything weaker (bytes echoed back, the pane
 * being non-empty) is the terminal quoting us to ourselves.
 *
 * Lifecycle mirrors `AgentComposerReadinessTracker`: begin at spawn, observe
 * every chunk, forget at teardown. A PTY that was never begun answers
 * `observed: false` rather than "nothing pending" — an adopted session has no
 * write history, and reporting it as healthy is the exact failure this prevents.
 */
export class TerminalUnsubmittedInputTracker {
  private states = new Map<
    string,
    {
      pending: TerminalUnsubmittedInputPending | null
      scanner: ReturnType<typeof createAgentTurnAcceptanceScanner> | null
    }
  >()

  /** Starts watching a PTY this runtime is spawning, before its first byte. */
  beginObserving(ptyId: string): void {
    if (this.states.has(ptyId)) {
      return
    }
    this.states.set(ptyId, { pending: null, scanner: null })
  }

  /** Records a write. `submitted` is true when the write carried Enter. */
  recordWrite(
    ptyId: string,
    options: { hasText: boolean; submitted: boolean; atMs: number }
  ): void {
    const state = this.states.get(ptyId)
    if (!state) {
      return
    }
    if (!options.submitted) {
      if (options.hasText) {
        state.pending = { evidence: 'text-without-submit', sinceMs: options.atMs }
      }
      return
    }
    // Why a fresh scanner per submit and not one for the PTY's life: evidence
    // must be causally after THIS submit. A scanner carrying a previous turn's
    // repaint would clear a submit that never landed.
    state.pending = { evidence: 'submit-without-turn', sinceMs: options.atMs }
    state.scanner = createAgentTurnAcceptanceScanner()
  }

  /** Called for every PTY chunk. Unwatched panes and settled ones cost a lookup. */
  observe(ptyId: string, data: string): void {
    const state = this.states.get(ptyId)
    if (!state?.scanner) {
      return
    }
    if (state.scanner.observe(data).accepted) {
      state.pending = null
      state.scanner = null
    }
  }

  read(ptyId: string | null | undefined): TerminalUnsubmittedInput {
    if (!ptyId) {
      return { observed: false, reason: 'pty-gone' }
    }
    const state = this.states.get(ptyId)
    if (!state) {
      return { observed: false, reason: 'pty-not-watched' }
    }
    return { observed: true, pending: state.pending }
  }

  forget(ptyId: string): void {
    this.states.delete(ptyId)
  }
}
