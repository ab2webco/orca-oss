import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { RateLimitService } from './service'
import { fetchManagedAccountUsage } from './claude-fetcher'
import { checkManagedClaudeLongLivedToken } from './claude-long-lived-token-check'
import type * as livePtyGate from '../claude-accounts/live-pty-gate'
import { hasLiveClaudePtysUsingAccount } from '../claude-accounts/live-pty-gate'

type LivePtyGateModule = typeof livePtyGate

vi.mock('./claude-fetcher', () => ({
  fetchClaudeRateLimits: vi.fn(),
  fetchManagedAccountUsage: vi.fn(),
  CLAUDE_USAGE_THROTTLED_ERROR: 'Rate limited by the token endpoint'
}))

vi.mock('./claude-long-lived-token-check', () => ({
  checkManagedClaudeLongLivedToken: vi.fn()
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

vi.mock('../claude-accounts/live-claude-pty-gate-reconciliation', () => ({
  reconcileLiveClaudePtyGate: vi.fn(async () => [])
}))

const ACCOUNTS = [{ id: 'acct_token', managedAuthPath: '/vaults/acct_token' }]
const CHECKED_AT = 1_762_800_000_000

function okUsage(): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent: 36, windowMinutes: 300, resetsAt: null, resetDescription: null },
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

function verdictFor(service: RateLimitService) {
  return service.getState().claudeAccountAuth?.find((entry) => entry.accountId === 'acct_token')
}

describe('long-lived token check on demand (ORCA-1160)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasLiveClaudePtysUsingAccount).mockReturnValue(false)
    vi.mocked(fetchManagedAccountUsage).mockResolvedValue(okUsage())
  })

  it('publishes the token check beside the stored login verdict', async () => {
    vi.mocked(checkManagedClaudeLongLivedToken).mockResolvedValue({
      state: 'verified',
      checkedAt: CHECKED_AT
    })

    const service = createService()
    await service.recheckClaudeAccountAuth('acct_token')

    expect(verdictFor(service)).toMatchObject({
      state: 'authenticated',
      token: { state: 'verified', checkedAt: CHECKED_AT }
    })
  })

  it('keeps a rejected token apart from a stored login that still works', async () => {
    vi.mocked(checkManagedClaudeLongLivedToken).mockResolvedValue({
      state: 'rejected',
      checkedAt: CHECKED_AT
    })

    const service = createService()
    await service.recheckClaudeAccountAuth('acct_token')

    expect(verdictFor(service)).toMatchObject({
      state: 'authenticated',
      token: { state: 'rejected' }
    })
  })

  it('adds no token field for an account without a token', async () => {
    vi.mocked(checkManagedClaudeLongLivedToken).mockResolvedValue(null)

    const service = createService()
    await service.recheckClaudeAccountAuth('acct_token')

    expect(verdictFor(service)).not.toHaveProperty('token')
  })

  it('never checks the token on a usage refresh, only when asked', async () => {
    const service = createService()
    await service.fetchInactiveClaudeAccountsOnOpen()

    expect(checkManagedClaudeLongLivedToken).not.toHaveBeenCalled()
  })
})
