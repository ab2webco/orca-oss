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

import { main } from './index'
import { buildWorktree, okFixture, queueFixtures, worktreeListFixture } from './test-fixtures'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'
import { AUTOMATION_ACCOUNT_PIN_RUNTIME_CAPABILITY } from '../shared/protocol-version'

const statusFixture = (capabilities: string[] = [AUTOMATION_ACCOUNT_PIN_RUNTIME_CAPABILITY]) =>
  okFixture('req_status', { capabilities })

const accountsSnapshot = () =>
  okFixture('req_accounts', {
    claude: {
      accounts: [{ id: 'acc-claude', email: 'claude@example.com' }],
      activeAccountId: null
    },
    codex: {
      accounts: [{ id: 'acc-codex', email: 'codex@example.com' }],
      activeAccountId: null
    }
  })

const automationFixture = (requestId: string) =>
  okFixture(requestId, { automation: { id: 'auto-1', name: 'Daily review' } })

const createArgs = [
  'automations',
  'create',
  '--name',
  'Daily review',
  '--trigger',
  'daily',
  '--prompt',
  'Review open changes',
  '--provider',
  'claude',
  '--workspace',
  'current',
  '--json'
]

describe('orca cli automation account pins', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  const worktrees = () =>
    worktreeListFixture([buildWorktree('/tmp/repo/feature', 'feature/foo', 'abc', 'repo-1')])

  it('resolves email and id selectors on create', async () => {
    queueFixtures(
      callMock,
      worktrees(),
      statusFixture(),
      accountsSnapshot(),
      automationFixture('req_create')
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      [...createArgs, '--claude-account', 'claude@example.com', '--codex-account', 'acc-codex'],
      '/tmp/repo/feature/src'
    )

    expect(callMock).toHaveBeenCalledWith('accounts.snapshot')
    expect(callMock).toHaveBeenCalledWith(
      'automation.create',
      expect.objectContaining({ claudeAccountId: 'acc-claude', codexAccountId: 'acc-codex' })
    )
  })

  it('does not fetch the roster or send pins when neither flag is passed', async () => {
    queueFixtures(callMock, worktrees(), automationFixture('req_create'))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(createArgs, '/tmp/repo/feature/src')

    expect(callMock).not.toHaveBeenCalledWith('accounts.snapshot')
    const params = callMock.mock.calls.find(([method]) => method === 'automation.create')?.[1]
    expect(Object.hasOwn(params, 'claudeAccountId')).toBe(false)
    expect(Object.hasOwn(params, 'codexAccountId')).toBe(false)
  })

  it('refuses pins on a runtime too old to store them, before creating anything', async () => {
    queueFixtures(callMock, worktrees(), statusFixture([]))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main([...createArgs, '--claude-account', 'claude@example.com'], '/tmp/repo/feature/src')

    expect(callMock).not.toHaveBeenCalledWith('automation.create', expect.anything())
    expect([...logSpy.mock.calls, ...errSpy.mock.calls].flat().join('\n')).toContain(
      'does not support account pins on automations'
    )
    process.exitCode = priorExitCode
  })

  it('sets one pin and clears the other back to inherit on edit', async () => {
    queueFixtures(callMock, statusFixture(), accountsSnapshot(), automationFixture('req_edit'))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      [
        'automations',
        'edit',
        'auto-1',
        '--claude-account',
        'claude@example.com',
        '--codex-account',
        'inherit',
        '--json'
      ],
      '/tmp/repo'
    )

    expect(callMock).toHaveBeenCalledWith('automation.update', {
      id: 'auto-1',
      updates: expect.objectContaining({ claudeAccountId: 'acc-claude', codexAccountId: null })
    })
  })

  it('clears with an empty value, like --target-pane, without fetching the roster', async () => {
    queueFixtures(callMock, statusFixture(), automationFixture('req_edit'))
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['automations', 'edit', 'auto-1', '--claude-account', '', '--json'], '/tmp/repo')

    expect(callMock).not.toHaveBeenCalledWith('accounts.snapshot')
    expect(callMock).toHaveBeenCalledWith('automation.update', {
      id: 'auto-1',
      updates: expect.objectContaining({ claudeAccountId: null })
    })
  })

  it('rejects an unknown account before creating anything', async () => {
    queueFixtures(callMock, worktrees(), statusFixture(), accountsSnapshot())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main([...createArgs, '--claude-account', 'nobody@example.com'], '/tmp/repo/feature/src')

    expect(callMock).not.toHaveBeenCalledWith('automation.create', expect.anything())
    expect([...logSpy.mock.calls, ...errSpy.mock.calls].flat().join('\n')).toContain(
      'does not match any Claude account'
    )
    process.exitCode = priorExitCode
  })

  it('rejects account pins on command-only automations', async () => {
    queueFixtures(callMock, worktrees())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(
      [
        'automations',
        'create',
        '--name',
        'Sync',
        '--trigger',
        'hourly',
        '--command',
        'echo hi',
        '--workspace',
        'current',
        '--claude-account',
        'claude@example.com'
      ],
      '/tmp/repo/feature/src'
    )

    expect(callMock).not.toHaveBeenCalledWith('automation.create', expect.anything())
    expect([...logSpy.mock.calls, ...errSpy.mock.calls].flat().join('\n')).toContain(
      'apply to agent automations, not --command'
    )
    process.exitCode = priorExitCode
  })
})
