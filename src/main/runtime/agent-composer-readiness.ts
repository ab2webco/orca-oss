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

// Why: how long the injector holds for proof the composer mounted. Sized over
// the measured gap between tui-idle and composer-ready, because that gap is the
// race: live Codex runs put the marker 1.0-1.2 s after tui-idle, and ORCA-171's
// worst measured gap was 4.1 s on a cold start. 10 s is ~2.4x that worst case.
//
// Sized generously on purpose, because the two failure directions are not
// symmetric now that expiry no longer refuses. Too small and the injector
// writes into a composer that was still mounting — ORCA-191's own defect,
// merely visible at the 11-minute deadline instead of silent. Too large costs
// latency only, and only for panes that will never mark ready (a wrapper, a
// shim, a test double); agents with no provable marker never enter the wait.
// Measured 2026-08-09 on this machine: the three orchestration E2E specs this
// gate broke pass at both 5 s and 10 s, so the E2E does not pick the number.
// (An earlier note here claimed 8 s and 13 s failed those specs on delay alone.
// Not reproduced — 10 s passes; do not restore that claim without new runs.)
export const AGENT_COMPOSER_READY_TIMEOUT_MS = 10_000

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
 * Observation starts at `beginObserving`, which the runtime calls when it
 * registers a PTY it is spawning. A pane this runtime never registered
 * (restored or adopted after a restart) is never observed and always answers
 * `unobserved` — absence of evidence, never a refusal, which is what keeps
 * `dispatch --inject` usable on a stalled run.
 *
 * Only the marker itself proves readiness: no precursor — not the handshake,
 * not alt-screen, not the agent's name — can stand in for it. The live DECSET/
 * DECRST 2004 state is not used as a stand-in but as the marker's own
 * precondition, and that is all it decides: whether a marker is pending and so
 * whether `wait` has anything to wait for. See `wait` for the measurements.
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
    return this.observationFor(ptyId, agent)?.state() ?? 'unobserved'
  }

  private observationFor(
    ptyId: string,
    agent: TuiAgent | null
  ): ReturnType<typeof createComposerReadyObservation> | undefined {
    const signal = composerReadySignalFor(agent)
    return signal ? this.observations.get(ptyId)?.get(signal) : undefined
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
   * Waits for the agent's own composer-ready marker, bounded, and reports
   * whether it ever arrived. **It never refuses.**
   *
   * The wait is the fix: for any agent that signals composer mount — Codex,
   * the agent in the incident — the injector no longer writes during the boot
   * window that `tui-idle` hands it.
   *
   * Expiry proceeds unproven, because nothing in the byte stream proves a TUI
   * whose composer has not mounted will ever mount one. What the stream does
   * carry is the marker's own precondition, and that is what bounds the wait:
   * the scanner cannot fire before DECSET 2004, so the wait happens only while
   * the pane is holding the handshake. `unobserved` is not "the marker has not
   * come yet" — it is "no marker is pending", and it resolves at once.
   *
   * Measured on this machine 2026-08-09, t0 = the agent launch submitted into
   * an interactive zsh: the shell's own DECSET 2004 at -280 ms, its DECRST at
   * +35 ms as it hands the pane over, and the agent's own DECSET at +120 ms
   * (codex 116-128 ms, opencode 117 ms). A `codex`-named process that is not
   * the TUI never emits that third event. Injection happens after `tui-idle`,
   * i.e. no earlier than ~1.7 s in, by which point a booting agent has held the
   * handshake for well over a second and a non-TUI child has not held it at
   * all. Residual window: a pane whose `tui-idle` were satisfied inside the
   * ~85 ms between the shell's DECRST and the agent's DECSET would inject
   * unproven, which is the pre-fix behaviour and is what the deadline catches.
   *
   * Not evidence, and deliberately not used: matching an agent's name says
   * nothing, since a wrapper, a shim, an older build or a test double all
   * present as `codex`; Codex uses no alt-screen; and a latched handshake says
   * only that *something*, usually the shell, once enabled bracketed paste.
   * Refusing on a missing marker denies delivery on absence of evidence — it
   * broke three orchestration E2E specs, each leaving a bare shell prompt and
   * no dispatch row.
   *
   * Honest limit: a pane parked at a shell prompt with no agent in it holds the
   * handshake, so a dispatch aimed there pays the full budget. That costs
   * latency, never a refusal.
   *
   * What replaces the refusal is a recorded fact: `proven` rides to the caller
   * and onto the dispatch row, so if the preamble really was swallowed, slice
   * 1's first-signal deadline says readiness was never proven for this pane
   * instead of failing mute.
   */
  async wait(
    ptyId: string,
    agent: TuiAgent | null,
    timeoutMs: number,
    options: {
      abortSignal?: AbortSignal
      now?: () => number
      /**
       * Hold the whole budget even with no marker pending. Only the `wait --for
       * composer-ready` inspection surface sets it: a caller who asked to be
       * told when a pane becomes ready may spend its own budget on a pane that
       * has not started mounting yet. The dispatch injector may not — the wait
       * it does not spend is latency on every dispatch into a pane that holds
       * no composer, and that latency is what broke three E2E specs.
       */
      holdWithoutPendingMarker?: boolean
    } = {}
  ): Promise<AgentComposerReadiness> {
    const now = options.now ?? Date.now
    const startedAt = now()
    const signal = composerReadySignalFor(agent)
    const settle = (state: ComposerReadyState): AgentComposerReadiness => ({
      // Why: always ready. `proven` carries the difference; see the note above.
      ready: true,
      proven: state === 'ready',
      state,
      signal,
      waitedMs: now() - startedAt
    })
    // Why: `ready` needs no wait, and `unobserved` — no observation at all, or
    // a pane not holding the handshake the marker needs — has none pending.
    const observed = this.state(ptyId, agent)
    const canPend = this.observationFor(ptyId, agent) !== undefined
    if (observed === 'ready' || !canPend) {
      return settle(observed)
    }
    if (observed === 'unobserved' && !options.holdWithoutPendingMarker) {
      return settle(observed)
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
      // Why: the marker fired, or — for the injector — the pane gave the
      // handshake back and nothing is mounting a composer any more.
      const settled = (): boolean =>
        this.state(ptyId, agent) === 'ready' ||
        (!options.holdWithoutPendingMarker && this.state(ptyId, agent) === 'unobserved')
      // Why: subscribe before re-reading the state so a marker landing between
      // the read and the subscription cannot be missed.
      unsubscribe = this.subscribe(ptyId, () => {
        if (settled()) {
          finish()
        }
      })
      if (settled()) {
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
