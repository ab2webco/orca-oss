type TerminalDims = { cols: number; rows: number }

export type MobileTerminalSnapshotDims = {
  /** Dims the subscribe snapshot announces; the client sizes its xterm to these. */
  announced: TerminalDims | null
  /** Applied layout dims to send as a Resized frame right after the snapshot, when they differ. */
  catchUp: TerminalDims | null
}

/**
 * Why (ORCA-1237): before a PTY's first byte there is no headless model, so the snapshot comes
 * from the hidden desktop xterm (80x24) while the phone fit has already applied its layout — and
 * that resize fired before the stream's resize listener existed. A phone told the stale dims draws
 * the TUI's later frames off-screen and looks frozen until it re-enters. The applied layout is the
 * authority: the cached PTY size can lag it right after a respawn.
 */
export function resolveMobileTerminalSnapshotDims(args: {
  isMobile: boolean
  snapshot: (TerminalDims & { data?: string }) | null
  ptySize: TerminalDims | null
  appliedLayout: TerminalDims | null
}): MobileTerminalSnapshotDims {
  const { isMobile, snapshot, ptySize, appliedLayout } = args
  const announced = snapshot ?? ptySize
  if (!isMobile || !appliedLayout || !announced || sameDims(announced, appliedLayout)) {
    return { announced: announced ? pickDims(announced) : null, catchUp: null }
  }
  // A blank snapshot has no layout to preserve, so it can simply carry the applied dims.
  if (!snapshot?.data) {
    return { announced: pickDims(appliedLayout), catchUp: null }
  }
  // Content was laid out at the snapshot's dims; replay it there, then move the xterm.
  return { announced: pickDims(snapshot), catchUp: pickDims(appliedLayout) }
}

function pickDims(dims: TerminalDims): TerminalDims {
  return { cols: dims.cols, rows: dims.rows }
}

function sameDims(a: TerminalDims, b: TerminalDims): boolean {
  return a.cols === b.cols && a.rows === b.rows
}
