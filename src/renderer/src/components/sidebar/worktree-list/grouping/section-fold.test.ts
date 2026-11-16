import { describe, expect, it } from 'vitest'
import { resolveSectionFold } from './section-fold'
import type { WorktreeGroupEntry } from './project-grouping'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { repo, worktree } from '../../worktree-list-groups-test-fixtures'

const idleRepo: Repo = { ...repo, id: 'idle', displayName: 'idle' }
const idleWorktree: Worktree = {
  ...worktree,
  id: 'idle-main',
  repoId: 'idle',
  isMainWorktree: true,
  lastActivityAt: 0
}
const group: WorktreeGroupEntry = {
  label: 'idle',
  repo: idleRepo,
  repoIds: new Set(['idle']),
  items: [idleWorktree]
}

const emptyInputs = {
  groupBy: 'repo' as const,
  collapsedGroups: new Set<string>(),
  importedWorktreesByRepo: new Map(),
  newExternalWorktreesInboxByRepo: new Map(),
  pendingByRepo: new Map()
}

describe('resolveSectionFold', () => {
  it('leaves a section unfolded outside the repo grouping', () => {
    expect(
      resolveSectionFold(
        { ...emptyInputs, groupBy: 'agent-status', activeProjectKeys: new Set() },
        'idle',
        group
      )
    ).toBeUndefined()
  })

  it('leaves a section unfolded when no active project keys are passed', () => {
    expect(resolveSectionFold({ ...emptyInputs }, 'idle', group)).toBeUndefined()
  })

  it('folds an idle project that has no notice', () => {
    expect(
      resolveSectionFold({ ...emptyInputs, activeProjectKeys: new Set() }, 'idle', group)
    ).toBeDefined()
  })
})
