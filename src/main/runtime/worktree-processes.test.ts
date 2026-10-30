import { describe, expect, it, vi } from 'vitest'
import { runWorktreeProcesses } from './worktree-processes'

const local = { supported: true as const, root: '/w', processes: [], stopped: [], protected: [] }

describe('runWorktreeProcesses (ORCA-678)', () => {
  it('runs on this machine for a local worktree or folder, passing the caller', async () => {
    const listLocal = vi.fn(async () => local)
    const getSshGitProvider = vi.fn()
    const result = await runWorktreeProcesses(
      { path: '/w', connectionId: null },
      { stop: true, callerPid: 42 },
      { getSshGitProvider, listLocal }
    )
    expect(result).toBe(local)
    expect(listLocal).toHaveBeenCalledWith('/w', { stop: true, callerPid: 42 })
    expect(getSshGitProvider).not.toHaveBeenCalled()
  })

  it('runs on the remote host for an SSH worktree', async () => {
    const listLocal = vi.fn()
    const remote = { ...local, root: '/r/w' }
    const listWorktreeProcesses = vi.fn(async () => remote)
    const result = await runWorktreeProcesses(
      { path: '/r/w', connectionId: 'conn-1' },
      { stop: false, callerPid: 42 },
      { getSshGitProvider: () => ({ listWorktreeProcesses }), listLocal }
    )
    expect(result).toBe(remote)
    expect(listWorktreeProcesses).toHaveBeenCalledWith('/r/w', false)
    expect(listLocal).not.toHaveBeenCalled()
  })

  it('reports a disconnected SSH host instead of scanning locally', async () => {
    const listLocal = vi.fn()
    expect(
      await runWorktreeProcesses(
        { path: '/r/w', connectionId: 'conn-1' },
        { stop: true },
        { getSshGitProvider: () => undefined, listLocal }
      )
    ).toEqual({
      supported: false,
      root: '/r/w',
      reason: 'the SSH host is not connected; reconnect it to list its processes'
    })
    expect(listLocal).not.toHaveBeenCalled()
  })
})
