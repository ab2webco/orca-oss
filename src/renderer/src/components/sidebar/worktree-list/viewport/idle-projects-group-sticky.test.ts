import { describe, expect, it } from 'vitest'
import type { VirtualItem } from '@tanstack/react-virtual'
import { worktree } from '../../worktree-list-groups-test-fixtures'
import type { RenderRow } from '../listing/render-row'
import { IDLE_PROJECTS_GROUP_KEY } from '../grouping/group-keys'
import {
  GROUP_HEADER_ROW_HEIGHT,
  estimateRenderRowSize,
  getActiveStickyIndexesForScroll,
  getStickyHeaderIndexes,
  shouldUseHeaderTopSpacing
} from './virtual-rows'

const idleGroup: RenderRow = {
  type: 'header',
  key: IDLE_PROJECTS_GROUP_KEY,
  label: 'Idle',
  count: 2,
  tone: 'text-foreground',
  idleProjectsGroup: { collapsed: false },
  worktreeIds: []
}

function project(key: string, folded: boolean): RenderRow {
  return {
    type: 'header',
    key,
    label: key,
    count: 1,
    tone: 'text-foreground',
    projectGroupDepth: 0,
    ...(folded
      ? {
          fold: {
            state: 'folded' as const,
            key: `idle-open:${key}`,
            workspaceCount: 1,
            openWorktree: worktree,
            worktreeIds: []
          }
        }
      : {})
  }
}

const item: RenderRow = {
  type: 'item',
  rowKey: 'a1',
  sectionKey: 'repo:a',
  worktree: { ...worktree, id: 'a1' },
  repo: undefined,
  depth: 0,
  groupDepth: 0,
  lineageTrail: [],
  isLastLineageChild: false,
  lineageChildCount: 0
}

// active A (1 row), the idle group, folded B, folded C
const rows: RenderRow[] = [
  project('repo:a', false),
  item,
  idleGroup,
  project('repo:b', true),
  project('repo:c', true)
]
const starts = [0, 28, 144, 176, 204]
const virtualItems = starts.map(
  (start, index) =>
    ({
      index,
      start,
      end: starts[index + 1] ?? start + 28,
      size: 0,
      key: index,
      lane: 0
    }) as VirtualItem
)

describe('the idle projects group in the viewport', () => {
  it('never pins: reaching it only ends the active project pin', () => {
    const pinned = getActiveStickyIndexesForScroll({
      rows,
      rangeStartIndex: 2,
      scrollOffset: 150,
      stickyHeaderIndexes: getStickyHeaderIndexes(rows),
      virtualItems
    })
    expect(pinned.groupIndex).toBeNull()
  })

  it('opens with a gap above it, and its first folded project sits flush under it', () => {
    expect(shouldUseHeaderTopSpacing({ rows, index: 2, firstHeaderIndex: 0 })).toBe(true)
    expect(shouldUseHeaderTopSpacing({ rows, index: 3, firstHeaderIndex: 0 })).toBe(false)
    expect(estimateRenderRowSize(rows, 3, 0, null)).toBe(GROUP_HEADER_ROW_HEIGHT)
  })
})
