import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClaudeLivePtyAccountInfo,
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState,
  ClaudeSessionFailoverCopyResult,
  CodexRateLimitAccountsState
} from '../../../shared/types'
import type { RateLimitState, ProviderRateLimits } from '../../../shared/rate-limit-types'

const sendRuntimePtyInputVerified = vi.fn<(...args: unknown[]) => Promise<boolean>>(
  async () => true
)
const stopForegroundAgent = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true)
const waitForResumedAgent = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true)
const waitForAgentReadyInput = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
const deliverLaunchPromptToAgentTab = vi.fn<(...args: unknown[]) => Promise<boolean>>(
  async () => true
)
const appendTabToWorktreeOrder = vi.fn<(...args: unknown[]) => void>()

type StoreStub = {
  settings: Record<string, unknown>
  rateLimits: RateLimitState
  setRateLimitsFromPush: ReturnType<typeof vi.fn>
  fetchSettings: ReturnType<typeof vi.fn>
  getKnownWorktreeById: ReturnType<typeof vi.fn>
  updateWorktreeMeta: ReturnType<typeof vi.fn>
  createTab: ReturnType<typeof vi.fn>
  queueTabStartupCommand: ReturnType<typeof vi.fn>
  claimAutomaticAgentResume: ReturnType<typeof vi.fn>
  setActiveTabType: ReturnType<typeof vi.fn>
}

const store: StoreStub = {
  settings: {},
  rateLimits: rateLimitState(),
  setRateLimitsFromPush: vi.fn(),
  fetchSettings: vi.fn(async () => {}),
  getKnownWorktreeById: vi.fn(() => ({ id: 'wt-1', path: '/Users/dev/demo' })),
  updateWorktreeMeta: vi.fn(async () => {}),
  createTab: vi.fn(() => ({ id: 'tab-new' })),
  queueTabStartupCommand: vi.fn(),
  claimAutomaticAgentResume: vi.fn(),
  setActiveTabType: vi.fn()
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))
vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  sendRuntimePtyInputVerified: (...args: unknown[]) => sendRuntimePtyInputVerified(...args)
}))
vi.mock('@/runtime/runtime-terminal-stream', () => ({
  getRemoteRuntimePtyEnvironmentId: () => null
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: vi.fn(async () => ({}))
}))
vi.mock('@/lib/agent-rate-limit-terminal-control', () => ({
  stopForegroundAgent: (...args: unknown[]) => stopForegroundAgent(...args),
  waitForResumedAgent: (...args: unknown[]) => waitForResumedAgent(...args),
  waitForAgentReadyInput: (...args: unknown[]) => waitForAgentReadyInput(...args)
}))
vi.mock('./agent-rate-limit-resume-platform', () => ({
  resolveAgentRateLimitResumePlatform: async () => 'darwin' as NodeJS.Platform
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

import { runAgentRateLimitAutoSwitch } from './agent-rate-limit-auto-switch-runner'

const PROVIDER_SESSION = { key: 'session_id', id: 'sess-123' } as const

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

const ENDPOINT_ACCOUNT = claudeAccount({
  id: 'endpoint-1',
  email: 'z.ai · GLM',
  authMethod: 'custom-endpoint',
  endpointLabel: 'z.ai · GLM'
})

function claudeState(accounts: ClaudeManagedAccountSummary[]): ClaudeRateLimitAccountsState {
  return {
    accounts,
    activeAccountId: 'active-1',
    activeAccountIdsByRuntime: { host: 'active-1', wsl: {} }
  }
}

const emptyCodexState: CodexRateLimitAccountsState = {
  accounts: [],
  activeAccountId: null,
  activeAccountIdsByRuntime: { host: null, wsl: {} }
}

function usableLimits(usedPercent: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 1,
    error: null,
    status: 'ok'
  }
}

function rateLimitState(overrides: Partial<RateLimitState> = {}): RateLimitState {
  return {
    claude: null,
    codex: null,
    gemini: null,
    opencodeGo: null,
    kimi: null,
    antigravity: null,
    minimax: null,
    grok: null,
    minimaxCookieConfigured: false,
    grokAuthConfigured: false,
    claudeTarget: { runtime: 'host', wslDistro: null },
    codexTarget: { runtime: 'host', wslDistro: null },
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: [],
    ...overrides
  }
}

const api = {
  claudeAccounts: {
    list: vi.fn<() => Promise<ClaudeRateLimitAccountsState>>(),
    select: vi.fn(async () => ({})),
    getLivePtyAccount: vi.fn<() => Promise<ClaudeLivePtyAccountInfo | null>>(async () => null),
    copySessionForFailover: vi.fn<(...args: unknown[]) => Promise<ClaudeSessionFailoverCopyResult>>(
      async () => ({
        ok: true,
        sessionId: PROVIDER_SESSION.id,
        copiedFileCount: 1
      })
    ),
    copySessionForAccountSwitch: vi.fn<
      (...args: unknown[]) => Promise<ClaudeSessionFailoverCopyResult>
    >(async () => ({
      ok: true,
      sessionId: PROVIDER_SESSION.id,
      copiedFileCount: 1
    }))
  },
  codexAccounts: {
    list: vi.fn(async () => emptyCodexState),
    select: vi.fn(async () => ({}))
  },
  rateLimits: {
    fetchInactiveClaudeAccounts: vi.fn(async () => {}),
    fetchInactiveCodexAccounts: vi.fn(async () => {}),
    get: vi.fn(async () => rateLimitState())
  }
}

function runClaudeAutoSwitch(): ReturnType<typeof runAgentRateLimitAutoSwitch> {
  return runAgentRateLimitAutoSwitch({
    ptyId: 'pty-1',
    worktreeId: 'wt-1',
    agent: 'claude',
    providerSession: PROVIDER_SESSION,
    connectionId: null
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  store.settings = {
    autoSwitchRateLimitedAccounts: true,
    rateLimitFailoverAccountId: null,
    agentCmdOverrides: {},
    activeRuntimeEnvironmentId: null
  }
  store.rateLimits = rateLimitState()
  store.getKnownWorktreeById.mockReturnValue({ id: 'wt-1', path: '/Users/dev/demo' })
  store.createTab.mockReturnValue({ id: 'tab-new' })
  // Why: clearAllMocks keeps per-test rejected implementations; restore the happy default explicitly.
  store.updateWorktreeMeta.mockImplementation(async () => {})
  api.claudeAccounts.getLivePtyAccount.mockResolvedValue(null)
  api.claudeAccounts.copySessionForFailover.mockResolvedValue({
    ok: true,
    sessionId: PROVIDER_SESSION.id,
    copiedFileCount: 1
  })
  api.claudeAccounts.copySessionForAccountSwitch.mockResolvedValue({
    ok: true,
    sessionId: PROVIDER_SESSION.id,
    copiedFileCount: 1
  })
  api.claudeAccounts.list.mockResolvedValue(claudeState([claudeAccount({ id: 'active-1' })]))
  api.rateLimits.get.mockResolvedValue(rateLimitState())
  sendRuntimePtyInputVerified.mockResolvedValue(true)
  stopForegroundAgent.mockResolvedValue(true)
  waitForResumedAgent.mockResolvedValue(true)
  deliverLaunchPromptToAgentTab.mockResolvedValue(true)
  ;(globalThis as { window?: unknown }).window = { api } as unknown as typeof window
})

describe('runAgentRateLimitAutoSwitch — custom-endpoint session guard', () => {
  it('aborts detections for custom-endpoint-backed sessions without touching the PTY', async () => {
    api.claudeAccounts.getLivePtyAccount.mockResolvedValue({
      accountId: ENDPOINT_ACCOUNT.id,
      injected: true
    })
    api.claudeAccounts.list.mockResolvedValue(
      claudeState([claudeAccount({ id: 'active-1' }), ENDPOINT_ACCOUNT])
    )

    const result = await runClaudeAutoSwitch()

    expect(result).toMatchObject({ ok: false, reason: 'custom-endpoint-session' })
    expect(stopForegroundAgent).not.toHaveBeenCalled()
    expect(sendRuntimePtyInputVerified).not.toHaveBeenCalled()
  })

  it('proceeds when the session is backed by a subscription-oauth pin', async () => {
    api.claudeAccounts.getLivePtyAccount.mockResolvedValue({
      accountId: 'active-1',
      injected: true
    })

    const result = await runClaudeAutoSwitch()

    // Why: no inactive quota data means no candidate; the guard itself must not abort.
    expect(result).toMatchObject({ ok: false, reason: 'no-account' })
  })
})

describe('runAgentRateLimitAutoSwitch — existing switch flow', () => {
  it('switches to an Anthropic account with quota and resumes in the same PTY', async () => {
    api.claudeAccounts.list.mockResolvedValue(
      claudeState([claudeAccount({ id: 'active-1' }), claudeAccount({ id: 'spare-1' })])
    )
    api.rateLimits.get.mockResolvedValue(
      rateLimitState({
        inactiveClaudeAccounts: [
          { accountId: 'spare-1', rateLimits: usableLimits(10), updatedAt: 1, isFetching: false }
        ]
      })
    )

    const result = await runClaudeAutoSwitch()

    expect(result).toEqual({ ok: true, agent: 'claude', accountLabel: 'spare-1@example.com' })
    expect(api.claudeAccounts.select).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'spare-1' })
    )
    const sentInputs = sendRuntimePtyInputVerified.mock.calls.map((call) => call[2])
    expect(sentInputs.some((input) => String(input).includes('--resume'))).toBe(true)
    expect(sentInputs).toContain('continue\r')
    // Why: quota exhaustion handling must never leak into the happy switch path.
    expect(store.updateWorktreeMeta).not.toHaveBeenCalled()
    expect(store.createTab).not.toHaveBeenCalled()
    // Why: a non-injected (global-selection) session keeps the same-PTY resume,
    // never the pinned copy + relaunch.
    expect(api.claudeAccounts.copySessionForAccountSwitch).not.toHaveBeenCalled()
  })

  it('keeps the plain no-account outcome when no failover account is configured', async () => {
    api.claudeAccounts.list.mockResolvedValue(
      claudeState([claudeAccount({ id: 'active-1' }), ENDPOINT_ACCOUNT])
    )

    const result = await runClaudeAutoSwitch()

    expect(result).toMatchObject({ ok: false, reason: 'no-account' })
    expect(stopForegroundAgent).not.toHaveBeenCalled()
    expect(store.updateWorktreeMeta).not.toHaveBeenCalled()
    expect(api.claudeAccounts.copySessionForFailover).not.toHaveBeenCalled()
  })
})

describe('runAgentRateLimitAutoSwitch — pinned managed session routing', () => {
  beforeEach(() => {
    api.claudeAccounts.list.mockResolvedValue(
      claudeState([claudeAccount({ id: 'active-1' }), claudeAccount({ id: 'spare-1' })])
    )
    api.rateLimits.get.mockResolvedValue(
      rateLimitState({
        inactiveClaudeAccounts: [
          { accountId: 'spare-1', rateLimits: usableLimits(10), updatedAt: 1, isFetching: false }
        ]
      })
    )
  })

  it('relaunches an injected (pinned) session on the target OAuth account in a new tab', async () => {
    api.claudeAccounts.getLivePtyAccount.mockResolvedValue({
      accountId: 'active-1',
      injected: true
    })

    const result = await runClaudeAutoSwitch()

    expect(result).toEqual({
      ok: true,
      agent: 'claude',
      accountLabel: 'spare-1@example.com',
      relaunch: 'resumed'
    })
    expect(api.claudeAccounts.copySessionForAccountSwitch).toHaveBeenCalledWith({
      sessionId: PROVIDER_SESSION.id,
      cwd: '/Users/dev/demo',
      targetAccountId: 'spare-1',
      sourceAccountId: 'active-1'
    })
    expect(store.updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ claudeAccountId: 'spare-1' })
    )
    expect(store.createTab).toHaveBeenCalledWith('wt-1', undefined, undefined, {
      launchAgent: 'claude'
    })
    // Why: the pinned relaunch must stay off the gated global selection and the same-PTY resume.
    expect(api.claudeAccounts.select).not.toHaveBeenCalled()
    expect(sendRuntimePtyInputVerified).not.toHaveBeenCalled()
  })

  it('keeps the same-PTY flow for a non-injected (global-selection) session', async () => {
    api.claudeAccounts.getLivePtyAccount.mockResolvedValue({
      accountId: 'active-1',
      injected: false
    })

    const result = await runClaudeAutoSwitch()

    expect(result).toEqual({ ok: true, agent: 'claude', accountLabel: 'spare-1@example.com' })
    expect(api.claudeAccounts.select).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'spare-1' })
    )
    expect(api.claudeAccounts.copySessionForAccountSwitch).not.toHaveBeenCalled()
    expect(store.createTab).not.toHaveBeenCalled()
  })
})

describe('runAgentRateLimitAutoSwitch — last-resort failover', () => {
  beforeEach(() => {
    store.settings = { ...store.settings, rateLimitFailoverAccountId: ENDPOINT_ACCOUNT.id }
    api.claudeAccounts.list.mockResolvedValue(
      claudeState([claudeAccount({ id: 'active-1' }), ENDPOINT_ACCOUNT])
    )
  })

  it('pins the worktree, copies the session, and relaunches with resume in a new tab', async () => {
    const result = await runClaudeAutoSwitch()

    expect(result).toEqual({
      ok: true,
      agent: 'claude',
      accountLabel: 'z.ai · GLM',
      failover: 'resumed'
    })
    expect(stopForegroundAgent).toHaveBeenCalledTimes(1)
    expect(api.claudeAccounts.copySessionForFailover).toHaveBeenCalledWith({
      sessionId: PROVIDER_SESSION.id,
      cwd: '/Users/dev/demo',
      targetAccountId: ENDPOINT_ACCOUNT.id,
      sourceAccountId: null
    })
    expect(store.updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ claudeAccountId: ENDPOINT_ACCOUNT.id })
    )
    expect(store.createTab).toHaveBeenCalledWith('wt-1', undefined, undefined, {
      launchAgent: 'claude'
    })
    const startup = store.queueTabStartupCommand.mock.calls[0][1] as {
      command: string
      resumeProviderSession?: unknown
    }
    expect(startup.command).toContain('--resume')
    expect(startup.command).toContain(PROVIDER_SESSION.id)
    expect(startup.resumeProviderSession).toEqual(PROVIDER_SESSION)
    expect(store.claimAutomaticAgentResume).toHaveBeenCalledWith('tab-new', {
      worktreeId: 'wt-1',
      launchAgent: 'claude',
      providerSession: PROVIDER_SESSION
    })
    expect(deliverLaunchPromptToAgentTab).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 'tab-new', content: 'continue', submit: true })
    )
    // Why: the failover path must stay off the global selection — only the pin route.
    expect(api.claudeAccounts.select).not.toHaveBeenCalled()
  })

  it('passes the injected source account so the copy reads the right universe', async () => {
    api.claudeAccounts.getLivePtyAccount.mockResolvedValue({
      accountId: 'active-1',
      injected: true
    })

    await runClaudeAutoSwitch()

    expect(api.claudeAccounts.copySessionForFailover).toHaveBeenCalledWith(
      expect.objectContaining({ sourceAccountId: 'active-1' })
    )
  })

  it('relaunches fresh (no resume) when the transcript copy fails', async () => {
    api.claudeAccounts.copySessionForFailover.mockResolvedValue({
      ok: false,
      reason: 'source-not-found'
    })

    const result = await runClaudeAutoSwitch()

    expect(result).toEqual({
      ok: true,
      agent: 'claude',
      accountLabel: 'z.ai · GLM',
      failover: 'fresh'
    })
    expect(store.updateWorktreeMeta).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ claudeAccountId: ENDPOINT_ACCOUNT.id })
    )
    const startup = store.queueTabStartupCommand.mock.calls[0][1] as {
      command: string
      resumeProviderSession?: unknown
    }
    expect(startup.command).not.toContain('--resume')
    expect(startup.resumeProviderSession).toBeUndefined()
    expect(store.claimAutomaticAgentResume).not.toHaveBeenCalled()
    expect(deliverLaunchPromptToAgentTab).not.toHaveBeenCalled()
  })

  it('reports failover "launched" when the continue prompt cannot be delivered', async () => {
    deliverLaunchPromptToAgentTab.mockResolvedValue(false)

    const result = await runClaudeAutoSwitch()

    expect(result).toMatchObject({ ok: true, failover: 'launched' })
  })

  it('leaves the terminal untouched when the limited agent will not stop', async () => {
    stopForegroundAgent.mockResolvedValue(false)

    const result = await runClaudeAutoSwitch()

    expect(result).toMatchObject({ ok: false, reason: 'stop-failed' })
    expect(store.updateWorktreeMeta).not.toHaveBeenCalled()
    expect(store.createTab).not.toHaveBeenCalled()
  })

  it('fails without launching when the pin update is rejected', async () => {
    store.updateWorktreeMeta.mockRejectedValue(new Error('That Claude account no longer exists.'))

    const result = await runClaudeAutoSwitch()

    expect(result).toMatchObject({ ok: false, reason: 'switch-failed' })
    expect(store.createTab).not.toHaveBeenCalled()
  })

  it('ignores a stale failover id that no longer resolves to a custom-endpoint account', async () => {
    store.settings = { ...store.settings, rateLimitFailoverAccountId: 'missing-account' }

    const result = await runClaudeAutoSwitch()

    expect(result).toMatchObject({ ok: false, reason: 'no-account' })
    expect(stopForegroundAgent).not.toHaveBeenCalled()
  })
})
