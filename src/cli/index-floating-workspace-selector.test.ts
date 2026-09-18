import { describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveOrcaAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveOrcaAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})

vi.mock('./runtime/environments', () => ({
  addEnvironmentFromPairingCode: addEnvironmentFromPairingCodeMock,
  listEnvironments: listEnvironmentsMock,
  removeEnvironment: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main, normalizeWorktreeSelector } from './index'
import { okFixture, queueFixtures } from './test-fixtures'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'

describe('orca cli floating workspace selector', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  it('expands the floating alias and leaves every other selector untouched', () => {
    expect(normalizeWorktreeSelector('floating', '/tmp/repo/feature')).toBe(
      'id:global-floating-terminal'
    )
    expect(normalizeWorktreeSelector('id:repo::/tmp/repo/feature', '/tmp/repo')).toBe(
      'id:repo::/tmp/repo/feature'
    )
    expect(normalizeWorktreeSelector('name:nope', '/tmp/repo')).toBe('name:nope')
    expect(normalizeWorktreeSelector('branch:feature/foo', '/tmp/repo')).toBe('branch:feature/foo')
  })

  it('targets the floating workspace on tab create without scanning worktrees', async () => {
    queueFixtures(callMock, okFixture('req_create', { browserPageId: 'page-1' }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      ['tab', 'create', '--url', 'https://example.com', '--worktree', 'floating', '--json'],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).toHaveBeenNthCalledWith(
      1,
      'browser.tabCreate',
      { url: 'https://example.com', worktree: 'id:global-floating-terminal', profileId: undefined },
      { timeoutMs: 60_000 }
    )
  })

  it('targets the floating workspace on tab list', async () => {
    queueFixtures(callMock, okFixture('req_list', { tabs: [] }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['tab', 'list', '--worktree', 'floating', '--json'], '/tmp/repo')

    expect(callMock).toHaveBeenNthCalledWith(1, 'browser.tabList', {
      worktree: 'id:global-floating-terminal'
    })
  })

  it('targets the floating workspace on eval', async () => {
    queueFixtures(callMock, okFixture('req_eval', { value: 1 }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      ['eval', '--expression', 'document.title', '--worktree', 'floating', '--json'],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenNthCalledWith(1, 'browser.eval', {
      expression: 'document.title',
      worktree: 'id:global-floating-terminal'
    })
  })

  it('targets the floating workspace on non-browser worktree consumers', async () => {
    queueFixtures(callMock, okFixture('req_terminals', { terminals: [] }))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['terminal', 'list', '--worktree', 'floating', '--json'], '/tmp/repo')

    expect(callMock).toHaveBeenNthCalledWith(
      1,
      'terminal.list',
      expect.objectContaining({ worktree: 'id:global-floating-terminal' })
    )
  })

  // Why: unlike active/current the floating workspace is app-owned and server-side, so it is the
  // one cwd-free alias a paired CLI may send to a remote runtime.
  it('resolves the floating alias against a remote runtime', async () => {
    queueFixtures(callMock, okFixture('req_remote_list', { tabs: [] }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(
      ['tab', 'list', '--pairing-code', 'remote-runtime', '--worktree', 'floating', '--json'],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenNthCalledWith(1, 'browser.tabList', {
      worktree: 'id:global-floating-terminal'
    })
    expect([...logSpy.mock.calls, ...errSpy.mock.calls].flat().join('\n')).not.toContain(
      'cannot be resolved against a remote runtime'
    )

    process.exitCode = priorExitCode
  })

  it('still rejects the cwd aliases against a remote runtime', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(
      ['tab', 'list', '--pairing-code', 'remote-runtime', '--worktree', 'active', '--json'],
      '/tmp/repo'
    )

    expect(callMock).not.toHaveBeenCalled()
    expect([...logSpy.mock.calls, ...errSpy.mock.calls].flat().join('\n')).toContain(
      'active is a local cwd shortcut and cannot be resolved against a remote runtime.'
    )
    expect(process.exitCode).toBe(1)

    process.exitCode = priorExitCode
  })

  it('leaves an unknown selector for the runtime to refuse', async () => {
    callMock.mockResolvedValueOnce({
      id: 'req_unknown',
      ok: false,
      error: { code: 'selector_not_found', message: 'selector_not_found' },
      _meta: { runtimeId: 'runtime-1' }
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(['tab', 'list', '--worktree', 'name:nope', '--json'], '/tmp/repo')

    expect(callMock).toHaveBeenNthCalledWith(1, 'browser.tabList', { worktree: 'name:nope' })
    expect([...logSpy.mock.calls, ...errSpy.mock.calls].flat().join('\n')).toContain(
      'selector_not_found'
    )

    process.exitCode = priorExitCode
  })
})
