import { describe, expect, it } from 'vitest'
import {
  getAgentStallTimerAvailability,
  resolveAgentStallTimerTarget,
  selectStalledPaneKeysForWorktree,
  type AgentStallTimerTargetState
} from './agent-stall-timer-target'

const TAB_ID = 'tab-1'
const PANE_KEY = `${TAB_ID}:11111111-1111-4111-8111-111111111111`

function makeState(repo: Record<string, unknown>, worktreeId: string): AgentStallTimerTargetState {
  return {
    repos: [{ id: 'repo1', path: '/repo1', displayName: 'Repo 1', addedAt: 0, ...repo }],
    tabsByWorktree: { [worktreeId]: [{ id: TAB_ID, title: 'Terminal', kind: 'terminal' }] }
  } as unknown as AgentStallTimerTargetState
}

describe('agent stall timer target', () => {
  it('resolves the worktree path a git workspace measures progress from', () => {
    const state = makeState({}, 'repo1::/repo1/feature')

    expect(resolveAgentStallTimerTarget(state, PANE_KEY)).toEqual({
      worktreeId: 'repo1::/repo1/feature',
      worktreePath: '/repo1/feature'
    })
    expect(getAgentStallTimerAvailability(state, PANE_KEY)).toEqual({ available: true })
  })

  it('says why an SSH workspace cannot be measured instead of arming a timer that never fires', () => {
    // The relay's git.exec allowlist admits neither `status` nor `diff HEAD`, so every
    // reading there would come back unreadable forever.
    const state = makeState({ connectionId: 'ssh-1' }, 'repo1::/remote/feature')

    expect(resolveAgentStallTimerTarget(state, PANE_KEY)).toBeNull()
    expect(getAgentStallTimerAvailability(state, PANE_KEY)).toEqual({
      available: false,
      reason: 'remote-workspace'
    })
  })

  it('says why a folder workspace cannot be measured instead of offering a dead control', () => {
    const state = makeState({ kind: 'folder' }, 'repo1::/repo1/folder')

    expect(resolveAgentStallTimerTarget(state, PANE_KEY)).toBeNull()
    expect(getAgentStallTimerAvailability(state, PANE_KEY)).toEqual({
      available: false,
      reason: 'folder-workspace'
    })
  })

  it('says why a pane with no workspace cannot be measured', () => {
    const state = makeState({}, 'repo1::/repo1/feature')

    expect(
      getAgentStallTimerAvailability(state, 'other-tab:11111111-1111-4111-8111-111111111111')
    ).toEqual({ available: false, reason: 'no-workspace' })
  })

  it('survives a store state whose slices have not hydrated yet', () => {
    // Cards render against partial states; a throwing selector takes the whole card down.
    const empty = {} as AgentStallTimerTargetState

    expect(resolveAgentStallTimerTarget(empty, PANE_KEY)).toBeNull()
    expect(getAgentStallTimerAvailability(empty, PANE_KEY)).toEqual({
      available: false,
      reason: 'no-workspace'
    })
    expect(selectStalledPaneKeysForWorktree(empty as never, 'repo1::/repo1/feature')).toEqual([])
  })

  it('rejects a malformed pane key rather than guessing a workspace', () => {
    const state = makeState({}, 'repo1::/repo1/feature')

    expect(resolveAgentStallTimerTarget(state, 'not-a-pane-key')).toBeNull()
  })
})
