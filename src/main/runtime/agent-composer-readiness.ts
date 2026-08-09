import type { TuiAgent } from '../../shared/types'
import type { ComposerReadyState } from '../../shared/composer-ready-observation'
import type { DraftPasteReadySignal } from '../../shared/tui-agent-config'
import {
  createComposerReadyObservation,
  isProvableComposerReadySignal
} from '../../shared/composer-ready-observation'
import { createAgentTurnAcceptanceScanner } from '../../shared/agent-turn-acceptance-scanner'
import type { AgentTurnAcceptanceEvidence } from '../../shared/agent-turn-acceptance-scanner'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'

// Why (ORCA-171): Codex was measured reaching composer-ready 8.2 s and 14.6 s
// after spawn across two runs. The startup draft path's 8 s budget would have
// expired on the second one, so the dispatch gate gets its own, wider budget —
// this is a boot race, and a budget under the observed worst case reintroduces
// it.
export const AGENT_COMPOSER_READY_TIMEOUT_MS = 30_000

// Why: turn acceptance is the agent's first repaint after the submit CR, which
// lands well under a second on every agent observed. Bounded short because the
// result never changes what Orca does — a miss is a warning, never a resend and
// never a refusal — so every extra second is latency bought with no decision.
export const AGENT_TURN_ACCEPTANCE_TIMEOUT_MS = 5_000

export type AgentComposerReadiness = {
  /** False only for `awaiting-composer`: proof the TUI is still booting. */
  ready: boolean
  /** True only with a fired composer-ready marker — not merely "not blocked". */
  proven: boolean
  state: ComposerReadyState
  signal: DraftPasteReadySignal | null
  waitedMs: number
}

export type AgentTurnAcceptance = {
  accepted: boolean
  evidence: AgentTurnAcceptanceEvidence | null
  waitedMs: number
}

export function composerReadySignalFor(agent: TuiAgent | null): DraftPasteReadySignal | null {
  if (!agent) {
    return null
  }
  const signal = TUI_AGENT_CONFIG[agent]?.draftPasteReadySignal
  return isProvableComposerReadySignal(signal) ? signal : null
}

type PtySubscribe = (ptyId: string, listener: (data: string) => void) => () => void

/**
 * Owns one composer-ready observation per PTY, for the PTY's whole life
 * (ORCA-191).
 *
 * Lifetime-scoped on purpose. The question at inject time is "has this
 * composer ever been ready", and an observation armed at inject time cannot
 * answer it for a pane that booted an hour ago: its bracketed-paste enable is
 * long out of any replay window, so every established pane would look
 * unready and the `dispatch --inject` rescue path would refuse to run.
 *
 * Only agents whose readiness this runtime can actually prove are tracked
 * (Codex's composer glyph, opencode/mimo's show-cursor). Everything else —
 * shells, agents on the marker-less quiet-window signal, PTYs whose bytes this
 * runtime never sees — is never allocated and always answers `unobserved`,
 * which callers must treat as no evidence rather than as a refusal.
 */
export class AgentComposerReadinessTracker {
  private observations = new Map<
    string,
    {
      signal: DraftPasteReadySignal
      observation: ReturnType<typeof createComposerReadyObservation>
    }
  >()
  private subscribe: PtySubscribe

  constructor(subscribe: PtySubscribe) {
    this.subscribe = subscribe
  }

  /** Called for every PTY chunk. Cheap by construction: one map lookup for an
   *  untracked PTY, and nothing at all once the marker has fired. */
  observe(ptyId: string, agent: TuiAgent | null, data: string): void {
    const existing = this.observations.get(ptyId)
    if (existing) {
      if (!existing.observation.settled()) {
        existing.observation.observe(data)
      }
      return
    }
    const signal = composerReadySignalFor(agent)
    if (!signal) {
      return
    }
    const observation = createComposerReadyObservation(signal)
    this.observations.set(ptyId, { signal, observation })
    observation.observe(data)
  }

  state(ptyId: string): ComposerReadyState {
    return this.observations.get(ptyId)?.observation.state() ?? 'unobserved'
  }

  readyAt(ptyId: string): number | null {
    return this.observations.get(ptyId)?.observation.readyAt() ?? null
  }

  forget(ptyId: string): void {
    this.observations.delete(ptyId)
  }

  /**
   * Resolves as soon as the composer-ready marker fires, or when the budget
   * expires. An `unobserved` PTY resolves immediately — waiting on a signal
   * this runtime has no way to see is a disguised sleep, and the brief for this
   * fix rules that out explicitly.
   */
  async wait(
    ptyId: string,
    agent: TuiAgent | null,
    timeoutMs: number,
    options: { abortSignal?: AbortSignal; now?: () => number } = {}
  ): Promise<AgentComposerReadiness> {
    const now = options.now ?? Date.now
    const startedAt = now()
    const signal = composerReadySignalFor(agent)
    const settle = (state: ComposerReadyState): AgentComposerReadiness => ({
      ready: state !== 'awaiting-composer',
      proven: state === 'ready',
      state,
      signal,
      waitedMs: now() - startedAt
    })
    if (!signal) {
      return settle(this.state(ptyId))
    }
    const initial = this.state(ptyId)
    if (initial !== 'awaiting-composer') {
      return settle(initial)
    }
    return await new Promise<AgentComposerReadiness>((resolve) => {
      let unsubscribe: (() => void) | null = null
      let timer: NodeJS.Timeout | null = null
      let done = false
      const finish = (): void => {
        if (done) {
          return
        }
        done = true
        if (timer) {
          clearTimeout(timer)
        }
        options.abortSignal?.removeEventListener('abort', finish)
        unsubscribe?.()
        resolve(settle(this.state(ptyId)))
      }
      // Why: subscribe before re-reading the state so a marker landing between
      // the read and the subscription cannot be missed.
      unsubscribe = this.subscribe(ptyId, () => {
        if (this.state(ptyId) === 'ready') {
          finish()
        }
      })
      if (this.state(ptyId) === 'ready') {
        finish()
        return
      }
      // Why: an aborted RPC must not leave a 30 s observation subscribed.
      options.abortSignal?.addEventListener('abort', finish, { once: true })
      timer = setTimeout(finish, timeoutMs)
    })
  }

  /**
   * Subscribes for post-submit turn acceptance BEFORE the caller writes, and
   * returns an `arm()` the caller calls once the write resolved. Only chunks
   * fed after `arm()` count, so the evidence is causally later than the submit
   * by construction rather than by comparing clocks.
   */
  observeTurnAcceptance(
    ptyId: string,
    timeoutMs: number,
    now: () => number = Date.now
  ): { arm: () => Promise<AgentTurnAcceptance>; cancel: () => void } {
    // Why: the caller never blocks on this. The result changes nothing Orca
    // does — it is not a refusal and never a resend — so making an RPC wait on
    // it would buy latency with no decision (and, on worker-start, could push
    // the handler past the caller's own budget).
    const scanner = createAgentTurnAcceptanceScanner()
    let armed = false
    let armedAt = 0
    let settle: ((acceptance: AgentTurnAcceptance) => void) | null = null
    let timer: NodeJS.Timeout | null = null
    let done = false
    const finish = (evidence: AgentTurnAcceptanceEvidence | null): void => {
      if (done) {
        return
      }
      done = true
      if (timer) {
        clearTimeout(timer)
      }
      unsubscribe()
      settle?.({ accepted: evidence !== null, evidence, waitedMs: now() - armedAt })
    }
    const unsubscribe = this.subscribe(ptyId, (data) => {
      if (!armed || done) {
        return
      }
      const result = scanner.observe(data)
      if (result.accepted) {
        finish(result.evidence)
      }
    })
    return {
      arm: () =>
        new Promise<AgentTurnAcceptance>((resolve) => {
          armed = true
          armedAt = now()
          settle = resolve
          timer = setTimeout(() => finish(null), timeoutMs)
        }),
      cancel: () => {
        done = true
        if (timer) {
          clearTimeout(timer)
        }
        unsubscribe()
      }
    }
  }
}
