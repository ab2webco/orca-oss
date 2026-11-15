import { describe, expect, it } from 'vitest'
import { worktree } from '../../worktree-list-groups-test-fixtures'
import {
  PROJECT_ACTIVITY_WINDOW_MS,
  isProjectActive,
  isWorkspaceActive,
  pickProjectOpenWorktree
} from './project-activity'

const NOW = 1_800_000_000_000
const inputs = { now: NOW, currentWorktreeId: null, liveAgentWorktreeIds: new Set<string>() }

describe('isWorkspaceActive', () => {
  it('is active with activity inside the 24 h window and idle once it is older', () => {
    expect(PROJECT_ACTIVITY_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
    const recent = { ...worktree, lastActivityAt: NOW - PROJECT_ACTIVITY_WINDOW_MS + 1 }
    const old = { ...worktree, lastActivityAt: NOW - PROJECT_ACTIVITY_WINDOW_MS - 1 }
    expect(isWorkspaceActive(recent, inputs)).toBe(true)
    expect(isWorkspaceActive(old, inputs)).toBe(false)
  })

  it('is active with a live agent or as the current workspace, whatever its age', () => {
    const old = { ...worktree, lastActivityAt: 0 }
    expect(isWorkspaceActive(old, { ...inputs, liveAgentWorktreeIds: new Set([old.id]) })).toBe(
      true
    )
    expect(isWorkspaceActive(old, { ...inputs, currentWorktreeId: old.id })).toBe(true)
  })
})

describe('isProjectActive', () => {
  it('is active when any workspace is, idle when none is', () => {
    const idle = { ...worktree, id: 'a', lastActivityAt: 0 }
    const busy = { ...worktree, id: 'b', lastActivityAt: NOW - 1000 }
    expect(isProjectActive([idle, busy], inputs)).toBe(true)
    expect(isProjectActive([idle], inputs)).toBe(false)
  })
})

describe('pickProjectOpenWorktree', () => {
  it('opens the most recently active workspace', () => {
    const older = { ...worktree, id: 'older', lastActivityAt: 10 }
    const newer = { ...worktree, id: 'newer', lastActivityAt: 20 }
    expect(pickProjectOpenWorktree([older, newer])?.id).toBe('newer')
  })

  it('breaks an activity tie toward main, then keeps the given order', () => {
    const feature = { ...worktree, id: 'feature', lastActivityAt: 0 }
    const main = { ...worktree, id: 'main', isMainWorktree: true, lastActivityAt: 0 }
    const other = { ...worktree, id: 'other', lastActivityAt: 0 }
    expect(pickProjectOpenWorktree([feature, main])?.id).toBe('main')
    expect(pickProjectOpenWorktree([feature, other])?.id).toBe('feature')
    expect(pickProjectOpenWorktree([])).toBeNull()
  })
})
