import type { Row } from './worktree-list/grouping/row-types'

/** A host section's workspace count and ids, for its header. */
export function countWorktreeRows(rows: readonly Row[]): { count: number; worktreeIds: string[] } {
  // Why: a collapsed repo group contributes a header row but no item rows;
  // fall back to the header's own count so the host badge doesn't read 0
  // while a visibly populated project sits right under it.
  let count = 0
  const seenWorktreeIds = new Set<string>()
  let pendingHeader: Extract<Row, { type: 'header' }> | null = null
  let pendingHeaderHadItems = false
  const flushHeader = (): void => {
    if (pendingHeader && !pendingHeaderHadItems) {
      if (pendingHeader.worktreeIds) {
        for (const worktreeId of pendingHeader.worktreeIds) {
          if (!seenWorktreeIds.has(worktreeId)) {
            count += 1
            seenWorktreeIds.add(worktreeId)
          }
        }
      } else {
        count += pendingHeader.count
      }
    }
    pendingHeader = null
    pendingHeaderHadItems = false
  }
  for (const row of rows) {
    if (row.type === 'header') {
      flushHeader()
      pendingHeader = row
      continue
    }
    if (row.type === 'item') {
      if (!seenWorktreeIds.has(row.worktree.id)) {
        count += 1
        seenWorktreeIds.add(row.worktree.id)
      }
      pendingHeaderHadItems = pendingHeader !== null
    }
  }
  flushHeader()
  return { count, worktreeIds: [...seenWorktreeIds] }
}
