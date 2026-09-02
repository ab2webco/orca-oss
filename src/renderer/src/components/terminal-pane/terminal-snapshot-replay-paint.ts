import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'
import { readProposedPaneFitDimensions } from '@/lib/pane-manager/pane-fit'
import {
  ABORT_TRUNCATED_CONTROL_STRING,
  buildSnapshotReplayPrologue
} from '../../../../shared/terminal-mode-reset-profiles'

/**
 * Shared guards and write choreography for painting a main-model snapshot into
 * a (possibly fresh) xterm. One source for the reattach/hidden-restore paint
 * paths so their dimension guards and alt-screen branches cannot drift.
 */

/** True only for finite positive numeric cols/rows — Infinity/NaN/undefined
 *  from a malformed snapshot must degrade to "no resize", never reach
 *  terminal.resize(). */
export function hasPositiveTerminalDimensions(cols: unknown, rows: unknown): boolean {
  return (
    typeof cols === 'number' &&
    typeof rows === 'number' &&
    Number.isFinite(cols) &&
    Number.isFinite(rows) &&
    cols > 0 &&
    rows > 0
  )
}

/** Narrowing form of hasPositiveTerminalDimensions for optional-typed payloads. */
export function resolvePositiveTerminalDimensions(
  cols: unknown,
  rows: unknown
): { cols: number; rows: number } | null {
  return hasPositiveTerminalDimensions(cols, rows)
    ? { cols: cols as number, rows: rows as number }
    : null
}

/**
 * The column count the post-replay fit will land on. Why not terminal.cols: a
 * pane that has not been fitted yet still reads xterm's 80-column default, so
 * comparing against it would drop frames whose width actually matches the
 * container. Returns undefined when the pane cannot be measured, so replay can
 * retain the frame at its capture grid until a final fit exists.
 */
export function readProposedTerminalCols(pane: ManagedPane): number | undefined {
  return readProposedPaneFitDimensions(pane)?.cols
}

/**
 * Diverges from upstream on purpose: upstream also skips when the target grid is
 * unmeasurable (its `skipIfTargetUnknown`), betting a live app repaints after the
 * deferred fit. A hidden pane whose process already exited has no such repaint, so
 * that bet drops the only copy of the screen. Skipping stays for a *measured*
 * narrower grid, which is the clipping upstream set out to fix. The two
 * pty-connection tests named "keeps a ... alt frame ... cannot ... measure" are
 * what fails if a sync restores the option, so keep them with this.
 */
export function shouldSkipAltFrameForWidthMismatch(
  snapshotCols: number | undefined,
  targetCols: number | undefined
): boolean {
  if (typeof snapshotCols !== 'number' || !Number.isFinite(snapshotCols) || snapshotCols <= 0) {
    return false
  }
  if (typeof targetCols !== 'number' || !Number.isFinite(targetCols) || targetCols <= 0) {
    // Keep the frame at its capture grid until a real fit can replace that grid.
    return false
  }
  // Fixed-grid alt rows clip at narrower columns; normal history remains reflowable.
  return snapshotCols > targetCols
}

/**
 * Ordered replay writes for a main-model snapshot, including the alt-screen
 * choreography: main strips the `?1049h` marker when splitting scrollbackAnsi
 * from an alt frame, so the restorer owns the transition — rebuild the normal
 * buffer while on it, then paint the alt frame clean. Callers write these
 * before their post-replay reset/escape-tail sequences.
 *
 * `skipAltFrame` drops only the frame paint, never the buffer choreography or
 * scrollback or mode rehydration: the alt buffer is still entered and cleared
 * so the caller's SIGWINCH lands on a clean screen the application repaints.
 */
export function buildMainModelSnapshotReplayWrites(
  snapshot: {
    data: string
    /** Live state that can be restored without an alternate-screen frame. */
    frameRestoreAnsi?: string
    alternateScreen?: boolean
    scrollbackAnsi?: string
  },
  options: { skipAltFrame?: boolean; paneOnAlternateScreen?: boolean } = {}
): string[] {
  // Only the head write aborts the truncated control string: it grounds the
  // parser for everything after it, and a second CAN mid-sequence would abort
  // the prologue we just emitted.
  const head = (targetAlternateScreen: boolean): string =>
    `${ABORT_TRUNCATED_CONTROL_STRING}${buildSnapshotReplayPrologue({
      targetAlternateScreen,
      paneOnAlternateScreen: options.paneOnAlternateScreen === true
    })}`

  if (!snapshot.alternateScreen) {
    return [head(false), snapshot.data]
  }
  // Older snapshot producers do not expose the mode/frame boundary. Keep their
  // composed data rather than dropping terminal modes together with the frame.
  const altFrame =
    options.skipAltFrame && snapshot.frameRestoreAnsi !== undefined
      ? [snapshot.frameRestoreAnsi]
      : [snapshot.data]
  if (snapshot.scrollbackAnsi !== undefined) {
    // Why: main serializes normal + alt buffers separately; rebuild normal
    // while active, then return to a clean alt frame. The head already put the
    // pane on the normal buffer, so the return switch grounds from there.
    return [
      head(false),
      snapshot.scrollbackAnsi,
      buildSnapshotReplayPrologue({
        targetAlternateScreen: true,
        paneOnAlternateScreen: false
      }),
      ...altFrame
    ]
  }
  return [head(true), ...altFrame]
}
