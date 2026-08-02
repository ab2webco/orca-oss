import { afterEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { isStreamingMethod } from '../core'
import { ACCOUNT_METHODS } from './accounts'
import {
  attachClaudeTerminalAccountSwitchServices,
  resetClaudeTerminalAccountSwitchOperations
} from '../../claude-terminal-account-switch-service'

function method(name: string) {
  const found = ACCOUNT_METHODS.find((candidate) => candidate.name === name)
  if (!found) {
    throw new Error(`Missing method ${name}`)
  }
  return found
}

describe('account RPC methods', () => {
  it('returns the exact managed owner recorded for a runtime PTY', async () => {
    const getManagedPtyAccountOwner = vi.fn(() => ({
      known: true,
      accountId: 'codex-account',
      customEndpoint: false
    }))
    const runtime = { getManagedPtyAccountOwner } as unknown as OrcaRuntimeService
    const owner = method('accounts.getPtyOwner')
    if (isStreamingMethod(owner)) {
      throw new Error('accounts.getPtyOwner must be a request method')
    }

    await expect(owner.handler({ ptyId: 'pty-1', agent: 'codex' }, { runtime })).resolves.toEqual({
      known: true,
      accountId: 'codex-account',
      customEndpoint: false
    })
    expect(getManagedPtyAccountOwner).toHaveBeenCalledWith('pty-1', 'codex')
  })

  it.each([
    {
      methodName: 'accounts.addClaudeFromConfigDir',
      params: {
        configDir: join(tmpdir(), 'claude-login'),
        previousLegacyCredentialsSha256: 'a'.repeat(64)
      },
      runtimeMethod: 'addClaudeAccountFromConfigDir',
      expectedSource: join(tmpdir(), 'claude-login'),
      expectedOptions: {
        runtime: undefined,
        wslDistro: null,
        previousLegacyCredentialsSha256: 'a'.repeat(64)
      }
    },
    {
      methodName: 'accounts.addCodexFromHome',
      params: { sourceHome: join(tmpdir(), 'codex-login') },
      runtimeMethod: 'addCodexAccountFromHome',
      expectedSource: join(tmpdir(), 'codex-login'),
      expectedOptions: { runtime: undefined, wslDistro: null }
    }
  ])('allows local-socket $methodName calls', async (testCase) => {
    const add = vi.fn().mockResolvedValue({ accounts: [] })
    const runtime = { [testCase.runtimeMethod]: add } as unknown as OrcaRuntimeService
    const addMethod = method(testCase.methodName)
    if (isStreamingMethod(addMethod)) {
      throw new Error(`${testCase.methodName} must be a request method`)
    }

    await addMethod.handler(testCase.params, { runtime })

    expect(add).toHaveBeenCalledWith(testCase.expectedSource, testCase.expectedOptions)
  })

  it.each([
    ['accounts.addClaudeFromConfigDir', { configDir: join(tmpdir(), 'claude-login') }],
    ['accounts.addCodexFromHome', { sourceHome: join(tmpdir(), 'codex-login') }]
  ])('rejects paired-device calls to %s', async (methodName, params) => {
    const runtime = {
      addClaudeAccountFromConfigDir: vi.fn(),
      addCodexAccountFromHome: vi.fn()
    } as unknown as OrcaRuntimeService
    const addMethod = method(methodName)
    if (isStreamingMethod(addMethod)) {
      throw new Error(`${methodName} must be a request method`)
    }

    for (const clientKind of ['mobile', 'runtime'] as const) {
      await expect(addMethod.handler(params, { runtime, clientKind })).rejects.toThrow(
        /only available on the Orca host runtime/
      )
    }
    expect(runtime.addClaudeAccountFromConfigDir).not.toHaveBeenCalled()
    expect(runtime.addCodexAccountFromHome).not.toHaveBeenCalled()
  })

  it('keeps explicit account-list refreshes on the forced refresh lane', async () => {
    const snapshot = { claude: null, codex: null }
    const runtime = {
      refreshAccountsForMobile: vi.fn().mockResolvedValue(undefined),
      getAccountsSnapshot: vi.fn(() => snapshot)
    } as unknown as OrcaRuntimeService
    const list = method('accounts.list')
    if (isStreamingMethod(list)) {
      throw new Error('accounts.list must be a request method')
    }

    // Why: clients that send no params (mobile, web) must keep the forced lane.
    await expect(list.handler(list.params?.parse({}), { runtime })).resolves.toBe(snapshot)
    expect(runtime.refreshAccountsForMobile).toHaveBeenCalledOnce()
  })

  it('serves accounts.snapshot from the cache without a provider refresh', async () => {
    const snapshot = { claude: null, codex: null }
    const runtime = {
      refreshAccountsForMobile: vi.fn().mockResolvedValue(undefined),
      getAccountsSnapshot: vi.fn(() => snapshot)
    } as unknown as OrcaRuntimeService
    const snapshotMethod = method('accounts.snapshot')
    if (isStreamingMethod(snapshotMethod)) {
      throw new Error('accounts.snapshot must be a request method')
    }

    await expect(snapshotMethod.handler(undefined, { runtime })).resolves.toBe(snapshot)
    expect(runtime.refreshAccountsForMobile).not.toHaveBeenCalled()
  })

  it('skips the forced provider refresh when the caller opts out', async () => {
    const snapshot = { claude: null, codex: null }
    const runtime = {
      refreshAccountsForMobile: vi.fn().mockResolvedValue(undefined),
      getAccountsSnapshot: vi.fn(() => snapshot)
    } as unknown as OrcaRuntimeService
    const list = method('accounts.list')
    if (isStreamingMethod(list)) {
      throw new Error('accounts.list must be a request method')
    }

    await expect(
      list.handler(list.params?.parse({ refreshUsage: false }), { runtime })
    ).resolves.toBe(snapshot)
    expect(runtime.refreshAccountsForMobile).not.toHaveBeenCalled()
  })

  it('forwards a client idempotency key when consuming a Codex reset credit', async () => {
    const idempotencyKey = '11111111-1111-4111-8111-111111111111'
    const expectedScope = {
      target: { runtime: 'host' as const, wslDistro: null },
      accountId: 'codex-account',
      accountRevision: 42,
      offerRevision: 'v1:offer'
    }
    const result = {
      outcome: 'reset',
      scope: expectedScope,
      snapshot: { claude: null, codex: null }
    }
    const consumeCodexRateLimitResetCredit = vi.fn().mockResolvedValue(result)
    const runtime = { consumeCodexRateLimitResetCredit } as unknown as OrcaRuntimeService
    const reset = method('accounts.consumeCodexResetCredit')
    if (isStreamingMethod(reset)) {
      throw new Error('accounts.consumeCodexResetCredit must be a request method')
    }

    expect(reset.params?.parse({ idempotencyKey, expectedScope })).toEqual({
      idempotencyKey,
      expectedScope
    })
    expect(() => reset.params?.parse({ idempotencyKey: 'not-a-uuid', expectedScope })).toThrow()
    expect(() =>
      reset.params?.parse({
        idempotencyKey,
        expectedScope: {
          ...expectedScope,
          target: { runtime: 'host', wslDistro: 'Ubuntu' }
        }
      })
    ).toThrow()
    expect(() =>
      reset.params?.parse({
        idempotencyKey,
        expectedScope: {
          ...expectedScope,
          target: { runtime: 'wsl', wslDistro: null }
        }
      })
    ).toThrow()
    expect(() => reset.params?.parse({ idempotencyKey, expectedScope, extra: true })).toThrow()
    await expect(reset.handler({ idempotencyKey, expectedScope }, { runtime })).resolves.toBe(
      result
    )
    expect(consumeCodexRateLimitResetCredit).toHaveBeenCalledWith(idempotencyKey, expectedScope)
  })

  it('forwards the exact WSL target when selecting a Codex account', async () => {
    const selectCodexAccountForTarget = vi
      .fn()
      .mockResolvedValue({ accounts: [], activeAccountId: null })
    const runtime = { selectCodexAccountForTarget } as unknown as OrcaRuntimeService
    const select = method('accounts.selectCodexForTarget')
    if (isStreamingMethod(select)) {
      throw new Error('accounts.selectCodexForTarget must be a request method')
    }
    const params = {
      accountId: null,
      target: { runtime: 'wsl' as const, wslDistro: 'Ubuntu' }
    }

    expect(select.params?.parse(params)).toEqual(params)
    expect(
      select.params?.parse({
        accountId: null,
        target: { runtime: 'wsl', wslDistro: null }
      })
    ).toEqual({ accountId: null, target: { runtime: 'wsl', wslDistro: null } })
    expect(() =>
      select.params?.parse({
        accountId: null,
        target: { runtime: 'host', wslDistro: 'Ubuntu' }
      })
    ).toThrow()
    expect(() =>
      select.params?.parse({
        accountId: null,
        target: { runtime: 'wsl', wslDistro: '   ' }
      })
    ).toThrow()
    await expect(select.handler(params, { runtime })).resolves.toEqual({
      accounts: [],
      activeAccountId: null
    })
    expect(selectCodexAccountForTarget).toHaveBeenCalledWith(null, params.target)
  })

  it('uses a stale-aware refresh when a connection replays the subscription', async () => {
    const snapshot = { claude: null, codex: null }
    let cleanup: (() => void) | undefined
    const runtime = {
      getAccountsSnapshot: vi.fn(() => snapshot),
      onAccountsChanged: vi.fn(() => vi.fn()),
      registerSubscriptionCleanup: vi.fn((_id: string, nextCleanup: () => void) => {
        cleanup = nextCleanup
      }),
      refreshAccountsForMobile: vi.fn().mockResolvedValue(undefined),
      refreshAccountsForMobileSubscriber: vi.fn().mockResolvedValue(undefined)
    } as unknown as OrcaRuntimeService
    const subscribe = method('accounts.subscribe')
    if (!isStreamingMethod(subscribe)) {
      throw new Error('accounts.subscribe must be a streaming method')
    }
    const emit = vi.fn()

    const running = subscribe.handler(undefined, { runtime, connectionId: 'connection-1' }, emit)
    await vi.waitFor(() => {
      expect(runtime.refreshAccountsForMobileSubscriber).toHaveBeenCalledOnce()
    })

    expect(runtime.refreshAccountsForMobile).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready', snapshot }))
    cleanup?.()
    await running
  })
})

describe('accounts.switchClaudeTerminal', () => {
  afterEach(() => {
    attachClaudeTerminalAccountSwitchServices(null)
    resetClaudeTerminalAccountSwitchOperations()
  })

  function requestMethod(name: string) {
    const found = method(name)
    if (isStreamingMethod(found)) {
      throw new Error(`${name} must be a request method`)
    }
    return found
  }

  function buildRuntime(overrides: Record<string, unknown> = {}): OrcaRuntimeService {
    return {
      snapshotClaudeTerminalSwitchTarget: vi.fn().mockResolvedValue({
        ok: true,
        terminal: 'orca-terminal-1',
        ptyId: 'pty-1',
        paneKey: 'tab-1:leaf-1',
        worktreeId: 'worktree-1',
        cwd: '/repo/worktree',
        launchConfig: {
          agentCommand: 'claude --dangerously-skip-permissions',
          agentArgs: '--dangerously-skip-permissions',
          agentEnv: {}
        },
        isWsl: false,
        wslDistro: null,
        remoteConnectionId: null,
        providerSession: { agent: 'claude', id: 'session-1' }
      }),
      inspectTerminalProcess: vi
        .fn()
        .mockResolvedValue({ foregroundProcess: 'zsh', hasChildProcesses: false }),
      sendTerminal: vi.fn().mockResolvedValue({ accepted: true, bytesWritten: 1 }),
      sendTerminalAgentPrompt: vi.fn().mockResolvedValue({ accepted: true, bytesWritten: 1 }),
      getExactWorkerProviderSession: vi.fn(() => null),
      ...overrides
    } as unknown as OrcaRuntimeService
  }

  function attachFakeServices(overrides: Record<string, unknown> = {}): void {
    attachClaudeTerminalAccountSwitchServices({
      getSettings: () => ({
        claudeManagedAccounts: [
          {
            id: 'account-target',
            email: 'target@example.com',
            managedAuthPath: '/vault/account-target',
            authMethod: 'oauth',
            createdAt: 0,
            updatedAt: 0,
            lastAuthenticatedAt: 0
          }
        ]
      }),
      prepareClaudeAuth: vi.fn().mockRejectedValue(new Error('prepare unavailable')),
      getPtyClaudeAccountId: () => 'account-source',
      ...overrides
    } as never)
  }

  it('refuses a paired device before touching the runtime', async () => {
    const runtime = buildRuntime()
    const handler = requestMethod('accounts.switchClaudeTerminal').handler
    await expect(
      handler(
        { terminal: 'orca-terminal-1', targetAccountId: 'account-target' },
        { runtime, clientKind: 'mobile' }
      )
    ).rejects.toThrow(/paired device/)
    expect(runtime.snapshotClaudeTerminalSwitchTarget).not.toHaveBeenCalled()
  })

  it.each([
    [{ targetAccountId: 'account-target' }],
    [{ terminal: 'orca-terminal-1', ptyId: 'pty-1', targetAccountId: 'account-target' }]
  ])('rejects an ambiguous or missing terminal selector: %j', (params) => {
    const parsed = requestMethod('accounts.switchClaudeTerminal').params?.safeParse(params)
    expect(parsed?.success).toBe(false)
  })

  it('refuses with runtime-unavailable when no account services are attached', async () => {
    const runtime = buildRuntime()
    const result = (await requestMethod('accounts.switchClaudeTerminal').handler(
      { terminal: 'orca-terminal-1', targetAccountId: 'account-target' },
      { runtime }
    )) as { accepted: boolean; result: { failure?: { reason: string } } }
    expect(result.accepted).toBe(false)
    expect(result.result.failure?.reason).toBe('runtime-unavailable')
    expect(runtime.snapshotClaudeTerminalSwitchTarget).not.toHaveBeenCalled()
  })

  it.each([
    ['unsupported-runtime', { isWsl: true }],
    ['unsupported-runtime', { remoteConnectionId: 'ssh-1' }],
    ['missing-session', { providerSession: null }],
    ['missing-launch-config', { launchConfig: null }]
  ])('refuses %s before any terminal write', async (reason, snapshotOverride) => {
    attachFakeServices()
    const runtime = buildRuntime()
    const snapshot = await (
      runtime.snapshotClaudeTerminalSwitchTarget as unknown as () => Promise<object>
    )()
    const patched = buildRuntime({
      snapshotClaudeTerminalSwitchTarget: vi
        .fn()
        .mockResolvedValue({ ...snapshot, ...snapshotOverride })
    })
    const result = (await requestMethod('accounts.switchClaudeTerminal').handler(
      { terminal: 'orca-terminal-1', targetAccountId: 'account-target' },
      { runtime: patched }
    )) as { accepted: boolean; result: { failure?: { reason: string } } }
    expect(result.accepted).toBe(false)
    expect(result.result.failure?.reason).toBe(reason)
    expect(patched.sendTerminal).not.toHaveBeenCalled()
  })

  it('accepts before destructive work and exposes the operation by id', async () => {
    attachFakeServices()
    const runtime = buildRuntime()
    const accepted = (await requestMethod('accounts.switchClaudeTerminal').handler(
      { terminal: 'orca-terminal-1', targetAccountId: 'account-unknown', awaitMs: 0 },
      { runtime }
    )) as {
      accepted: boolean
      acceptance: { operationId: string; sessionId: string }
      result: { state: string }
    }
    expect(accepted.accepted).toBe(true)
    expect(accepted.result.state).toBe('preflighting')
    expect(accepted.acceptance.sessionId).toBe('session-1')

    const readStatus = async (): Promise<{
      operationId: string
      state: string
      failure?: { reason: string }
    } | null> =>
      (
        (await requestMethod('accounts.claudeTerminalSwitchStatus').handler(
          { operationId: accepted.acceptance.operationId },
          { runtime }
        )) as {
          result: { operationId: string; state: string; failure?: { reason: string } } | null
        }
      ).result
    expect((await readStatus())?.operationId).toBe(accepted.acceptance.operationId)
    // The detached operation finishes without the caller, and an unresolvable
    // target is refused before any Ctrl+C or PTY write.
    await vi.waitFor(async () => {
      expect((await readStatus())?.failure?.reason).toBe('target-not-found')
    })
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
  })

  it('reports no status for an unknown operation id', async () => {
    const status = (await requestMethod('accounts.claudeTerminalSwitchStatus').handler(
      { operationId: 'missing' },
      { runtime: buildRuntime() }
    )) as { result: unknown }
    expect(status.result).toBeNull()
  })
})
