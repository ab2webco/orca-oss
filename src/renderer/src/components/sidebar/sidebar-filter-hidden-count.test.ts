import { describe, expect, it } from 'vitest'
import { countWorktreesHiddenByFilters } from './sidebar-filter-hidden-count'

describe('countWorktreesHiddenByFilters', () => {
  it('counts sorted worktrees that the filters left out', () => {
    expect(countWorktreesHiddenByFilters(['a', 'b', 'c', 'd'], ['a', 'c'])).toBe(2)
  })

  it('is zero when every sorted worktree is visible', () => {
    expect(countWorktreesHiddenByFilters(['a', 'b'], ['b', 'a'])).toBe(0)
  })

  it('ignores visible ids that are not in the sorted list', () => {
    expect(countWorktreesHiddenByFilters(['a'], ['a', 'z'])).toBe(0)
  })

  it('leaves out archived worktrees, which no filter hides', () => {
    const archived = new Set(['b'])
    expect(countWorktreesHiddenByFilters(['a', 'b', 'c'], ['a'], (id) => !archived.has(id))).toBe(1)
  })
})
