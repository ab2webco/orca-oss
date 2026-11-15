// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { repo, repoMap, worktree } from '../../worktree-list-groups-test-fixtures'
import { getIdleProjectOpenKey } from '../grouping/group-keys'
import { useEffectiveCollapsedGroups } from './use-collapsed-groups'

describe('useEffectiveCollapsedGroups', () => {
  it('opens the idle project fold that would hide the agent send target', () => {
    const { result } = renderHook(() =>
      useEffectiveCollapsedGroups({
        collapsedGroups: new Set([`repo:${repo.id}`]),
        agentSendTargetWorktreeId: worktree.id,
        groupBy: 'repo',
        repoMap,
        worktreeMap: new Map([[worktree.id, worktree]]),
        worktreeLineageById: {},
        prCache: null,
        agentStatusByWorktree: new Map(),
        settings: undefined as never,
        projectGroups: [],
        projectGrouping: { projects: [], projectHostSetups: [] }
      })
    )
    expect(result.current.has(`repo:${repo.id}`)).toBe(false)
    expect(result.current.has(getIdleProjectOpenKey(`repo:${repo.id}`))).toBe(true)
  })
})
