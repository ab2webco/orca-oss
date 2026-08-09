import type { DraftPasteReadySignal } from './tui-agent-config'
import { createDraftPasteReadyScanner } from './draft-paste-ready-scanner'

/**
 * Composer readiness of one PTY, as three distinguishable facts (ORCA-191):
 *
 *   - `ready`: the agent's own composer-ready marker fired after it enabled
 *     bracketed paste. Positive evidence that the composer accepts input.
 *   - `awaiting-composer`: bracketed paste was enabled and the marker has not
 *     fired. This is the window in which an injected preamble is swallowed by
 *     the startup redraw — but it is not proof of one, see below.
 *   - `unobserved`: not even a bracketed-paste enable seen.
 *
 * Neither negative state is evidence the pane is unready, so neither may refuse
 * a dispatch. Measured 2026-08-09: an interactive shell emits DECSET 2004 for
 * its own prompt, a real Codex pane emits it twice (shell, then TUI), and a
 * `codex`-named process that is not the TUI emits it zero times. The handshake
 * therefore separates nothing on its own, and only `ready` is positive.
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
 * dispatch gate and the startup draft paste cannot drift apart. A second scanner
 * on the marker-less default signal reports whether bracketed paste was enabled
 * at all, which is what separates `awaiting-composer` from `unobserved`.
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
  const bracketedPasteScanner = createDraftPasteReadyScanner('render-quiet-after-bracketed-paste')
  let bracketedPasteEnabled = false
  let markerAt: number | null = null

  return {
    observe(data: string): void {
      if (markerAt !== null) {
        return
      }
      // Why: the default signal has no marker, so `armQuietTimer` is exactly
      // "DECSET 2004 has been seen" — no second copy of the escape constant.
      if (!bracketedPasteEnabled && bracketedPasteScanner.observe(data).armQuietTimer) {
        bracketedPasteEnabled = true
      }
      if (markerScanner.observe(data).ready) {
        markerAt = now()
        bracketedPasteEnabled = true
      }
    },
    state(): ComposerReadyState {
      if (markerAt !== null) {
        return 'ready'
      }
      return bracketedPasteEnabled ? 'awaiting-composer' : 'unobserved'
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
