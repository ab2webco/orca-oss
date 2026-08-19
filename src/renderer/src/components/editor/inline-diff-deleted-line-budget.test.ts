import { describe, expect, it } from 'vitest'
import {
  MAX_INLINE_RENDERED_DELETED_LINES,
  countUnmatchedOriginalLines,
  exceedsInlineDeletedLineBudget
} from './inline-diff-deleted-line-budget'

function buildLines(count: number, revision: string): string {
  const lines: string[] = []
  for (let index = 0; index < count; index += 1) {
    lines.push(`export const value_${index} = '${revision}'`)
  }
  return `${lines.join('\n')}\n`
}

describe('countUnmatchedOriginalLines', () => {
  it('counts nothing when both sides are identical', () => {
    const content = buildLines(50, 'base')
    expect(countUnmatchedOriginalLines(content, content, 100)).toBe(0)
  })

  it('counts only the lines with no counterpart', () => {
    const original = 'a\nb\nc\nd\n'
    const modified = 'a\nB\nc\nD\n'
    expect(countUnmatchedOriginalLines(original, modified, 100)).toBe(2)
  })

  it('treats repeated lines as a multiset instead of a set', () => {
    expect(countUnmatchedOriginalLines('a\na\na\n', 'a\n', 100)).toBe(2)
  })

  it('does not count reordered lines as deleted', () => {
    expect(countUnmatchedOriginalLines('a\nb\nc\n', 'c\nb\na\n', 100)).toBe(0)
  })

  it('stops counting one past the limit', () => {
    const original = buildLines(500, 'base')
    const modified = buildLines(500, 'changed')
    expect(countUnmatchedOriginalLines(original, modified, 10)).toBe(11)
  })
})

describe('exceedsInlineDeletedLineBudget', () => {
  it('stays inline for a whole-file insertion, which deletes nothing', () => {
    expect(
      exceedsInlineDeletedLineBudget({
        originalContent: 'export const seed = 1\n',
        modifiedContent: buildLines(MAX_INLINE_RENDERED_DELETED_LINES * 30, 'base')
      })
    ).toBe(false)
  })

  it('stays inline for a one-line edit in a file far past the budget', () => {
    const original = buildLines(MAX_INLINE_RENDERED_DELETED_LINES * 10, 'base')
    const modified = original.replace(
      "export const value_7 = 'base'",
      "export const value_7 = 'edited'"
    )
    expect(
      exceedsInlineDeletedLineBudget({ originalContent: original, modifiedContent: modified })
    ).toBe(false)
  })

  it('stays inline when every line changes but the file is under the budget', () => {
    const lineCount = MAX_INLINE_RENDERED_DELETED_LINES - 1
    expect(
      exceedsInlineDeletedLineBudget({
        originalContent: buildLines(lineCount, 'base'),
        modifiedContent: buildLines(lineCount, 'changed')
      })
    ).toBe(false)
  })

  it('leaves inline rendering exactly at the budget', () => {
    expect(
      exceedsInlineDeletedLineBudget({
        originalContent: buildLines(MAX_INLINE_RENDERED_DELETED_LINES, 'base'),
        modifiedContent: buildLines(MAX_INLINE_RENDERED_DELETED_LINES, 'changed')
      })
    ).toBe(false)
  })

  it('engages one line past the budget', () => {
    const lineCount = MAX_INLINE_RENDERED_DELETED_LINES + 2
    expect(
      exceedsInlineDeletedLineBudget({
        originalContent: buildLines(lineCount, 'base'),
        modifiedContent: buildLines(lineCount, 'changed')
      })
    ).toBe(true)
  })

  it('engages for a large contiguous rewrite inside a larger file', () => {
    const total = MAX_INLINE_RENDERED_DELETED_LINES * 4
    const original = buildLines(total, 'base')
    const rewritten = buildLines(total, 'base')
      .split('\n')
      .map((line, index) =>
        index > 100 && index <= 100 + MAX_INLINE_RENDERED_DELETED_LINES * 2
          ? line.replace("'base'", "'changed'")
          : line
      )
      .join('\n')
    expect(
      exceedsInlineDeletedLineBudget({ originalContent: original, modifiedContent: rewritten })
    ).toBe(true)
  })

  it('handles empty content on either side', () => {
    expect(exceedsInlineDeletedLineBudget({ originalContent: '', modifiedContent: '' })).toBe(false)
    expect(
      exceedsInlineDeletedLineBudget({
        originalContent: buildLines(MAX_INLINE_RENDERED_DELETED_LINES * 2, 'base'),
        modifiedContent: ''
      })
    ).toBe(true)
  })
})
