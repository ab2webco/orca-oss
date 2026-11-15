import { describe, expect, it, vi } from 'vitest'
import { worktree } from '../../worktree-list-groups-test-fixtures'
import type { RenderRow } from '../listing/render-row'
import type { IdleProjectFold } from '../grouping/row-types'
import { getFoldedProjectRevealKeys } from './folded-project-reveal'
import { expandGroupsForWorktreeReveal } from './pending-reveal-inputs'
import type { PendingSidebarRevealArgs } from './pending-reveal-inputs'

function foldedHeader(
  key: string,
  worktreeIds: string[],
  state: IdleProjectFold['state']
): RenderRow {
  return {
    type: 'header',
    key,
    label: key,
    count: worktreeIds.length,
    tone: 'text-foreground',
    fold: {
      state,
      key: `idle-open:${key}`,
      workspaceCount: worktreeIds.length,
      openWorktree: worktree,
      worktreeIds
    }
  }
}

const rows: RenderRow[] = [
  foldedHeader('repo:hub', ['hub-main', 'hub-spike'], 'folded'),
  foldedHeader('repo:open', ['open-main'], 'open')
]

describe('getFoldedProjectRevealKeys', () => {
  it('names the open key of the folded project that hides the workspace', () => {
    expect(getFoldedProjectRevealKeys(rows, 'hub-spike')).toEqual(['idle-open:repo:hub'])
  })

  it('names nothing for an opened project or a workspace outside any fold', () => {
    expect(getFoldedProjectRevealKeys(rows, 'open-main')).toEqual([])
    expect(getFoldedProjectRevealKeys(rows, 'elsewhere')).toEqual([])
  })
})

describe('expandGroupsForWorktreeReveal', () => {
  it('unfolds the folded project holding the reveal target', () => {
    const toggleGroup = vi.fn()
    const target = { ...worktree, id: 'hub-spike', repoId: 'hub' }
    const args = {
      renderRows: rows,
      folderWorkspaces: [],
      projectGroups: [],
      worktrees: [target],
      repoMap: new Map(),
      worktreeMap: new Map([[target.id, target]]),
      worktreeLineageById: {},
      collapsedGroups: new Set<string>(),
      toggleGroup,
      groupBy: 'repo',
      pinnedDisplayPolicy: 'single-location',
      defaultHostId: 'local',
      prCache: null,
      agentStatusByWorktree: new Map(),
      settings: undefined
    } as unknown as PendingSidebarRevealArgs
    expandGroupsForWorktreeReveal(args, 'hub-spike')
    expect(toggleGroup).toHaveBeenCalledWith('idle-open:repo:hub')
    expect(toggleGroup).toHaveBeenCalledTimes(1)
  })
})
