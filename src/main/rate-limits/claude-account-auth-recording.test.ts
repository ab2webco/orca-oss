import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { RateLimitService } from './service'
import { fetchManagedAccountUsage } from './claude-fetcher'
import { OAuthUsageError } from './claude-oauth-usage-error'
import type * as livePtyGate from '../claude-accounts/live-pty-gate'
import { hasLiveClaudePtysUsingAccount } from '../claude-accounts/live-pty-gate'

type LivePtyGateModule = typeof livePtyGate

vi.mock('./claude-fetcher', () => ({
  fetchClaudeRateLimits: vi.fn(),
  fetchManagedAccountUsage: vi.fn(),
  CLAUDE_USAGE_THROTTLED_ERROR: 'Rate limited by the token endpoint'
}))

vi.mock('./codex-fetcher', () => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  fetchCodexRateLimits: vi.fn()
}))

vi.mock('./gemini-usage-fetcher', () => ({ fetchGeminiRateLimits: vi.fn() }))
vi.mock('./kimi-fetcher', () => ({ fetchKimiRateLimits: vi.fn() }))
vi.mock('./opencode-go-usage-fetcher', () => ({ fetchOpenCodeGoRateLimits: vi.fn() }))
vi.mock('./minimax-fetcher', () => ({ fetchMiniMaxRateLimits: vi.fn() }))
vi.mock('./grok-fetcher', () => ({ fetchGrokRateLimits: vi.fn() }))
vi.mock('./grok-auth', () => ({ readGrokAuthSession: vi.fn(() => ({ status: 'missing' })) }))
vi.mock('../minimax/minimax-cookie-store', () => ({ hasMiniMaxSessionCookie: vi.fn(() => false) }))

vi.mock('../claude-accounts/live-pty-gate', async (importOriginal) => ({
  ...(await importOriginal<LivePtyGateModule>()),
  hasLiveClaudePtysUsingAccount: vi.fn(() => false)
}))

const ACCOUNTS = [
  { id: 'acct_live', managedAuthPath: '/vaults/acct_live' },
  { id: 'acct_dead', managedAuthPath: '/vaults/acct_dead' }
]

function okUsage(usedPercent: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: Date.now(),
    error: null,
    status: 'ok'
  }
}

function createService(): RateLimitService {
  const service = new RateLimitService()
  service.setInactiveClaudeAccountsResolver(() => ACCOUNTS)
  service.setManagedClaudeAccountsResolver(() => ACCOUNTS)
  return service
}

function verdictFor(service: RateLimitService, accountId: string) {
  return service.getState().claudeAccountAuth?.find((entry) => entry.accountId === accountId)
}

describe('managed Claude account auth verdicts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasLiveClaudePtysUsingAccount).mockReturnValue(false)
  })

  it('records a rejected credential from a per-account fetch that throws', async () => {
    vi.mocked(fetchManagedAccountUsage).mockImplementation(async (account) => {
      if (account.id === 'acct_dead') {
        throw new OAuthUsageError('OAuth API returned 401', 401, true)
      }
      return okUsage(12)
    })

    const service = createService()
    await service.fetchInactiveClaudeAccountsOnOpen()

    expect(verdictFor(service, 'acct_dead')).toMatchObject({
      state: 'failed',
      failure: 'credential-rejected'
    })
    expect(verdictFor(service, 'acct_live')).toMatchObject({ state: 'authenticated' })
  })

  it('leaves an account undecided when a live session holds its token', async () => {
    vi.mocked(fetchManagedAccountUsage).mockResolvedValue({
      provider: 'claude',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: 'Waiting for the live session',
      status: 'error',
      usageMetadata: { failureKind: 'deferred-by-live-session' }
    })

    const service = createService()
    await service.fetchInactiveClaudeAccountsOnOpen()

    expect(verdictFor(service, 'acct_live')).toMatchObject({
      state: 'unverified',
      undecided: 'live-session-holds-token'
    })
  })

  it('never rotates a token a live pinned session owns when the user checks on demand', async () => {
    vi.mocked(hasLiveClaudePtysUsingAccount).mockReturnValue(true)
    vi.mocked(fetchManagedAccountUsage).mockResolvedValue(okUsage(30))

    const service = createService()
    await service.recheckClaudeAccountAuth('acct_live')

    expect(vi.mocked(fetchManagedAccountUsage).mock.calls[0]?.[1]).toMatchObject({
      allowTokenRotation: false
    })
    expect(verdictFor(service, 'acct_live')).toMatchObject({ state: 'authenticated' })
  })

  it('allows rotation on demand only when no live session owns the account', async () => {
    vi.mocked(fetchManagedAccountUsage).mockResolvedValue(okUsage(30))

    const service = createService()
    await service.recheckClaudeAccountAuth('acct_live')

    expect(vi.mocked(fetchManagedAccountUsage).mock.calls[0]?.[1]).toMatchObject({
      allowTokenRotation: true
    })
  })

  it('does not verify anything on its own when nothing has fetched yet', () => {
    const service = createService()

    expect(service.getState().claudeAccountAuth).toEqual([])
    expect(fetchManagedAccountUsage).not.toHaveBeenCalled()
  })

  it('drops verdicts for accounts that no longer exist', async () => {
    vi.mocked(fetchManagedAccountUsage).mockResolvedValue(okUsage(30))
    const service = createService()
    await service.recheckClaudeAccountAuth('acct_live')
    expect(verdictFor(service, 'acct_live')).toBeDefined()

    service.setManagedClaudeAccountsResolver(() => [ACCOUNTS[1]])

    expect(verdictFor(service, 'acct_live')).toBeUndefined()
  })
})
