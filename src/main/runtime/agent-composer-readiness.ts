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

// Why: observation runs before the agent is identifiable, so it cannot pick one
// signal up front. Both provable signals are scanned; the query picks.
const PROVABLE_SIGNALS = [
  'codex-composer-prompt',
  'render-cursor-after-bracketed-paste'
] as const satisfies readonly DraftPasteReadySignal[]

/**
 * Owns one composer-ready observation per PTY, for the PTY's whole life
 * (ORCA-191).
 *
 * Lifetime-scoped on purpose. The question at inject time is "has this composer
 * ever been ready", and an observation armed at inject time cannot answer it
 * for a pane that booted an hour ago: its bracketed-paste enable is long out of
 * any replay window, so every established pane would look unready and the
 * `dispatch --inject` rescue path would refuse to run.
 *
 * Signal-agnostic while observing, agent-specific when queried. The agent
 * identity is not reliably known while a pane boots — `launchAgent` is only
 * recorded for token-bound spawns, and the foreground process is not resolved
 * until something asks — so gating observation on it would miss the bracketed-
 * paste enable of exactly the panes this fix is about. Both provable markers
 * are therefore scanned for every observed PTY, and `state(ptyId, agent)`
 * answers with the one that agent actually emits.
 *
 * Provenance is what separates the two meanings of "no marker seen".
 * Observation starts at `beginObserving`, which the runtime calls when it
 * registers a PTY it is spawning — so for those panes a missing marker means
 * *not yet*, which is the whole defect. A pane this runtime never registered
 * (restored or adopted after a restart) is never observed and always answers
 * `unobserved`: the absence of evidence, which callers must not treat as a
 * refusal, and which is what keeps `dispatch --inject` usable on a stalled run.
 */
export class AgentComposerReadinessTracker {
  private observations = new Map<
    string,
    Map<DraftPasteReadySignal, ReturnType<typeof createComposerReadyObservation>>
  >()
  private subscribe: PtySubscribe

  constructor(subscribe: PtySubscribe) {
    this.subscribe = subscribe
  }

  /** Starts watching a PTY this runtime is spawning, before its first byte. */
  beginObserving(ptyId: string): void {
    if (this.observations.has(ptyId)) {
      return
    }
    const bySignal = new Map<
      DraftPasteReadySignal,
      ReturnType<typeof createComposerReadyObservation>
    >()
    for (const signal of PROVABLE_SIGNALS) {
      bySignal.set(signal, createComposerReadyObservation(signal))
    }
    this.observations.set(ptyId, bySignal)
  }

  /** Called for every PTY chunk. A PTY that was never begun is ignored, and
   *  each observation latches, so a settled or unwatched pane costs one lookup. */
  observe(ptyId: string, data: string): void {
    const bySignal = this.observations.get(ptyId)
    if (bySignal === undefined) {
      return
    }
    for (const observation of bySignal.values()) {
      if (!observation.settled()) {
        observation.observe(data)
      }
    }
  }

  state(ptyId: string, agent: TuiAgent | null): ComposerReadyState {
    const signal = composerReadySignalFor(agent)
    const observation = signal ? this.observations.get(ptyId)?.get(signal) : undefined
    if (!observation) {
      return 'unobserved'
    }
    // Why: the observation's own `unobserved` means "no bracketed-paste
    // handshake yet", which on a pane watched from spawn is still "not ready".
    return observation.state() === 'ready' ? 'ready' : 'awaiting-composer'
  }

  readyAt(ptyId: string, agent: TuiAgent | null): number | null {
    const signal = composerReadySignalFor(agent)
    if (!signal) {
      return null
    }
    return this.observations.get(ptyId)?.get(signal)?.readyAt() ?? null
  }

  forget(ptyId: string): void {
    this.observations.delete(ptyId)
  }

  /**
   * Resolves as soon as the composer-ready marker fires, and otherwise
   * classifies why it did not.
   *
   * A pane this runtime watched from spawn gets the full budget: while its
   * marker is missing the composer is genuinely not up yet, and that is the
   * window `tui-idle` hands the injector today. A pane it never watched
   * resolves `unobserved` immediately — waiting on evidence that could not
   * exist would be a sleep wearing a signal's clothes.
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
    const initial = this.state(ptyId, agent)
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
        resolve(settle(this.state(ptyId, agent)))
      }
      // Why: subscribe before re-reading the state so a marker landing between
      // the read and the subscription cannot be missed.
      unsubscribe = this.subscribe(ptyId, () => {
        if (this.state(ptyId, agent) === 'ready') {
          finish()
        }
      })
      if (this.state(ptyId, agent) === 'ready') {
        finish()
        return
      }
      // Why: an aborted RPC must not leave a long observation subscribed.
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
