import type { DraftPasteReadySignal } from './tui-agent-config'
import {
  createDraftPasteReadyScanner,
  DECRST_BRACKETED_PASTE,
  DECSET_BRACKETED_PASTE
} from './draft-paste-ready-scanner'

/**
 * Composer readiness of one PTY, as three distinguishable facts (ORCA-191):
 *
 *   - `ready`: the agent's own composer-ready marker fired after it enabled
 *     bracketed paste. Positive evidence that the composer accepts input.
 *   - `awaiting-composer`: bracketed paste is enabled **right now** and the
 *     marker has not fired. This is the window in which an injected preamble is
 *     swallowed by the startup redraw.
 *   - `unobserved`: no live bracketed-paste handshake — nothing in this pane is
 *     currently holding a composer that could mark itself ready.
 *
 * Only `ready` is positive, so neither negative state may refuse a dispatch.
 * But the two negatives are not equally uninformative, and the difference is
 * what bounds the wait. Bracketed paste is the marker's own precondition: the
 * ready scanner cannot fire before DECSET 2004, so a pane that is not holding
 * the handshake has no pending marker to wait for.
 *
 * Tracking it as a live toggle rather than a latch is what makes the fact
 * usable, because the shell enables it for its own prompt. Measured on this
 * machine, 2026-08-09, from an interactive zsh at a prompt (t0 = the agent
 * launch command submitted):
 *
 *   -280 ms   DECSET 2004   the shell, for its own line editor
 *    +35 ms   DECRST 2004   the shell hands the pane to the child
 *   +120 ms   DECSET 2004   codex, and opencode, entering their own input mode
 *
 * A `codex`-named process that is not the TUI never emits that third event, so
 * the pane sits with bracketed paste off. A latch cannot tell the two apart —
 * both saw a handshake — while the live state can: at inject time, which is
 * after `tui-idle` and therefore at least ~1.7 s in, a booting agent has held
 * the handshake for well over a second and a non-TUI child has not.
 *
 * `tui-idle` cannot tell `ready` from `awaiting-composer`: it is satisfied by
 * stored idle/title state, a known-ready preview, or foreground quiescence, all
 * of which Codex reaches ~3-4 s before its composer accepts input (measured on
 * ORCA-171).
 */
export type ComposerReadyState = 'ready' | 'awaiting-composer' | 'unobserved'

export type ComposerReadyObservation = {
  /** Feed one raw PTY chunk. No-op once the marker has fired. */
  observe: (data: string) => void
  state: () => ComposerReadyState
  /** Wall-clock of the marker, from the timestamp passed to `observe`. */
  readyAt: () => number | null
  /** True once no further chunk can change the answer — stop feeding. */
  settled: () => boolean
}

/**
 * Tracks one PTY's composer readiness for one agent signal, for the PTY's whole
 * lifetime. Long-lived on purpose: at inject time the question is "has this
 * composer ever been ready", and a scanner armed at inject time cannot answer it
 * for a pane that booted an hour ago — its bracketed-paste enable is long out of
 * any replay window.
 *
 * The marker match itself is delegated to `createDraftPasteReadyScanner`, so the
 * dispatch gate and the startup draft paste cannot drift apart. Alongside it,
 * the DECSET/DECRST 2004 toggle is tracked directly, because the scanner latches
 * its handshake and the live state is what separates `awaiting-composer` from
 * `unobserved`.
 *
 * Honest limit: over a whole PTY lifetime a single-glyph marker (Codex's `›`)
 * can appear in agent output rather than the composer, latching `ready` early. A
 * false `ready` degrades the gate to today's behaviour; it never blocks a send.
 */
export function createComposerReadyObservation(
  readySignal: DraftPasteReadySignal,
  now: () => number = Date.now
): ComposerReadyObservation {
  const markerScanner = createDraftPasteReadyScanner(readySignal)
  // Why: 7 bytes is one less than the escape sequence, so a toggle split across
  // any chunk boundary is still seen exactly once.
  const carryLength = DECSET_BRACKETED_PASTE.length - 1
  let carry = ''
  let bracketedPasteOn = false
  let markerAt: number | null = null

  return {
    observe(data: string): void {
      if (markerAt !== null) {
        return
      }
      const combined = carry + data
      const enabledAt = combined.lastIndexOf(DECSET_BRACKETED_PASTE)
      const disabledAt = combined.lastIndexOf(DECRST_BRACKETED_PASTE)
      if (enabledAt !== -1 || disabledAt !== -1) {
        bracketedPasteOn = enabledAt > disabledAt
      }
      carry = combined.slice(-carryLength)
      if (markerScanner.observe(data).ready) {
        markerAt = now()
        bracketedPasteOn = true
      }
    },
    state(): ComposerReadyState {
      if (markerAt !== null) {
        return 'ready'
      }
      return bracketedPasteOn ? 'awaiting-composer' : 'unobserved'
    },
    readyAt(): number | null {
      return markerAt
    },
    settled(): boolean {
      return markerAt !== null
    }
  }
}

/**
 * The signals whose readiness this runtime can actually prove from the byte
 * stream. `render-quiet-after-bracketed-paste` is a timer, not evidence, so an
 * agent carrying it gets no gate rather than a fabricated one.
 */
export function isProvableComposerReadySignal(
  signal: DraftPasteReadySignal | undefined
): signal is Exclude<DraftPasteReadySignal, 'render-quiet-after-bracketed-paste'> {
  return signal === 'codex-composer-prompt' || signal === 'render-cursor-after-bracketed-paste'
}
