import type { PtySpawnResult } from '../providers/types'

export type PtyGrid = { cols: number; rows: number }

function positiveGrid(cols: unknown, rows: unknown): PtyGrid | undefined {
  return typeof cols === 'number' &&
    typeof rows === 'number' &&
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols > 0 &&
    rows > 0
    ? { cols, rows }
    : undefined
}

/**
 * Grid to record for a settled spawn.
 *
 * Why not simply the requested one: a reattach hands back a session that is
 * already running at its own geometry — the daemon never resizes it to match
 * the caller. The requested grid describes the PANE, and a pane that mounted
 * while hidden reports xterm's unmeasured 80x24 default. Recording that made
 * main believe a live 176-column session was 80 wide, and every later
 * size decision inherited the lie.
 *
 * Order of trust: the grid the snapshot was captured at, then the size main
 * already held before the attach, and only then the request. A fresh spawn is
 * unaffected — there the request IS the truth.
 *
 * Port of upstream 30d7542bc5 (#18706), minus its `attachedGrid` — this fork's
 * providers do not report one, and the chain simply falls through to the
 * snapshot grid, which the daemon adapter does populate.
 */
export function resolveCommittedPtySize(args: {
  result: Pick<PtySpawnResult, 'isReattach' | 'snapshotCols' | 'snapshotRows'>
  requested: PtyGrid
  cachedBeforeAttach: PtyGrid | undefined
}): PtyGrid {
  if (args.result.isReattach !== true) {
    return args.requested
  }
  return (
    positiveGrid(args.result.snapshotCols, args.result.snapshotRows) ??
    positiveGrid(args.cachedBeforeAttach?.cols, args.cachedBeforeAttach?.rows) ??
    args.requested
  )
}
