import { describe, expect, it } from 'vitest'
import { computeVisibleWorktreeIds } from './visible-worktrees'
import {
  SIDEBAR_HIDING_FILTERS,
  createSidebarHidingFilterResolver,
  type SidebarHidingFilterInputs
} from './sidebar-hiding-filters'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'

function makeWorktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    id,
    repoId: 'repo1',
    path: `/tmp/${id}`,
    head: 'abc123',
    branch: 'refs/heads/feature',
    isBare: false,
    isMainWorktree: false,
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

const repoMap = new Map<string, Repo>([
  ['repo1', { id: 'repo1', path: '/repo1', displayName: 'Repo 1', badgeColor: '#000', addedAt: 0 }],
  [
    'repo-ssh',
    {
      id: 'repo-ssh',
      path: '/remote',
      displayName: 'Remote',
      badgeColor: '#111',
      addedAt: 0,
      connectionId: 'build-box'
    }
  ]
])

function inputs(overrides: Partial<SidebarHidingFilterInputs> = {}): SidebarHidingFilterInputs {
  return {
    filterRepoIds: [],
    showSleepingWorkspaces: true,
    tabsByWorktree: {},
    ptyIdsByTabId: {},
    browserTabsByWorktree: {},
    worktreeIdsWithLiveAgent: new Set(),
    hideDefaultBranchWorkspace: false,
    hideAutomationGeneratedWorkspaces: false,
    hideCliCreatedWorkspaces: false,
    hideDetachedHeadWorkspaces: false,
    hideWorkspacesFromOtherDevices: false,
    pairedDeviceIdsByEnvironment: new Map(),
    repoMap,
    workspaceHostScope: 'all',
    defaultHostId: LOCAL_EXECUTION_HOST_ID,
    ...overrides
  }
}

const cliDetached = makeWorktree('cli-detached', {
  branch: '',
  head: 'deadbeef',
  cliProvenance: { kind: 'created-by-cli', createdAt: 1 }
})
const detached = makeWorktree('detached', { branch: '', head: 'cafef00d' })
const folder = makeWorktree('folder', { branch: '', head: '', isMainWorktree: true })
const remote = makeWorktree('remote', { repoId: 'repo-ssh' })
const plain = makeWorktree('plain')

describe('createSidebarHidingFilterResolver', () => {
  it('names no filter when none is active', () => {
    const hidingFilterOf = createSidebarHidingFilterResolver(inputs())
    expect([cliDetached, detached, folder, remote, plain].map(hidingFilterOf)).toEqual([
      null,
      null,
      null,
      null,
      null
    ])
  })

  it('attributes a row several filters hide to the first one in the documented order', () => {
    expect(SIDEBAR_HIDING_FILTERS.indexOf('cli')).toBeLessThan(
      SIDEBAR_HIDING_FILTERS.indexOf('detached-head')
    )
    expect(SIDEBAR_HIDING_FILTERS.indexOf('detached-head')).toBeLessThan(
      SIDEBAR_HIDING_FILTERS.indexOf('sleeping')
    )
    const hidingFilterOf = createSidebarHidingFilterResolver(
      inputs({
        hideCliCreatedWorkspaces: true,
        hideDetachedHeadWorkspaces: true,
        showSleepingWorkspaces: false
      })
    )
    expect(hidingFilterOf(cliDetached)).toBe('cli')
    expect(hidingFilterOf(detached)).toBe('detached-head')
    expect(hidingFilterOf(plain)).toBe('sleeping')
  })

  it('never takes a folder workspace without a branch for a detached HEAD', () => {
    const hidingFilterOf = createSidebarHidingFilterResolver(
      inputs({ hideDetachedHeadWorkspaces: true, hideDefaultBranchWorkspace: true })
    )
    expect(hidingFilterOf(folder)).toBeNull()
  })

  it('names the host filter for a remote worktree outside the host scope', () => {
    const hidingFilterOf = createSidebarHidingFilterResolver(
      inputs({ workspaceHostScope: LOCAL_EXECUTION_HOST_ID })
    )
    expect(hidingFilterOf(remote)).toBe('host')
    expect(hidingFilterOf(plain)).toBeNull()
  })

  it('agrees with computeVisibleWorktreeIds on which rows stay visible', () => {
    const all = [cliDetached, detached, folder, remote, plain]
    const opts = inputs({
      hideCliCreatedWorkspaces: true,
      hideDetachedHeadWorkspaces: true,
      filterRepoIds: ['repo1']
    })
    const hidingFilterOf = createSidebarHidingFilterResolver(opts)
    const visible = computeVisibleWorktreeIds(
      { repo1: [cliDetached, detached, folder, plain], 'repo-ssh': [remote] },
      all.map((worktree) => worktree.id),
      { ...opts, worktreeLineageById: {} }
    )
    expect(visible).toEqual(
      all.filter((worktree) => hidingFilterOf(worktree) === null).map((w) => w.id)
    )
    expect(hidingFilterOf(remote)).toBe('project')
  })
})
