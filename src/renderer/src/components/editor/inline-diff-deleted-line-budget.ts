import { countLinesEmptyAsZeroUpToLimit } from './large-diff-render-limit'

/**
 * Inline (unified) Monaco diffs render every deleted line into a view zone, and
 * those view zones are built eagerly for the whole region — unlike side-by-side,
 * which only ever renders the viewport. The DOM this materializes lives outside
 * the V8 heap, so the renderer heap ceiling does not cap it. Cap the deleted
 * lines an inline diff may materialize; over-budget diffs render side by side
 * rather than losing the diff to the summary fallback.
 */
export const MAX_INLINE_RENDERED_DELETED_LINES = 2_000

type InlineDiffContent = {
  originalContent: string
  modifiedContent: string
}

function forEachLine(content: string, visit: (line: string) => void): void {
  let start = 0
  while (start <= content.length) {
    const end = content.indexOf('\n', start)
    if (end === -1) {
      visit(content.slice(start))
      return
    }
    visit(content.slice(start, end))
    start = end + 1
  }
}

/**
 * Original lines with no counterpart in the modified side, stopping at `limit + 1`.
 * Order-insensitive, so it is a lower bound on what Monaco renders as deleted —
 * never an over-count that would degrade an ordinary diff.
 */
export function countUnmatchedOriginalLines(
  originalContent: string,
  modifiedContent: string,
  limit: number
): number {
  const modifiedLineCounts = new Map<string, number>()
  forEachLine(modifiedContent, (line) => {
    modifiedLineCounts.set(line, (modifiedLineCounts.get(line) ?? 0) + 1)
  })

  let unmatched = 0
  forEachLine(originalContent, (line) => {
    if (unmatched > limit) {
      return
    }
    const available = modifiedLineCounts.get(line)
    if (available === undefined || available === 0) {
      unmatched += 1
      return
    }
    modifiedLineCounts.set(line, available - 1)
  })
  return unmatched
}

/** Skips the line-matching pass when the original side is too small to reach the budget. */
export function exceedsInlineDeletedLineBudget({
  originalContent,
  modifiedContent
}: InlineDiffContent): boolean {
  const originalLines = countLinesEmptyAsZeroUpToLimit(
    originalContent,
    MAX_INLINE_RENDERED_DELETED_LINES
  )
  if (!originalLines.exceeded) {
    return false
  }
  return (
    countUnmatchedOriginalLines(
      originalContent,
      modifiedContent,
      MAX_INLINE_RENDERED_DELETED_LINES
    ) > MAX_INLINE_RENDERED_DELETED_LINES
  )
}
