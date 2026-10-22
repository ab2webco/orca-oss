import { AGENT_PROMPT_SUBMIT } from '../../shared/agent-prompt-injection'
import type { TerminalUnsubmittedInput } from '../../shared/terminal-unsubmitted-input'
import type { TuiAgent } from '../../shared/types'

// Why only these: their own repaint proves a turn started (working title, `esc to interrupt`).
// Another agent would read as never started, and an Enter mid-turn can pick a menu option.
export const SUBMIT_RETRY_AGENTS: ReadonlySet<TuiAgent> = new Set(['claude', 'codex'])

// Why 30 s: the press is already late, so it can afford a composer that mounts
// well after the injector's 10 s gate gave up on a loaded machine (ORCA-754).
export const AGENT_SUBMIT_RETRY_COMPOSER_WAIT_MS = 30_000

/**
 * `awaiting-turn`: our submit is the pane's last write and no turn followed it.
 * `turn-seen`: the agent started a turn after it. `superseded`: the PTY was
 * replaced, stopped being watched, or someone wrote after us — not ours to press.
 */
export type AgentPromptSubmitState = 'awaiting-turn' | 'turn-seen' | 'superseded'

export type AgentPromptSubmitProbe = {
  state: () => AgentPromptSubmitState
  /** One Enter, never the text, after any pending composer marker; false when it did not press. */
  pressEnter: () => Promise<boolean>
}

type Deps = {
  ptyId: string
  /** The handle's PTY now, so a press never lands in a pane that replaced ours. */
  currentPtyId: () => string | null
  unsubmitted: () => TerminalUnsubmittedInput
  /** Bounded; resolves at once unless the agent's composer marker is still pending. */
  waitForComposer: () => Promise<unknown>
  write: (data: string) => boolean
  recordSubmit: () => void
}

/**
 * Lets the injector finish a submit the agent never took (ORCA-754): on a loaded
 * machine the CR can land while the agent is still taking in the paste, so the
 * brief sits in the composer. Built right after our own submit, so the pending
 * write it reads then is ours, and any later one is someone else's.
 */
export function createAgentPromptSubmitProbe(deps: Deps): AgentPromptSubmitProbe {
  const pendingSince = (): number | null => {
    const read = deps.unsubmitted()
    return read.observed && read.pending?.evidence === 'submit-without-turn'
      ? read.pending.sinceMs
      : null
  }
  let ownSince = pendingSince()

  const state = (): AgentPromptSubmitState => {
    if (deps.currentPtyId() !== deps.ptyId) {
      return 'superseded'
    }
    const read = deps.unsubmitted()
    if (!read.observed) {
      return 'superseded'
    }
    if (read.pending === null) {
      return 'turn-seen'
    }
    return ownSince !== null && pendingSince() === ownSince ? 'awaiting-turn' : 'superseded'
  }

  return {
    state,
    pressEnter: async () => {
      if (state() !== 'awaiting-turn') {
        return false
      }
      await deps.waitForComposer()
      if (state() !== 'awaiting-turn' || !deps.write(AGENT_PROMPT_SUBMIT)) {
        return false
      }
      deps.recordSubmit()
      ownSince = pendingSince()
      return true
    }
  }
}
