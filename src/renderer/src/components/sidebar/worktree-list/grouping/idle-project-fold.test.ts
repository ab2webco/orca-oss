import { describe, expect, it } from 'vitest'
import { buildRows } from './build-rows'
import { getCyclableWorktreeIds } from '../../worktree-keyboard-cycle'
import { getRenderedWorktreesInSidebarOrder } from '../../worktree-sidebar-row-preference'
import { getIdleProjectOpenKey } from './group-keys'
import type { ProjectActivityInputs } from './project-activity'
import type { GroupHeaderRow, Row } from './row-types'
import { repo, worktree } from '../../worktree-list-groups-test-fixtures'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'

const NOW = 1_800_000_000_000
const OLD = NOW - 3 * 24 * 60 * 60 * 1000

const idleRepo: Repo = { ...repo, id: 'idle', path: '/tmp/project-hub', displayName: 'project-hub' }
const lonelyRepo: Repo = {
  ...repo,
  id: 'lonely',
  path: '/tmp/fe-ai-prototype',
  displayName: 'fe-ai-prototype'
}
const activeRepo: Repo = {
  ...repo,
  id: 'active',
  path: '/tmp/cineco-frontend',
  displayName: 'cineco-frontend'
}
const folderRepo: Repo = {
  ...repo,
  id: 'folder',
  path: '/tmp/ab2web-landing',
  displayName: 'ab2web-landing',
  kind: 'folder'
}
const repos = new Map([idleRepo, lonelyRepo, activeRepo, folderRepo].map((r) => [r.id, r]))

function wt(id: string, repoId: string, lastActivityAt: number, extra: Partial<Worktree> = {}) {
  return { ...worktree, id, repoId, displayName: id, lastActivityAt, ...extra }
}

const hubMain = wt('hub-main', 'idle', OLD, { isMainWorktree: true })
const hubSpike = wt('hub-spike', 'idle', OLD + 1000)
const lonelyMain = wt('lonely-main', 'lonely', OLD, { isMainWorktree: true })
const activeMain = wt('active-main', 'active', NOW - 60_000, { isMainWorktree: true })
const folderMain = wt('folder-main', 'folder', OLD, { isMainWorktree: true })
const REPO_ORDER = new Map([
  ['active', 0],
  ['idle', 1],
  ['lonely', 2],
  ['folder', 3]
])
const all = [activeMain, hubMain, hubSpike, lonelyMain, folderMain]

const inputs: ProjectActivityInputs = {
  now: NOW,
  currentWorktreeId: null,
  liveAgentWorktreeIds: new Set(),
  windowMs: 24 * 60 * 60 * 1000
}

function build(
  worktrees: Worktree[],
  collapsedGroups = new Set<string>(),
  fold: ProjectActivityInputs | null = inputs,
  extra: { pendingRepoIds?: string[] } = {}
): Row[] {
  return buildRows(
    'repo',
    worktrees,
    repos,
    null,
    collapsedGroups,
    REPO_ORDER,
    undefined,
    'manual',
    {},
    undefined,
    false,
    undefined,
    [],
    new Set(),
    new Map(),
    new Map(),
    (extra.pendingRepoIds ?? []).map((repoId) => ({ creationId: `c-${repoId}`, repoId })),
    undefined,
    [],
    undefined,
    'local',
    'single-location',
    fold ?? undefined
  )
}

function shape(rows: Row[]): string[] {
  return rows.map((row) => {
    if (row.type === 'header') {
      return row.fold ? `${row.label} [${row.fold.state} ${row.fold.workspaceCount}]` : row.label
    }
    return row.type === 'item' ? `  ${row.worktree.id}` : row.type
  })
}

function header(rows: Row[], label: string): GroupHeaderRow {
  const row = rows.find((r): r is GroupHeaderRow => r.type === 'header' && r.label === label)
  if (!row) {
    throw new Error(`no header ${label}`)
  }
  return row
}

describe('buildRows idle project fold', () => {
  it('folds each idle project to one row and keeps an active project expanded', () => {
    const rows = build(all)
    expect(shape(rows)).toEqual([
      'cineco-frontend',
      '  active-main',
      'Idle',
      'project-hub [folded 2]',
      'fe-ai-prototype [folded 1]',
      'ab2web-landing [folded 1]'
    ])
  })

  it('opens the most recent workspace and lists every workspace behind the fold', () => {
    const fold = header(build(all), 'project-hub').fold
    expect(fold).toMatchObject({
      key: getIdleProjectOpenKey('repo:idle'),
      workspaceCount: 2,
      openWorktree: { id: 'hub-spike' }
    })
    expect([...(fold?.worktreeIds ?? [])].sort()).toEqual(['hub-main', 'hub-spike'])
  })

  it('unfolds in place under its own collapsedGroups key, which no collapse key collides with', () => {
    const openKey = getIdleProjectOpenKey('repo:idle')
    expect(openKey).toBe('idle-open:repo:idle')
    const rows = build(all, new Set([openKey, 'repo:idle']))
    expect(shape(rows)).toEqual([
      'cineco-frontend',
      '  active-main',
      'Idle',
      'project-hub [open 2]',
      '  hub-main',
      '  hub-spike',
      'fe-ai-prototype [folded 1]',
      'ab2web-landing [folded 1]'
    ])
    // Why: the legacy collapse key alone never unfolds an idle project.
    expect(shape(build(all, new Set(['repo:idle'])))[3]).toBe('project-hub [folded 2]')
  })

  it('treats the current workspace and a live agent as activity, whatever the age', () => {
    expect(
      header(build(all, new Set(), { ...inputs, currentWorktreeId: 'hub-main' }), 'project-hub')
        .fold
    ).toBeUndefined()
    expect(
      header(
        build(all, new Set(), { ...inputs, liveAgentWorktreeIds: new Set(['lonely-main']) }),
        'fe-ai-prototype'
      ).fold
    ).toBeUndefined()
  })

  it('counts a pinned workspace toward its project activity', () => {
    const pinnedRecent = wt('hub-pinned', 'idle', NOW - 1000, { isPinned: true })
    const rows = build([...all, pinnedRecent])
    expect(header(rows, 'project-hub').fold).toBeUndefined()
  })

  it('keeps a project with an in-flight create expanded so the create stays visible', () => {
    const rows = build(all, new Set(), inputs, { pendingRepoIds: ['lonely'] })
    expect(header(rows, 'fe-ai-prototype').fold).toBeUndefined()
    expect(shape(rows)).toContain('pending-creation')
  })

  it('keeps folded workspaces out of arrow cycling and the selection order, like a collapsed group', () => {
    const rows = build(all)
    expect(getCyclableWorktreeIds(rows, 'single-location')).toEqual(['active-main'])
    expect(getRenderedWorktreesInSidebarOrder(rows, 'single-location').map((w) => w.id)).toEqual([
      'active-main'
    ])
  })

  it('leaves rows untouched when the caller passes no fold inputs', () => {
    const rows = build(all, new Set(), null)
    expect(rows.some((row) => row.type === 'header' && row.fold !== undefined)).toBe(false)
    expect(rows.filter((row) => row.type === 'item')).toHaveLength(all.length)
  })

  it('never folds a project whose repo is unknown, since its header cannot draw the fold', () => {
    const orphan = wt('orphan-main', 'missing-repo', OLD, { isMainWorktree: true })
    const rows = build([...all, orphan])
    const orphanHeader = rows.find(
      (row): row is GroupHeaderRow => row.type === 'header' && row.key === 'repo:missing-repo'
    )
    expect(orphanHeader).toBeDefined()
    expect(orphanHeader?.repo).toBeUndefined()
    expect(orphanHeader?.fold).toBeUndefined()
    expect(rows.some((row) => row.type === 'item' && row.worktree.id === 'orphan-main')).toBe(true)
  })

  it('never folds other groupings', () => {
    const rows = buildRows(
      'none',
      all,
      repos,
      null,
      new Set(),
      undefined,
      undefined,
      'manual',
      {},
      undefined,
      false,
      undefined,
      [],
      new Set(),
      new Map(),
      new Map(),
      [],
      undefined,
      [],
      undefined,
      'local',
      'single-location',
      inputs
    )
    expect(rows.filter((row) => row.type === 'item')).toHaveLength(all.length)
  })
})
