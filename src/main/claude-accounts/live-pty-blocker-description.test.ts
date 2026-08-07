import { describe, expect, it } from 'vitest'
import {
  buildAccountMutationBlockMessage,
  buildAssignedWorktreeLaunchBlockMessage,
  buildGlobalTerminalLaunchBlockMessage,
  describeLiveClaudePtyWorktrees
} from './live-pty-blocker-description'

const WORKTREE_A = 'repo-1::/work/feature-a'
const WORKTREE_B = 'repo-1::/work/feature-b'

describe('describeLiveClaudePtyWorktrees', () => {
  it('prefers the worktree display name over the path basename', () => {
    const names = describeLiveClaudePtyWorktrees([`${WORKTREE_A}@@pane-1`], (worktreeId) =>
      worktreeId === WORKTREE_A ? 'Feature A' : null
    )

    expect(names).toEqual(['Feature A'])
  })

  it('falls back to the worktree path basename without a display name', () => {
    expect(describeLiveClaudePtyWorktrees([`${WORKTREE_A}@@pane-1`], null)).toEqual(['feature-a'])
    expect(describeLiveClaudePtyWorktrees([`${WORKTREE_A}@@pane-1`], () => '  ')).toEqual([
      'feature-a'
    ])
  })

  it('falls back to PTY ids that were not minted with a worktree', () => {
    expect(
      describeLiveClaudePtyWorktrees(
        ['0b7a4c1e-0000-4000-8000-000000000000', '3', `${WORKTREE_B}@@pane-9`],
        null
      )
    ).toEqual(['PTY 0b7a4c1e-0000-4000-8000-000000000000', 'PTY 3', 'feature-b'])
  })

  it('deduplicates worktrees hosting several live PTYs', () => {
    const names = describeLiveClaudePtyWorktrees(
      [`${WORKTREE_A}@@pane-1`, `${WORKTREE_A}@@pane-2`, `${WORKTREE_B}@@pane-1`],
      null
    )

    expect(names).toEqual(['feature-a', 'feature-b'])
  })
})

describe('live PTY gate block messages', () => {
  it('keeps the exact legacy messages when no blocker is attributable', () => {
    expect(buildAssignedWorktreeLaunchBlockMessage([])).toBe(
      'This Claude account is in use by an assigned worktree. Close that Claude terminal before launching it globally.'
    )
    expect(buildGlobalTerminalLaunchBlockMessage([])).toBe(
      'This Claude account is already in use by a global terminal. Close it before launching the assigned account.'
    )
    expect(buildAccountMutationBlockMessage([])).toBe(
      'This Claude account is in use by an assigned worktree. Close its Claude terminal before changing the account.'
    )
  })

  it('names the blocking worktree and suggests the assigned-account escape hatch', () => {
    const message = buildAssignedWorktreeLaunchBlockMessage(['Feature A'])

    // Why: the renderer classifies account blocks by this exact substring.
    expect(message).toContain('in use by an assigned worktree')
    expect(message).toContain('"Feature A"')
    expect(message).toContain('launch this terminal with an assigned Claude account')
    expect(message).not.toContain('undefined')
  })

  it('pluralizes the close instruction across several blocking worktrees', () => {
    const message = buildAssignedWorktreeLaunchBlockMessage(['Feature A', 'Feature B'])

    expect(message).toContain('in use by an assigned worktree')
    expect(message).toContain('"Feature A", "Feature B"')
    expect(message).toContain('Close those Claude terminals')
  })

  it('names the worktree hosting the blocking global terminal', () => {
    const message = buildGlobalTerminalLaunchBlockMessage(['in "feature-a"'])

    expect(message).toContain('in use by a global terminal')
    expect(message).toContain('in "feature-a"')
  })

  it('names the blocking worktree for gated account mutations', () => {
    const message = buildAccountMutationBlockMessage(['feature-a'])

    expect(message).toContain('in use by an assigned worktree')
    expect(message).toContain('"feature-a"')
    expect(message).toContain('before changing the account')
  })
})
