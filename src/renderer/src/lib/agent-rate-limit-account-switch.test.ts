import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClaudeManagedAccountSummary,
  ClaudeSessionFailoverCopyResult
} from '../../../shared/types'
import type { AgentProviderSessionMetadata } from '../../../shared/agent-session-resume'

const stopForegroundAgent = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true)
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
  stopForegroundAgent: (...args: unknown[]) => stopForegroundAgent(...args)
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

function run(
  overrides: Partial<Parameters<typeof runManagedAccountSwitchRelaunch>[0]> = {}
): ReturnType<typeof runManagedAccountSwitchRelaunch> {
  return runManagedAccountSwitchRelaunch({
    worktreeId: 'wt-1',
    ptyId: 'pty-1',
    providerSession: PROVIDER_SESSION,
    targetAccount: TARGET_ACCOUNT,
    sourceAccountId: null,
    settings: store.settings as never,
    ...overrides
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  store.settings = { agentCmdOverrides: {} }
  store.getKnownWorktreeById.mockReturnValue({ id: 'wt-1', path: '/Users/dev/demo' })
  store.createTab.mockReturnValue({ id: 'tab-new' })
  store.updateWorktreeMeta.mockImplementation(async () => {})
  stopForegroundAgent.mockResolvedValue(true)
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
  it('copies the session, pins the worktree, and resumes with continue in a new tab', async () => {
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
      sourceAccountId: null
    })
    expect(store.updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ claudeAccountId: TARGET_ACCOUNT.id })
    )
    const startup = store.queueTabStartupCommand.mock.calls[0][1] as {
      command: string
      resumeProviderSession?: unknown
    }
    expect(startup.command).toContain('--resume')
    expect(startup.command).toContain(PROVIDER_SESSION.id)
    expect(startup.resumeProviderSession).toEqual(PROVIDER_SESSION)
    expect(deliverLaunchPromptToAgentTab).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 'tab-new', content: 'continue', submit: true })
    )
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

  it('relaunches fresh (no resume) when the transcript copy fails', async () => {
    copySessionForAccountSwitch.mockResolvedValue({ ok: false, reason: 'source-not-found' })

    const result = await run()

    expect(result).toEqual({
      ok: true,
      accountLabel: 'spare@example.com',
      switched: 'fresh'
    })
    const startup = store.queueTabStartupCommand.mock.calls[0][1] as {
      command: string
      resumeProviderSession?: unknown
    }
    expect(startup.command).not.toContain('--resume')
    expect(startup.resumeProviderSession).toBeUndefined()
    expect(store.claimAutomaticAgentResume).not.toHaveBeenCalled()
    expect(deliverLaunchPromptToAgentTab).not.toHaveBeenCalled()
    // Why: even a fresh relaunch still pins to the target account.
    expect(store.updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ claudeAccountId: TARGET_ACCOUNT.id })
    )
  })

  it('reports "launched" when continue cannot be delivered', async () => {
    deliverLaunchPromptToAgentTab.mockResolvedValue(false)

    const result = await run()

    expect(result).toMatchObject({ ok: true, switched: 'launched' })
  })

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
