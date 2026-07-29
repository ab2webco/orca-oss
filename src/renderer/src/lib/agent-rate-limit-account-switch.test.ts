import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClaudeManagedAccountSummary,
  ClaudeSessionFailoverCopyResult
} from '../../../shared/types'
import type { PreloadApi } from '../../../preload/api-types'
import type { AgentProviderSessionMetadata } from '../../../shared/agent-session-resume'

const stopForegroundAgent = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true)
const sendRuntimePtyInputVerified = vi.fn<(...args: unknown[]) => Promise<boolean>>(
  async () => true
)
const waitForResumedAgent = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true)
const waitForAgentReadyInput = vi.fn<() => Promise<void>>(async () => {})
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
vi.mock('@/lib/agent-rate-limit-terminal-control', () => ({
  stopForegroundAgent: (...args: unknown[]) => stopForegroundAgent(...args),
  waitForResumedAgent: (...args: unknown[]) => waitForResumedAgent(...args),
  waitForAgentReadyInput: () => waitForAgentReadyInput()
}))
vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  sendRuntimePtyInputVerified: (...args: unknown[]) => sendRuntimePtyInputVerified(...args)
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
type BeginClaudeAccountSwitch = PreloadApi['pty']['beginClaudeAccountSwitch']
const beginClaudeAccountSwitch = vi.fn<BeginClaudeAccountSwitch>(async () => ({
  ok: true,
  configDir: '/vaults/spare-1/auth',
  reservationId: 'reservation-1',
  shell: 'posix'
}))
const commitClaudeAccountSwitch = vi.fn(async () => true)
const cancelClaudeAccountSwitch = vi.fn(async () => {})

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
  stopForegroundAgent.mockResolvedValue(true)
  sendRuntimePtyInputVerified.mockResolvedValue(true)
  waitForResumedAgent.mockResolvedValue(true)
  beginClaudeAccountSwitch.mockResolvedValue({
    ok: true,
    configDir: '/vaults/spare-1/auth',
    reservationId: 'reservation-1',
    shell: 'posix'
  })
  commitClaudeAccountSwitch.mockResolvedValue(true)
  deliverLaunchPromptToAgentTab.mockResolvedValue(true)
  copySessionForAccountSwitch.mockResolvedValue({
    ok: true,
    sessionId: PROVIDER_SESSION.id,
    copiedFileCount: 1
  })
  ;(globalThis as { window?: unknown }).window = {
    api: {
      claudeAccounts: { copySessionForAccountSwitch },
      pty: {
        beginClaudeAccountSwitch,
        commitClaudeAccountSwitch,
        cancelClaudeAccountSwitch
      }
    }
  } as unknown as typeof window
})

describe('runManagedAccountSwitchRelaunch', () => {
  it('copies the session, pins the worktree, and resumes with continue in the same PTY', async () => {
    const result = await run()

    expect(result).toEqual({
      ok: true,
      accountLabel: 'spare@example.com',
      switched: 'resumed'
    })
    expect(copySessionForAccountSwitch).toHaveBeenCalledWith({
      sessionId: PROVIDER_SESSION.id,
      cwd: '/Users/dev/demo',
      targetAccountId: TARGET_ACCOUNT.id,
      sourceAccountId: 'origin-1'
    })
    expect(store.updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ claudeAccountId: TARGET_ACCOUNT.id })
    )
    expect(beginClaudeAccountSwitch).toHaveBeenCalledWith({
      ptyId: 'pty-1',
      sourceAccountId: 'origin-1',
      targetAccountId: TARGET_ACCOUNT.id,
      runtime: 'host',
      wslDistro: null
    })
    const sentInputs = sendRuntimePtyInputVerified.mock.calls.map((call) => call[2])
    expect(sentInputs[0]).toContain("export CLAUDE_CONFIG_DIR='/vaults/spare-1/auth'")
    expect(sentInputs[0]).toContain('--resume')
    expect(sentInputs[0]).toContain(PROVIDER_SESSION.id)
    expect(sentInputs[1]).toBe('continue\r')
    expect(commitClaudeAccountSwitch).toHaveBeenCalledWith({
      ptyId: 'pty-1',
      targetAccountId: TARGET_ACCOUNT.id,
      reservationId: 'reservation-1'
    })
    expect(waitForResumedAgent.mock.invocationCallOrder[0]).toBeLessThan(
      commitClaudeAccountSwitch.mock.invocationCallOrder[0]!
    )
    expect(store.createTab).not.toHaveBeenCalled()
    expect(store.queueTabStartupCommand).not.toHaveBeenCalled()
  })

  it('writes fail-back markers so the origin can offer the return trip on recovery', async () => {
    await run({ sourceAccountId: 'origin-1' })

    const meta = store.updateWorktreeMeta.mock.calls[0][1] as Record<string, unknown>
    expect(meta.claudeFailoverOriginAccountId).toBe('origin-1')
    expect(typeof meta.claudeFailoverResetsAt).toBe('number')
  })

  it('records the shared sentinel as the origin when the source was unpinned', async () => {
    await run({ sourceAccountId: null })

    const meta = store.updateWorktreeMeta.mock.calls[0][1] as Record<string, unknown>
    // Why: an unpinned (shared ~/.claude) origin still needs a marker the watcher can resolve.
    expect(meta.claudeFailoverOriginAccountId).toBe('__shared__')
  })

  it('forwards the injected source account so the copy reads the right universe', async () => {
    await run({ sourceAccountId: 'origin-1' })

    expect(copySessionForAccountSwitch).toHaveBeenCalledWith(
      expect.objectContaining({ sourceAccountId: 'origin-1' })
    )
  })

  it('does not launch a different terminal when the transcript copy fails', async () => {
    copySessionForAccountSwitch.mockResolvedValue({ ok: false, reason: 'source-not-found' })

    const result = await run()

    expect(result).toMatchObject({ ok: false, reason: 'resume-failed' })
    expect(store.claimAutomaticAgentResume).not.toHaveBeenCalled()
    expect(deliverLaunchPromptToAgentTab).not.toHaveBeenCalled()
    expect(store.createTab).not.toHaveBeenCalled()
    expect(store.updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ claudeAccountId: TARGET_ACCOUNT.id })
    )
  })

  it('reports "launched" when continue cannot be delivered', async () => {
    sendRuntimePtyInputVerified.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const result = await run()

    expect(result).toMatchObject({ ok: true, switched: 'launched' })
  })

  it('falls back to a new tab only when main proves the existing PTY is unhealthy', async () => {
    beginClaudeAccountSwitch.mockResolvedValueOnce({ ok: false, reason: 'unhealthy' })

    const result = await run()

    expect(result).toMatchObject({ ok: true, switched: 'resumed' })
    expect(store.createTab).toHaveBeenCalledTimes(1)
    expect(beginClaudeAccountSwitch).toHaveBeenCalledWith({
      ptyId: 'pty-1',
      sourceAccountId: 'origin-1',
      targetAccountId: TARGET_ACCOUNT.id,
      runtime: 'host',
      wslDistro: null
    })
    expect(sendRuntimePtyInputVerified).not.toHaveBeenCalled()
    expect(commitClaudeAccountSwitch).not.toHaveBeenCalled()
  })

  it('does not open a fallback tab after the resume command was accepted but stayed ambiguous', async () => {
    waitForResumedAgent.mockResolvedValueOnce(false)

    const result = await run()

    expect(result).toMatchObject({ ok: false, reason: 'resume-failed' })
    expect(store.createTab).not.toHaveBeenCalled()
    expect(commitClaudeAccountSwitch).not.toHaveBeenCalled()
    expect(cancelClaudeAccountSwitch).toHaveBeenCalledWith({
      reservationId: 'reservation-1'
    })
  })

  it('stops the confirmed destination CLI and cancels ownership when commit fails', async () => {
    commitClaudeAccountSwitch.mockResolvedValueOnce(false)

    const result = await run()

    expect(result).toMatchObject({ ok: false, reason: 'resume-failed' })
    expect(waitForResumedAgent).toHaveBeenCalledTimes(1)
    expect(stopForegroundAgent).toHaveBeenCalledTimes(2)
    expect(cancelClaudeAccountSwitch).toHaveBeenCalledWith({
      reservationId: 'reservation-1'
    })
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
    'routes runtime-incompatible accounts to fallback before in-place preparation',
    async (target, source) => {
      store.settings = {
        ...store.settings,
        claudeManagedAccounts: [source, target]
      }

      const result = await run({ targetAccount: target })

      expect(result).toMatchObject({ ok: true })
      expect(stopForegroundAgent).not.toHaveBeenCalled()
      expect(beginClaudeAccountSwitch).not.toHaveBeenCalled()
      expect(store.createTab).toHaveBeenCalledTimes(1)
    }
  )

  it('rejects a custom-endpoint target without touching the terminal', async () => {
    const result = await run({
      targetAccount: claudeAccount({ id: 'endpoint-1', authMethod: 'custom-endpoint' })
    })

    expect(result).toMatchObject({ ok: false, reason: 'invalid-target' })
    expect(stopForegroundAgent).not.toHaveBeenCalled()
    expect(store.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('leaves the terminal untouched when the limited agent will not stop', async () => {
    stopForegroundAgent.mockResolvedValue(false)

    const result = await run()

    expect(result).toMatchObject({ ok: false, reason: 'stop-failed' })
    expect(store.updateWorktreeMeta).not.toHaveBeenCalled()
    expect(store.createTab).not.toHaveBeenCalled()
  })

  it('fails without launching when the pin update is rejected', async () => {
    store.updateWorktreeMeta.mockRejectedValue(new Error('That Claude account no longer exists.'))

    const result = await run()

    expect(result).toMatchObject({ ok: false, reason: 'pin-failed' })
    expect(store.createTab).not.toHaveBeenCalled()
  })
})
