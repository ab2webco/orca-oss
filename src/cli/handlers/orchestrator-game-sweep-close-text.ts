/** What `game sweep --close` did to one member, and its line in the sweep text. */
export type SweepClose =
  | {
      via: 'release'
      dispatchId: string
      state: string
      reason?: string
      recovery?: string
      /** The other dispatches of its host worktree this release freed too (ORCA-1076). */
      worktreeDispatches?: { dispatchId: string; state: string }[]
    }
  | { via: 'close'; terminal: string }
  /** A leftover found on a paired host: closed there, already gone, or kept mid-turn (ORCA-1424). */
  | { via: 'host'; host: string; terminal: string }
  | { via: 'host'; host: string; gone: true }
  | { via: 'host'; host: string; kept: string }
  | { via: 'release' | 'close' | 'host'; error: string }

export function formatSweepClose(closed: SweepClose | null | undefined): string {
  if (!closed) {
    return closed === null ? ' — nothing to close' : ''
  }
  if ('error' in closed) {
    return ` — ${closed.via} failed: ${closed.error}`
  }
  if (closed.via === 'host') {
    return 'terminal' in closed
      ? ` — closed ${closed.terminal} on ${closed.host}`
      : 'gone' in closed
        ? ` — its pane on ${closed.host} was already closed`
        : ` — kept on ${closed.host}: ${closed.kept}`
  }
  return closed.via === 'close'
    ? ` — closed ${closed.terminal}`
    : ` — release ${closed.dispatchId} [${closed.state}]${(closed.worktreeDispatches ?? []).map((other, index) => `${index === 0 ? ' with' : ','} ${other.dispatchId} [${other.state}]`).join('')}${closed.reason ? ` ${closed.reason}` : ''}`
}
