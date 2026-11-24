/**
 * The rows game.state reads, plus the caller's own when this host reports it under another worktree.
 * Why: a row sits under its tab's worktree, which can differ from the one the caller names, and a
 * lead without its row had no leader, so its Team panel showed no team (ORCA-1402).
 */
export function withCallerOwnRow<R extends { paneKey: string }>(
  rows: R[],
  summaries: readonly { agents: readonly R[] }[],
  paneKey: string | null
): R[] {
  if (!paneKey || rows.some((one) => one.paneKey === paneKey)) {
    return rows
  }
  const own = summaries.flatMap((one) => one.agents).find((one) => one.paneKey === paneKey)
  return own ? [...rows, own] : rows
}
