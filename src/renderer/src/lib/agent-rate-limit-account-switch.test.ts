import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClaudeManagedAccountSummary,
  ClaudeSessionFailoverCopyResult
} from '../../../shared/types'
import type { AgentProviderSessionMetadata } from '../../../shared/agent-session-resume'

const callRuntimeRpc = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const getRemoteRuntimePtyEnvironmentId = vi.fn<(ptyId: string) => string | null>(() => null)
const deliverLaunchPromptToAgentTab = vi.fn<(...args: unknown[]) => Promise<boolean>>(
  async () => true
)
const appendTabToWorktreeOrder = vi.fn<(...args: unknown[]) => void>()

type StoreStub = {
  settings: Record<string, unknown>
  rateLimits: Record<string, unknown>
  getKnownWorktreeById: ReturnType<typeof vi.fn>
  updateWorktreeMeta: ReturnType<typeof vi.fn>
  createTab: ReturnType<typeof vi.fn>
  queueTabStartupCommand: ReturnType<typeof vi.fn>
  claimAutomaticAgentResume: ReturnType<typeof vi.fn>
  setActiveTabType: ReturnType<typeof vi.fn>
}

const store: StoreStub = {
  settings: {},
  rateLimits: { claude: null, inactiveClaudeAccounts: [] },
  getKnownWorktreeById: vi.fn(() => ({ id: 'wt-1', path: '/Users/dev/demo' })),
  updateWorktreeMeta: vi.fn(async () => {}),
  createTab: vi.fn(() => ({ id: 'tab-new' })),
  queueTabStartupCommand: vi.fn(),
  claimAutomaticAgentResume: vi.fn(),
  setActiveTabType: vi.fn()
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: (...args: unknown[]) => callRuntimeRpc(...args)
}))
vi.mock('@/runtime/runtime-terminal-stream', () => ({
  getRemoteRuntimePtyEnvironmentId: (ptyId: string) => getRemoteRuntimePtyEnvironmentId(ptyId)
}))
vi.mock('@/lib/agent-launch-prompt-delivery', () => ({
  deliverLaunchPromptToAgentTab: (...args: unknown[]) => deliverLaunchPromptToAgentTab(...args)
}))
vi.mock('@/lib/sleeping-agent-session-launch', () => ({
  appendTabToWorktreeOrder: (...args: unknown[]) => appendTabToWorktreeOrder(...args)
}))
vi.mock('@/lib/new-workspace', () => ({ CLIENT_PLATFORM: 'darwin' as NodeJS.Platform }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    Object.entries(values ?? {}).reduce(
      (message, [key, value]) => message.replace(`{{${key}}}`, value),
      fallback
    )
}))

import { runManagedAccountSwitchRelaunch } from './agent-rate-limit-account-switch'

const PROVIDER_SESSION: AgentProviderSessionMetadata = { key: 'session_id', id: 'sess-123' }

function claudeAccount(
  overrides: Partial<ClaudeManagedAccountSummary> & { id: string }
): ClaudeManagedAccountSummary {
  return {
    email: `${overrides.id}@example.com`,
    managedAuthRuntime: 'host',
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...overrides
  }
}

const TARGET_ACCOUNT = claudeAccount({ id: 'spare-1', email: 'spare@example.com' })

const copySessionForAccountSwitch = vi.fn<
  (...args: unknown[]) => Promise<ClaudeSessionFailoverCopyResult>
>(async () => ({ ok: true, sessionId: PROVIDER_SESSION.id, copiedFileCount: 1 }))

type SwitchResultOverrides = Partial<{
  state: string
  failure: { reason: string; message: string; observedSessionId?: string }
  continuationDelivered: boolean
}>

function switchResponse(overrides: SwitchResultOverrides = {}): unknown {
  return {
    accepted: true,
    acceptance: { operationId: 'op-1' },
    result: {
      operationId: 'op-1',
      state: 'committed',
      terminal: 'orca-terminal-1',
      ptyId: 'pty-1',
      sourceAccountId: 'origin-1',
      targetAccountId: TARGET_ACCOUNT.id,
      sessionId: PROVIDER_SESSION.id,
      continuationDelivered: true,
      transcriptCopiedFileCount: 1,
      ...overrides
    }
  }
}

function run(
  overrides: Partial<Parameters<typeof runManagedAccountSwitchRelaunch>[0]> = {}
): ReturnType<typeof runManagedAccountSwitchRelaunch> {
  return runManagedAccountSwitchRelaunch({
    worktreeId: 'wt-1',
    ptyId: 'pty-1',
    providerSession: PROVIDER_SESSION,
    targetAccount: TARGET_ACCOUNT,
    sourceAccountId: 'origin-1',
    settings: store.settings as never,
    ...overrides
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  store.settings = {
    agentCmdOverrides: {},
    claudeManagedAccounts: [
      claudeAccount({ id: 'origin-1', managedAuthRuntime: 'host' }),
      TARGET_ACCOUNT
    ]
  }
  store.getKnownWorktreeById.mockReturnValue({ id: 'wt-1', path: '/Users/dev/demo' })
  store.createTab.mockReturnValue({ id: 'tab-new' })
  store.updateWorktreeMeta.mockImplementation(async () => {})
  getRemoteRuntimePtyEnvironmentId.mockReturnValue(null)
  callRuntimeRpc.mockResolvedValue(switchResponse())
  deliverLaunchPromptToAgentTab.mockResolvedValue(true)
  copySessionForAccountSwitch.mockResolvedValue({
    ok: true,
    sessionId: PROVIDER_SESSION.id,
    copiedFileCount: 1
  })
  ;(globalThis as { window?: unknown }).window = {
    api: { claudeAccounts: { copySessionForAccountSwitch } }
  } as unknown as typeof window
})

describe('runManagedAccountSwitchRelaunch', () => {
  it('delegates the whole switch to the runtime that owns the PTY, then pins the worktree', async () => {
    const result = await run()

    expect(result).toEqual({ ok: true, accountLabel: 'spare@example.com', switched: 'resumed' })
    expect(callRuntimeRpc).toHaveBeenCalledTimes(1)
    const [target, method, params] = callRuntimeRpc.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>
    ]
    expect(target).toEqual({ kind: 'local' })
    expect(method).toBe('accounts.switchClaudeTerminal')
    expect(params).toMatchObject({
      ptyId: 'pty-1',
      targetAccountId: TARGET_ACCOUNT.id,
      continuationPrompt: 'continue'
    })
    // Why: the runtime owns the stop, the transcript and the resume write now —
    // duplicating them here is what used to strand sessions on a bare shell.
    expect(copySessionForAccountSwitch).not.toHaveBeenCalled()
    expect(store.createTab).not.toHaveBeenCalled()
    expect(store.updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ claudeAccountId: TARGET_ACCOUNT.id })
    )
  })

  it('pins only after the switch is committed', async () => {
    await run()

    expect(callRuntimeRpc.mock.invocationCallOrder[0]!).toBeLessThan(
      store.updateWorktreeMeta.mock.invocationCallOrder[0]!
    )
  })

  it('runs the switch on the runtime that owns a remote PTY', async () => {
    getRemoteRuntimePtyEnvironmentId.mockReturnValue('env-7')

    await run()

    expect(callRuntimeRpc.mock.calls[0]?.[0]).toEqual({
      kind: 'environment',
      environmentId: 'env-7'
    })
  })

  it('writes fail-back markers so the origin can offer the return trip on recovery', async () => {
    await run({ sourceAccountId: 'origin-1' })

    const meta = store.updateWorktreeMeta.mock.calls[0][1] as Record<string, unknown>
    expect(meta.claudeFailoverOriginAccountId).toBe('origin-1')
    expect(typeof meta.claudeFailoverResetsAt).toBe('number')
  })

  it('records the shared sentinel as the origin when the source was unpinned', async () => {
    // Why the fallback path: an unpinned source shares no runtime with the target,
    // so this exercises the new-tab branch where the pin still needs a marker.
    await run({ sourceAccountId: null })

    const meta = store.updateWorktreeMeta.mock.calls[0][1] as Record<string, unknown>
    expect(meta.claudeFailoverOriginAccountId).toBe('__shared__')
  })

  it('reports a rolled-back switch, naming the account the session went back to', async () => {
    callRuntimeRpc.mockResolvedValue(
      switchResponse({
        state: 'rolled-back',
        failure: {
          reason: 'session-mismatch',
          message:
            'The resumed agent reported a different session, so Orca rolled the switch back.',
          observedSessionId: 'other-session'
        }
      })
    )

    const result = await run()

    expect(result).toMatchObject({
      ok: false,
      reason: 'resume-failed',
      message: expect.stringContaining('resumed the session on the original account')
    })
    expect(result).toMatchObject({ message: expect.stringContaining('other-session') })
    // Why: a session that went home must not leave the worktree pinned elsewhere.
    expect(store.updateWorktreeMeta).not.toHaveBeenCalled()
    expect(store.createTab).not.toHaveBeenCalled()
  })

  it('says so when the runtime could not bring the session back', async () => {
    callRuntimeRpc.mockResolvedValue(
      switchResponse({
        state: 'rollback-failed',
        failure: { reason: 'commit-failed', message: 'Accounting failed.' }
      })
    )

    const result = await run()

    expect(result).toMatchObject({
      ok: false,
      reason: 'resume-failed',
      message: expect.stringContaining('could not bring the session back')
    })
    expect(store.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('leaves the terminal untouched when the limited agent will not stop', async () => {
    callRuntimeRpc.mockResolvedValue(
      switchResponse({
        state: 'stopping-source',
        failure: { reason: 'source-stop-failed', message: 'The running agent did not exit.' }
      })
    )

    const result = await run()

    expect(result).toMatchObject({ ok: false, reason: 'stop-failed' })
    expect(store.updateWorktreeMeta).not.toHaveBeenCalled()
    expect(store.createTab).not.toHaveBeenCalled()
  })

  it('reports a failure rather than success when the runtime is unreachable', async () => {
    callRuntimeRpc.mockRejectedValue(new Error('socket closed'))

    const result = await run()

    expect(result).toMatchObject({
      ok: false,
      reason: 'resume-failed',
      message: expect.stringContaining('could not reach the runtime')
    })
    // Why neither restore verdict is claimed: the operation is detached and may
    // still be committing, so asserting either would be a guess.
    expect(result.ok === false && result.message).not.toContain(
      'resumed the session on the original'
    )
    expect(result.ok === false && result.message).not.toContain('could not bring the session back')
    expect(store.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it.each([
    ['terminal-not-found' as const],
    ['missing-launch-config' as const],
    ['missing-session' as const],
    ['unsupported-runtime' as const],
    ['concurrent' as const]
  ])('falls back to a new tab when the pane cannot host the switch (%s)', async (reason) => {
    callRuntimeRpc.mockResolvedValue(
      switchResponse({ state: 'preflighting', failure: { reason, message: 'refused' } })
    )

    const result = await run()

    expect(result).toMatchObject({ ok: true, switched: 'resumed' })
    expect(copySessionForAccountSwitch).toHaveBeenCalledWith({
      sessionId: PROVIDER_SESSION.id,
      cwd: '/Users/dev/demo',
      targetAccountId: TARGET_ACCOUNT.id,
      sourceAccountId: 'origin-1'
    })
    expect(store.createTab).toHaveBeenCalledTimes(1)
    expect(store.updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ claudeAccountId: TARGET_ACCOUNT.id })
    )
  })

  it('reports "launched" when the continuation prompt could not be delivered', async () => {
    callRuntimeRpc.mockResolvedValue(switchResponse({ continuationDelivered: false }))

    const result = await run()

    expect(result).toMatchObject({ ok: true, switched: 'launched' })
  })

  it('does not create a tab when the fallback cannot copy the transcript', async () => {
    callRuntimeRpc.mockResolvedValue(
      switchResponse({
        state: 'preflighting',
        failure: { reason: 'terminal-not-found', message: 'gone' }
      })
    )
    copySessionForAccountSwitch.mockResolvedValue({ ok: false, reason: 'source-not-found' })

    const result = await run()

    expect(result).toMatchObject({ ok: false, reason: 'resume-failed' })
    expect(store.createTab).not.toHaveBeenCalled()
    expect(store.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('reports pin-failed when the fallback cannot assign the account', async () => {
    callRuntimeRpc.mockResolvedValue(
      switchResponse({
        state: 'preflighting',
        failure: { reason: 'terminal-not-found', message: 'gone' }
      })
    )
    store.updateWorktreeMeta.mockRejectedValue(new Error('That Claude account no longer exists.'))

    const result = await run()

    expect(result).toMatchObject({ ok: false, reason: 'pin-failed' })
    expect(store.createTab).not.toHaveBeenCalled()
  })

  it('still reports success when the post-switch pin is rejected', async () => {
    store.updateWorktreeMeta.mockRejectedValue(new Error('metadata write failed'))

    const result = await run()

    // Why: the terminal is already on the target account; calling that a failed
    // switch would invite a retry that stops a healthy agent again.
    expect(result).toMatchObject({ ok: true, switched: 'resumed' })
  })

  it.each([
    [
      claudeAccount({ id: 'wsl-target', managedAuthRuntime: 'wsl', wslDistro: 'Ubuntu' }),
      claudeAccount({ id: 'origin-1', managedAuthRuntime: 'host' })
    ],
    [
      claudeAccount({ id: 'wsl-target', managedAuthRuntime: 'wsl', wslDistro: 'Ubuntu-24.04' }),
      claudeAccount({ id: 'origin-1', managedAuthRuntime: 'wsl', wslDistro: 'Ubuntu-22.04' })
    ]
  ])(
    'routes runtime-incompatible accounts to fallback without asking the runtime',
    async (target, source) => {
      store.settings = { ...store.settings, claudeManagedAccounts: [source, target] }

      const result = await run({ targetAccount: target })

      expect(result).toMatchObject({ ok: true })
      expect(callRuntimeRpc).not.toHaveBeenCalled()
      expect(store.createTab).toHaveBeenCalledTimes(1)
    }
  )

  it('rejects a custom-endpoint target without touching the terminal', async () => {
    const result = await run({
      targetAccount: claudeAccount({ id: 'endpoint-1', authMethod: 'custom-endpoint' })
    })

    expect(result).toMatchObject({ ok: false, reason: 'invalid-target' })
    expect(callRuntimeRpc).not.toHaveBeenCalled()
    expect(store.updateWorktreeMeta).not.toHaveBeenCalled()
  })
})
