import { describe, expect, it, vi } from 'vitest'
import type { TeamSessionRef } from '../../../../shared/team-panel-model-types'
import { teamHostWorktreeMissing } from './team-session-host-worktree'

const remote = (over: Partial<TeamSessionRef> = {}): TeamSessionRef => ({
  paneKey: 'tab-21:leaf',
  terminalHandle: 'term-21',
  worktreeId: 'wt-host-21',
  host: { kind: 'remote', name: 'imac', environmentId: 'env-9', reachable: true },
  ...over
})

describe('teamHostWorktreeMissing (ORCA-851)', () => {
  it('is true for a remote member whose host worktree this window does not hold', () => {
    const known = vi.fn(() => undefined)
    expect(teamHostWorktreeMissing(remote(), known)).toBe(true)
    expect(known).toHaveBeenCalledWith('wt-host-21', 'runtime:env-9')
  })

  it('is false once this window holds that worktree on that host', () => {
    expect(teamHostWorktreeMissing(remote(), () => ({ id: 'wt-host-21' }))).toBe(false)
  })

  it('is false for a local member, whatever this window holds', () => {
    const local = remote({ host: { kind: 'local' } })
    expect(teamHostWorktreeMissing(local, () => undefined)).toBe(false)
  })

  it('is false when the card cannot name the host worktree, so the host still gets asked', () => {
    expect(teamHostWorktreeMissing(remote({ worktreeId: null }), () => undefined)).toBe(false)
    const noEnvironment = remote({
      host: { kind: 'remote', name: 'imac', environmentId: null, reachable: true }
    })
    expect(teamHostWorktreeMissing(noEnvironment, () => undefined)).toBe(false)
  })
})
