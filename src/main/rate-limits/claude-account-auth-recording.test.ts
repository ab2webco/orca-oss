import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { RateLimitService } from './service'
import { fetchManagedAccountUsage } from './claude-fetcher'
import { OAuthUsageError } from './claude-oauth-usage-error'
import type * as livePtyGate from '../claude-accounts/live-pty-gate'
import { hasLiveClaudePtysUsingAccount } from '../claude-accounts/live-pty-gate'
import { reconcileLiveClaudePtyGate } from '../claude-accounts/live-claude-pty-gate-reconciliation'

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

vi.mock('../claude-accounts/live-claude-pty-gate-reconciliation', () => ({
  reconcileLiveClaudePtyGate: vi.fn(async () => [])
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

  it('keeps ambiguous bare missing-credential results inconclusive', async () => {
    vi.mocked(fetchManagedAccountUsage).mockResolvedValue({
      provider: 'claude',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: 'No credentials',
      status: 'error'
    })

    const service = createService()
    await service.recheckClaudeAccountAuth('acct_live')

    expect(verdictFor(service, 'acct_live')).toMatchObject({
      state: 'unverified',
      undecided: 'unknown'
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

  // ORCA-224: a gate entry left behind by a session that already died deferred
  // rotation forever, so an account whose token expired meanwhile could never be
  // refreshed. The gate's claim is re-checked against the daemon before it is
  // believed — and only that re-check may lift it.
  it('rotates after a claim proves to belong to a session that already died', async () => {
    vi.mocked(hasLiveClaudePtysUsingAccount).mockReturnValueOnce(true).mockReturnValue(false)
    vi.mocked(fetchManagedAccountUsage).mockResolvedValue(okUsage(30))

    const service = createService()
    await service.recheckClaudeAccountAuth('acct_dead')

    expect(reconcileLiveClaudePtyGate).toHaveBeenCalled()
    expect(vi.mocked(fetchManagedAccountUsage).mock.calls[0]?.[1]).toMatchObject({
      allowTokenRotation: true
    })
  })

  it('keeps deferring when the claim survives the daemon re-check', async () => {
    vi.mocked(hasLiveClaudePtysUsingAccount).mockReturnValue(true)
    vi.mocked(fetchManagedAccountUsage).mockResolvedValue(okUsage(30))

    const service = createService()
    await service.recheckClaudeAccountAuth('acct_live')

    expect(reconcileLiveClaudePtyGate).toHaveBeenCalled()
    expect(vi.mocked(fetchManagedAccountUsage).mock.calls[0]?.[1]).toMatchObject({
      allowTokenRotation: false
    })
  })

  it('does not probe the daemon when no claim is blocking the account', async () => {
    vi.mocked(fetchManagedAccountUsage).mockResolvedValue(okUsage(30))

    const service = createService()
    await service.recheckClaudeAccountAuth('acct_live')

    expect(reconcileLiveClaudePtyGate).not.toHaveBeenCalled()
  })

  it('re-checks a stale claim on the background inactive-account sweep too', async () => {
    vi.mocked(hasLiveClaudePtysUsingAccount).mockReturnValueOnce(true).mockReturnValue(false)
    vi.mocked(fetchManagedAccountUsage).mockResolvedValue(okUsage(30))

    const service = createService()
    await service.fetchInactiveClaudeAccountsOnOpen()

    expect(reconcileLiveClaudePtyGate).toHaveBeenCalled()
    expect(vi.mocked(fetchManagedAccountUsage).mock.calls[0]?.[1]).toMatchObject({
      allowTokenRotation: true
    })
  })

  it('publishes checking state for an account with no prior verdict', async () => {
    let resolveUsage!: (value: ProviderRateLimits) => void
    vi.mocked(fetchManagedAccountUsage).mockReturnValue(
      new Promise((resolve) => {
        resolveUsage = resolve
      })
    )
    const service = createService()

    const checking = service.recheckClaudeAccountAuth('acct_live')

    expect(verdictFor(service, 'acct_live')).toMatchObject({ state: 'unverified', checking: true })
    resolveUsage(okUsage(30))
    await checking
  })

  it('does not let an older provider result overwrite a live credential rejection', async () => {
    let resolveUsage!: (value: ProviderRateLimits) => void
    vi.mocked(fetchManagedAccountUsage).mockReturnValue(
      new Promise((resolve) => {
        resolveUsage = resolve
      })
    )
    const service = createService()

    const checking = service.recheckClaudeAccountAuth('acct_live')
    service.recordClaudeCredentialRejection('acct_live')
    resolveUsage(okUsage(30))
    await checking

    expect(verdictFor(service, 'acct_live')).toMatchObject({
      state: 'failed',
      failure: 'credential-rejected'
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

  it('records and publishes a hot credential rejection for a managed account', () => {
    const service = createService()
    const listener = vi.fn()
    service.onStateChange(listener)

    service.recordClaudeCredentialRejection('acct_live')

    expect(verdictFor(service, 'acct_live')).toMatchObject({
      state: 'failed',
      failure: 'credential-rejected'
    })
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        claudeAccountAuth: [
          expect.objectContaining({
            accountId: 'acct_live',
            state: 'failed',
            failure: 'credential-rejected'
          })
        ]
      })
    )
  })

  it('retires a failure once the account is re-authenticated', () => {
    const service = createService()
    service.recordClaudeCredentialRejection('acct_live')

    service.clearClaudeAccountAuthVerdict('acct_live')

    expect(verdictFor(service, 'acct_live')).toBeUndefined()
  })

  it('does not let a fetch started before the re-authentication restore the old failure', async () => {
    let resolveUsage!: (value: ProviderRateLimits) => void
    vi.mocked(fetchManagedAccountUsage).mockReturnValue(
      new Promise((resolve) => {
        resolveUsage = resolve
      })
    )
    const service = createService()

    const checking = service.recheckClaudeAccountAuth('acct_live')
    service.recordClaudeCredentialRejection('acct_live')
    service.clearClaudeAccountAuthVerdict('acct_live')
    resolveUsage(okUsage(30))
    await checking

    // Neither the retired failure nor a pass the pre-reauth fetch cannot prove.
    expect(verdictFor(service, 'acct_live')).toMatchObject({
      state: 'unverified',
      failure: null,
      checkedAt: null
    })
  })

  it('does not invent a verdict for an unresolved or removed account', () => {
    const service = createService()
    const listener = vi.fn()
    service.onStateChange(listener)

    service.recordClaudeCredentialRejection('acct_remote')

    expect(service.getState().claudeAccountAuth).toEqual([])
    expect(listener).not.toHaveBeenCalled()
  })
})
