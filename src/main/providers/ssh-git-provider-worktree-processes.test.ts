import { describe, expect, it, beforeEach } from 'vitest'
import { SshGitProvider } from './ssh-git-provider'
import { createMockMux, type MockMultiplexer } from './ssh-git-provider-test-harness'

describe('SshGitProvider.listWorktreeProcesses (ORCA-678)', () => {
  let mux: MockMultiplexer
  let provider: SshGitProvider

  beforeEach(() => {
    mux = createMockMux()
    provider = new SshGitProvider('conn-1', mux as never)
  })

  it('asks the relay to list and stop on the remote host', async () => {
    const remote = { supported: true, root: '/r/w', processes: [], stopped: [], protected: [] }
    mux.request.mockResolvedValue(remote)
    expect(await provider.listWorktreeProcesses('/r/w', true)).toEqual(remote)
    expect(mux.request).toHaveBeenCalledWith('processes.listInRoot', { root: '/r/w', stop: true })
  })

  it('reports an old relay explicitly instead of failing', async () => {
    mux.request.mockRejectedValue(Object.assign(new Error('Method not found'), { code: -32601 }))
    expect(await provider.listWorktreeProcesses('/r/w', false)).toEqual({
      supported: false,
      root: '/r/w',
      reason: 'the SSH relay on this host is too old to list processes; reconnect to update it'
    })
  })

  it('still surfaces other relay errors', async () => {
    mux.request.mockRejectedValue(new Error('connection lost'))
    await expect(provider.listWorktreeProcesses('/r/w', false)).rejects.toThrow('connection lost')
  })
})
