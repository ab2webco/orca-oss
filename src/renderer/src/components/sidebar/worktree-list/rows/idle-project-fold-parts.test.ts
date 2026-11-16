import { describe, expect, it } from 'vitest'
import { worktree } from '../../worktree-list-groups-test-fixtures'
import type { IdleProjectFold } from '../grouping/row-types'
import { getIdleProjectFoldKeyAction, hasIdleProjectFoldChevron } from './idle-project-fold-parts'

function fold(state: IdleProjectFold['state'], workspaceCount: number): IdleProjectFold {
  return { state, key: 'idle-open:repo:x', workspaceCount, openWorktree: worktree, worktreeIds: [] }
}

describe('idle project row keyboard', () => {
  it('opens the workspace on Enter and Space, never toggling', () => {
    expect(getIdleProjectFoldKeyAction('Enter', fold('folded', 2))).toBe('open-workspace')
    expect(getIdleProjectFoldKeyAction(' ', fold('open', 2))).toBe('open-workspace')
  })

  it('unfolds with ArrowRight and folds with ArrowLeft, like a tree item', () => {
    expect(getIdleProjectFoldKeyAction('ArrowRight', fold('folded', 2))).toBe('toggle-fold')
    expect(getIdleProjectFoldKeyAction('ArrowLeft', fold('folded', 2))).toBeNull()
    expect(getIdleProjectFoldKeyAction('ArrowLeft', fold('open', 2))).toBe('toggle-fold')
    expect(getIdleProjectFoldKeyAction('ArrowRight', fold('open', 2))).toBeNull()
  })

  it('has no chevron and nothing to unfold with one workspace, until a reveal opened it', () => {
    expect(hasIdleProjectFoldChevron(fold('folded', 1))).toBe(false)
    expect(getIdleProjectFoldKeyAction('ArrowRight', fold('folded', 1))).toBeNull()
    expect(hasIdleProjectFoldChevron(fold('open', 1))).toBe(true)
  })
})
