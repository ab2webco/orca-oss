import type { RenderRow } from '../listing/render-row'

/** Keys to toggle so `worktreeId` renders: a collapsed idle group, then the folded project in it. */
export function getFoldedProjectRevealKeys(
  rows: readonly RenderRow[],
  worktreeId: string
): string[] {
  const keys: string[] = []
  for (const row of rows) {
    if (row.type !== 'header') {
      continue
    }
    const key =
      row.idleProjectsGroup?.collapsed && row.worktreeIds?.includes(worktreeId)
        ? row.key
        : row.fold?.state === 'folded' && row.fold.worktreeIds.includes(worktreeId)
          ? row.fold.key
          : null
    if (key && !keys.includes(key)) {
      keys.push(key)
    }
  }
  return keys
}
