import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildRows } from './build-rows'
import { ALL_GROUP_META, getPRGroupKey, getWorktreePRState, PINNED_GROUP_KEY } from './group-keys'
import type { AgentStatusGroupKey } from './agent-status-groups'
import { getGroupKeyForWorktree } from './worktree-group-keys'
import {
  REPO_HEADER_ACTION_BUTTON_CLASS,
  REPO_HEADER_ACTION_REVEAL_CLASS
} from '../../repo-header-action-button-class'
import { repo, worktree, repoMap } from '../../worktree-list-groups-test-fixtures'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'

function readWorktreeListSource(): string {
  return readFileSync(fileURLToPath(new URL('../../WorktreeList.tsx', import.meta.url)), 'utf8')
}

function readSectionHeaderRowSource(): string {
  return readFileSync(fileURLToPath(new URL('../rows/SectionHeader.tsx', import.meta.url)), 'utf8')
}

describe('getPRGroupKey', () => {
  it('puts a branch with any PR, even a merged one, in the with-PR group', () => {
    const prCache = {
      'repo-1::feature/super-critical': {
        data: { state: 'merged' }
      }
    }

    expect(getPRGroupKey(worktree, repoMap, prCache)).toBe('with-pr')
  })

  it('puts a branch with no PR in the without-PR group', () => {
    expect(getPRGroupKey(worktree, repoMap, {})).toBe('without-pr')
    expect(getPRGroupKey(worktree, repoMap, null)).toBe('without-pr')
  })
})

describe('getWorktreePRState', () => {
  it('prefers repo-scoped PR status over stale legacy path-scoped status', () => {
    const prCache = {
      '/tmp/orca::feature/super-critical': {
        data: { state: 'closed' }
      },
      'repo-1::feature/super-critical': {
        data: { state: 'merged' }
      }
    }

    expect(getWorktreePRState(worktree, repoMap, prCache)).toBe('merged')
  })

  it('falls back to legacy path-scoped PR status when no repo-scoped entry exists', () => {
    const prCache = {
      '/tmp/orca::feature/super-critical': {
        data: { state: 'closed' }
      }
    }

    expect(getWorktreePRState(worktree, repoMap, prCache)).toBe('closed')
  })

  it('uses local PR cache for a known local repo while a runtime is focused', () => {
    const prCache = {
      'repo-1::feature/super-critical': {
        data: { state: 'merged' }
      }
    }

    expect(
      getWorktreePRState(worktree, repoMap, prCache, {
        activeRuntimeEnvironmentId: 'env-1'
      } as never)
    ).toBe('merged')
  })

  it('uses SSH-scoped PR cache entries instead of local entries for SSH repos', () => {
    const sshRepo = { ...repo, connectionId: 'ssh-1' }
    const sshRepoMap = new Map([[sshRepo.id, sshRepo]])
    const prCache = {
      'repo-1::feature/super-critical': {
        data: { state: 'merged' }
      },
      'ssh:ssh-1::repo-1::feature/super-critical': {
        data: { state: 'closed' }
      }
    }

    expect(getWorktreePRState(worktree, sshRepoMap, prCache)).toBe('closed')
  })
})

describe('getGroupKeyForWorktree', () => {
  it('returns the all group key for the ungrouped mode', () => {
    expect(getGroupKeyForWorktree('none', worktree, repoMap, null)).toBe('all')
  })

  it('returns the agent status key from the per-worktree map', () => {
    const agentStatus = new Map<string, AgentStatusGroupKey>([[worktree.id, 'working']])
    expect(getGroupKeyForWorktree('agent-status', worktree, repoMap, null, agentStatus)).toBe(
      'agent-status:working'
    )
    expect(getGroupKeyForWorktree('agent-status', worktree, repoMap, null)).toBe(
      'agent-status:idle'
    )
  })
})

describe('buildRows with pinned worktrees', () => {
  const pinned = { ...worktree, id: 'wt-pinned', isPinned: true, displayName: 'pinned-feature' }
  const unpinned1 = { ...worktree, id: 'wt-1', displayName: 'alpha' }
  const unpinned2 = { ...worktree, id: 'wt-2', displayName: 'beta' }

  it('emits Pinned and All headers in groupBy none', () => {
    const rows = buildRows('none', [unpinned1, pinned, unpinned2], repoMap, null, new Set())
    expect(rows[0]).toMatchObject({ type: 'header', key: 'pinned', label: 'Pinned' })
    expect(rows[1]).toMatchObject({ type: 'item', worktree: { id: 'wt-pinned' } })
    expect(rows[2]).toMatchObject({ type: 'header', key: 'all', label: 'All', count: 2 })
    expect(rows[2]).toMatchObject({ type: 'header', icon: ALL_GROUP_META.icon })
  })

  it('uses worktree host ownership for pinned header host counts', () => {
    const runtimePinned = {
      ...pinned,
      hostId: 'runtime:03ef704c-b180-4b10-998d-e28fbd5de9a3' as const
    }

    const rows = buildRows(
      'none',
      [runtimePinned, unpinned1],
      repoMap,
      null,
      new Set(),
      undefined,
      undefined,
      undefined,
      {},
      new Map([
        [runtimePinned.id, runtimePinned],
        [unpinned1.id, unpinned1]
      ])
    )
    const pinnedHeader = rows[0]

    expect(pinnedHeader).toMatchObject({ type: 'header', key: 'pinned' })
    expect(pinnedHeader.type === 'header' ? pinnedHeader.hostWorktreeCounts : undefined).toEqual(
      new Map([['runtime:03ef704c-b180-4b10-998d-e28fbd5de9a3', 1]])
    )
  })

  it('groups all worktrees under All in groupBy none', () => {
    const rows = buildRows('none', [unpinned1, unpinned2], repoMap, null, new Set())

    expect(rows).toMatchObject([
      { type: 'header', key: 'all', label: 'All' },
      { type: 'item', worktree: { id: 'wt-1' } },
      { type: 'item', worktree: { id: 'wt-2' } }
    ])
  })

  it('moves pinned worktrees out of the All group', () => {
    const rows = buildRows('none', [unpinned1, pinned, unpinned2], repoMap, null, new Set())

    expect(rows).toMatchObject([
      { type: 'header', key: 'pinned' },
      { type: 'item', worktree: { id: 'wt-pinned' } },
      { type: 'header', key: 'all', count: 2 },
      { type: 'item', worktree: { id: 'wt-1' } },
      { type: 'item', worktree: { id: 'wt-2' } }
    ])
  })

  it('duplicates pinned worktrees into All when the policy allows it', () => {
    const rows = buildRows(
      'none',
      [unpinned1, pinned, unpinned2],
      repoMap,
      null,
      new Set(),
      undefined,
      undefined,
      undefined,
      {},
      undefined,
      false,
      { showPinnedWorktreesInGroups: true } as never
    )

    expect(rows).toMatchObject([
      { type: 'header', key: 'pinned' },
      { type: 'item', sectionKey: PINNED_GROUP_KEY, worktree: { id: 'wt-pinned' } },
      { type: 'header', key: 'all', count: 3 },
      { type: 'item', sectionKey: 'all', worktree: { id: 'wt-1' } },
      { type: 'item', sectionKey: 'all', worktree: { id: 'wt-pinned' } },
      { type: 'item', sectionKey: 'all', worktree: { id: 'wt-2' } }
    ])
  })

  it('collapses the All group in groupBy none', () => {
    const rows = buildRows('none', [unpinned1, pinned, unpinned2], repoMap, null, new Set(['all']))

    expect(rows).toMatchObject([
      { type: 'header', key: 'pinned' },
      { type: 'item', worktree: { id: 'wt-pinned' } },
      { type: 'header', key: 'all', count: 2 }
    ])
  })

  it('emits status headers for unpinned matching worktrees in groupBy agent-status', () => {
    const rows = buildRows('agent-status', [unpinned1, pinned, unpinned2], repoMap, null, new Set())
    expect(rows[2]).toMatchObject({
      type: 'header',
      key: 'agent-status:idle',
      label: 'Idle',
      count: 2
    })
    expect(rows[3]).toMatchObject({ type: 'item', worktree: { id: 'wt-1' } })
    expect(rows[4]).toMatchObject({ type: 'item', worktree: { id: 'wt-2' } })
  })

  it('duplicates pinned worktrees into status groups when the policy allows it', () => {
    const rows = buildRows(
      'agent-status',
      [unpinned1, pinned],
      repoMap,
      null,
      new Set(),
      undefined,
      undefined,
      undefined,
      {},
      undefined,
      false,
      { showPinnedWorktreesInGroups: true } as never
    )

    expect(rows).toMatchObject([
      { type: 'header', key: 'pinned', count: 1 },
      { type: 'item', sectionKey: PINNED_GROUP_KEY, worktree: { id: 'wt-pinned' } },
      { type: 'header', key: 'agent-status:idle', count: 2 },
      { type: 'item', sectionKey: 'agent-status:idle', worktree: { id: 'wt-1' } },
      { type: 'item', sectionKey: 'agent-status:idle', worktree: { id: 'wt-pinned' } }
    ])
  })

  it('moves pinned items out of regular groups in pr-status mode', () => {
    const rows = buildRows('pr-status', [unpinned1, pinned], repoMap, null, new Set())
    const pinnedHeader = rows.find((r) => r.type === 'header' && r.key === 'pinned')
    expect(pinnedHeader).toBeDefined()
    const prGroup = rows.filter((r) => r.type === 'header' && r.key.startsWith('pr:'))
    for (const header of prGroup) {
      if (header.type === 'header') {
        expect(header.count).toBe(1)
      }
    }
  })

  it('omits empty pinned sections in groupBy agent-status', () => {
    const rows = buildRows('agent-status', [unpinned1, unpinned2], repoMap, null, new Set())
    expect(rows[0]).toMatchObject({
      type: 'header',
      key: 'agent-status:idle',
      label: 'Idle'
    })
    expect(rows[1]).toMatchObject({ type: 'item', worktree: { id: 'wt-1' } })
    expect(rows[2]).toMatchObject({ type: 'item', worktree: { id: 'wt-2' } })
  })

  it('collapses pinned group when in collapsedGroups', () => {
    const rows = buildRows('agent-status', [pinned, unpinned1], repoMap, null, new Set(['pinned']))
    expect(rows[0]).toMatchObject({ type: 'header', key: 'pinned' })
    expect(rows[1]).toMatchObject({ type: 'header', key: 'agent-status:idle' })
    expect(rows[2]).toMatchObject({ type: 'item', worktree: { id: 'wt-1' } })
  })

  it('omits status sections when all matching worktrees are pinned', () => {
    const allPinned = { ...unpinned1, isPinned: true }
    const rows = buildRows('agent-status', [pinned, allPinned], repoMap, null, new Set())
    expect(rows.filter((r) => r.type === 'header')).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'header', key: 'pinned', count: 2 })
  })

  it('preserves repo display casing in group labels', () => {
    const lowercaseRepo = { ...repo, displayName: 'c15t' }
    const rows = buildRows('repo', [worktree], new Map([[repo.id, lowercaseRepo]]), null, new Set())

    expect(rows[0]).toMatchObject({ type: 'header', label: 'c15t' })
  })

  it('groups folder-mode workspaces under their folder name', () => {
    const folderRepo: Repo = {
      ...repo,
      id: 'folder-1',
      path: '/tmp/design-assets',
      displayName: 'design-assets',
      kind: 'folder'
    }
    const folderWorktree: Worktree = {
      ...worktree,
      id: 'folder-1::/tmp/design-assets',
      repoId: folderRepo.id,
      path: folderRepo.path,
      branch: '',
      displayName: folderRepo.displayName,
      isMainWorktree: true
    }
    const rows = buildRows(
      'repo',
      [folderWorktree],
      new Map([[folderRepo.id, folderRepo]]),
      null,
      new Set()
    )

    expect(rows[0]).toMatchObject({
      type: 'header',
      key: 'repo:folder-1',
      label: 'design-assets',
      repo: folderRepo
    })
    expect(rows[1]).toMatchObject({ type: 'item', worktree: { id: folderWorktree.id } })
  })

  it('orders agent status sections Needs you, Working, Idle and omits empty ones', () => {
    const waiting = { ...worktree, id: 'wt-waiting' }
    const resting = { ...worktree, id: 'wt-resting' }
    const busy = { ...worktree, id: 'wt-busy' }
    const agentStatus = new Map<string, AgentStatusGroupKey>([
      ['wt-waiting', 'needs-you'],
      ['wt-busy', 'working']
    ])
    const rows = buildRows(
      'agent-status',
      [resting, busy, waiting],
      repoMap,
      null,
      new Set(),
      undefined,
      agentStatus
    )

    expect(
      rows.filter((r) => r.type === 'header').map((r) => ({ key: r.key, label: r.label }))
    ).toEqual([
      { key: 'agent-status:needs-you', label: 'Needs you' },
      { key: 'agent-status:working', label: 'Working' },
      { key: 'agent-status:idle', label: 'Idle' }
    ])

    const onlyIdle = buildRows('agent-status', [resting], repoMap, null, new Set())
    expect(onlyIdle.filter((r) => r.type === 'header').map((r) => r.key)).toEqual([
      'agent-status:idle'
    ])
  })

  it('splits PR grouping into With PR and Without PR', () => {
    const withPr = { ...worktree, id: 'wt-with-pr' }
    const withoutPr = { ...worktree, id: 'wt-without-pr', branch: 'refs/heads/no-pr-yet' }
    const prCache = { 'repo-1::feature/super-critical': { data: { state: 'closed' } } }
    const rows = buildRows('pr-status', [withoutPr, withPr], repoMap, prCache, new Set())

    expect(
      rows
        .filter((r) => r.type === 'header')
        .map((r) => ({ key: r.key, label: r.label, count: r.type === 'header' ? r.count : 0 }))
    ).toEqual([
      { key: 'pr:with-pr', label: 'With PR', count: 1 },
      { key: 'pr:without-pr', label: 'Without PR', count: 1 }
    ])
  })
})

describe('WorktreeList header styles', () => {
  it('does not title-case workspace group labels', () => {
    const source = readSectionHeaderRowSource()

    expect(source).not.toContain('leading-none capitalize')
  })

  it('collapses repo header actions without reserving title width', () => {
    expect(REPO_HEADER_ACTION_REVEAL_CLASS).toContain('min-w-0 max-w-0 -ml-1.5')
    expect(REPO_HEADER_ACTION_REVEAL_CLASS).toContain('focus:ml-0 focus:max-w-5 focus:opacity-100')
    expect(REPO_HEADER_ACTION_REVEAL_CLASS).toContain(
      'group-hover:ml-0 group-hover:max-w-5 group-hover:opacity-100'
    )
    expect(REPO_HEADER_ACTION_BUTTON_CLASS).toContain(
      'transition-[margin,max-width,opacity,background-color,color]'
    )
    expect(REPO_HEADER_ACTION_BUTTON_CLASS).toContain(
      'data-[state=open]:ml-0 data-[state=open]:max-w-5 data-[state=open]:opacity-100'
    )
  })

  it("draws project and org headers with V30's dim glyphs, not the repo avatar (ORCA-1149)", () => {
    const source = readSectionHeaderRowSource()

    expect(source).toContain('<SectionHeaderGlyph')
    expect(source).not.toContain('RepoIconGlyph')
  })

  it('adapts projected setup rows for sidebar project grouping', () => {
    const source = readWorktreeListSource()

    expect(source).toContain('const projectHostSetupProjection = useProjectHostSetupProjection()')
    expect(source).toContain('projectHostSetups: projectHostSetupProjection.setups')
  })
})
