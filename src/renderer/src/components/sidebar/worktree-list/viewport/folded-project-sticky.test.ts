import { describe, expect, it } from 'vitest'
import type { VirtualItem } from '@tanstack/react-virtual'
import { worktree } from '../../worktree-list-groups-test-fixtures'
import type { RenderRow } from '../listing/render-row'
import type { IdleProjectFold } from '../grouping/row-types'
import {
  GROUP_HEADER_ROW_HEIGHT,
  estimateRenderRowSize,
  getActiveStickyIndexesForScroll,
  getStickyHeaderIndexes,
  shouldUseHeaderTopSpacing
} from './virtual-rows'

function fold(state: IdleProjectFold['state']): IdleProjectFold {
  return { state, key: 'idle-open:x', workspaceCount: 2, openWorktree: worktree, worktreeIds: [] }
}

function header(key: string, foldState?: IdleProjectFold['state']): RenderRow {
  return {
    type: 'header',
    key,
    label: key,
    count: 2,
    tone: 'text-foreground',
    projectGroupDepth: 0,
    ...(foldState ? { fold: fold(foldState) } : {})
  }
}

function item(id: string): RenderRow {
  return {
    type: 'item',
    rowKey: id,
    sectionKey: 'repo:a',
    worktree: { ...worktree, id },
    repo: undefined,
    depth: 0,
    groupDepth: 0,
    lineageTrail: [],
    isLastLineageChild: false,
    lineageChildCount: 0
  }
}

// active A (2 rows), folded B, folded C, opened D (1 row)
const rows: RenderRow[] = [
  header('repo:a'),
  item('a1'),
  item('a2'),
  header('repo:b', 'folded'),
  header('repo:c', 'folded'),
  header('repo:d', 'open'),
  item('d1')
]
const starts = [0, 28, 144, 260, 288, 316, 344]
const virtualItems = starts.map(
  (start, index) =>
    ({
      index,
      start,
      end: starts[index + 1] ?? start + 116,
      size: 0,
      key: index,
      lane: 0
    }) as VirtualItem
)
const stickyHeaderIndexes = getStickyHeaderIndexes(rows)

function pinnedAt(rangeStartIndex: number, scrollOffset: number): number | null {
  return getActiveStickyIndexesForScroll({
    rows,
    rangeStartIndex,
    scrollOffset,
    stickyHeaderIndexes,
    virtualItems
  }).groupIndex
}

describe('folded idle project and the sticky tier', () => {
  it('pins the expanded project while its rows scroll under it', () => {
    expect(pinnedAt(1, 100)).toBe(0)
  })

  it('ends the previous pin at a folded row and never pins the folded row itself', () => {
    expect(pinnedAt(3, 262)).toBeNull()
    expect(pinnedAt(4, 290)).toBeNull()
  })

  it('pins an idle project once it is opened with the chevron', () => {
    expect(pinnedAt(6, 330)).toBe(5)
  })
})

describe('folded idle project size', () => {
  it('stacks consecutive folded rows with no inter-group spacer, so the estimate is one header', () => {
    expect(shouldUseHeaderTopSpacing({ rows, index: 3, firstHeaderIndex: 0 })).toBe(true)
    expect(shouldUseHeaderTopSpacing({ rows, index: 4, firstHeaderIndex: 0 })).toBe(false)
    expect(estimateRenderRowSize(rows, 4, 0, null)).toBe(GROUP_HEADER_ROW_HEIGHT)
    // Why: an opened project after a folded one is a new section again and keeps its spacer.
    expect(shouldUseHeaderTopSpacing({ rows, index: 5, firstHeaderIndex: 0 })).toBe(true)
  })
})
