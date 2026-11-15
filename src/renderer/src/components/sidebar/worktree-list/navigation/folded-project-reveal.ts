import type { RenderRow } from '../listing/render-row'

/** Open keys of the folded idle projects whose fold hides `worktreeId`. */
export function getFoldedProjectRevealKeys(
  rows: readonly RenderRow[],
  worktreeId: string
): string[] {
  const keys: string[] = []
  for (const row of rows) {
    if (
      row.type === 'header' &&
      row.fold?.state === 'folded' &&
      row.fold.worktreeIds.includes(worktreeId) &&
      !keys.includes(row.fold.key)
    ) {
      keys.push(row.fold.key)
    }
  }
  return keys
}
