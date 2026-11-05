import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimitService } from './service'
import { fetchManagedAccountUsage } from './claude-fetcher'
import { resetStoredClaudeLoginChecksForTests } from '../claude-accounts/claude-stored-login-end'

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

// Why both stores: macOS reads the keychain, Linux and Windows the vault file.
const stored = vi.hoisted(() => new Map<string, string>())
vi.mock('../claude-accounts/managed-auth-path', () => ({
  getClaudeManagedAccountsRoot: () => '/vaults',
  resolveOwnedClaudeManagedAuthPath: (_id: string, candidate: string) => candidate,
  readClaudeManagedAuthFile: (path: string) => stored.get(path) ?? null
}))
vi.mock('../claude-accounts/keychain', () => ({
  readActiveClaudeKeychainCredentialsStrict: async (path: string) => stored.get(path) ?? null,
  readManagedClaudeKeychainCredentials: async () => null
}))

const NOW = Date.UTC(2026, 10, 5, 1, 0, 0)
const ENDS = NOW + 20 * 86_400_000
const ACCOUNTS = [
  { id: 'scloud', managedAuthPath: '/vaults/scloud/auth' },
  { id: 'fab', managedAuthPath: '/vaults/fab/auth' }
]

function verdictFor(service: RateLimitService, accountId: string) {
  return service.getState().claudeAccountAuth?.find((entry) => entry.accountId === accountId)
}

describe('stored Claude logins read before a launch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stored.clear()
    resetStoredClaudeLoginChecksForTests()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  it('fails a login the CLI wiped, publishes a live one’s end, and calls no provider', async () => {
    // Placeholder shapes only, as the CLI writes them after invalid_grant; never a real token.
    stored.set(
      '/vaults/scloud/auth',
      JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } })
    )
    stored.set(
      '/vaults/fab/auth',
      JSON.stringify({
        claudeAiOauth: { refreshToken: 'placeholder', expiresAt: NOW, refreshTokenExpiresAt: ENDS }
      })
    )
    const service = new RateLimitService()
    service.setManagedClaudeAccountsResolver(() => ACCOUNTS)

    await service.reportEndedClaudeLogins()

    expect(verdictFor(service, 'scloud')).toMatchObject({
      state: 'failed',
      failure: 'credential-rejected'
    })
    expect(verdictFor(service, 'fab')).toMatchObject({ state: 'unverified', loginEndsAt: ENDS })
    expect(fetchManagedAccountUsage).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('drops the end date when the account is re-authenticated', async () => {
    stored.set(
      '/vaults/fab/auth',
      JSON.stringify({
        claudeAiOauth: { refreshToken: 'placeholder', refreshTokenExpiresAt: ENDS }
      })
    )
    const service = new RateLimitService()
    service.setManagedClaudeAccountsResolver(() => ACCOUNTS)
    await service.reportEndedClaudeLogins()

    service.clearClaudeAccountAuthVerdict('fab')

    expect(verdictFor(service, 'fab')).toBeUndefined()
    vi.useRealTimers()
  })
})
