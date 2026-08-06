import { beforeEach, describe, expect, it, vi } from 'vitest'

const readManagedClaudeRefreshCredentials = vi.fn<(accountId: string) => Promise<string | null>>()
const setClaimFingerprint = vi.fn()
const registerClaim = vi.fn()
const releaseClaim = vi.fn()
let renewalObserver: (() => void) | null = null

vi.mock('./claude-managed-refresh-chain', () => ({
  readManagedClaudeRefreshCredentials: (accountId: string) =>
    readManagedClaudeRefreshCredentials(accountId)
}))

vi.mock('./claude-refresh-chain-lease', () => ({
  claudeRefreshChainLeaseStore: {
    registerClaim: (...args: unknown[]) => registerClaim(...args),
    releaseClaim: (...args: unknown[]) => releaseClaim(...args),
    setClaimFingerprint: (...args: unknown[]) => setClaimFingerprint(...args),
    setRenewalObserver: (observer: (() => void) | null) => {
      renewalObserver = observer
    }
  }
}))

function credentialsFor(refreshToken: string): string {
  return JSON.stringify({ claudeAiOauth: { refreshToken, accessToken: 'at' } })
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('live Claude refresh-chain claims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    renewalObserver = null
  })

  it('re-resolves the claimed chain on renewal when the live CLI rotated its token', async () => {
    // Why this is the whole point: a live Claude CLI rotates its own refresh token as it works, so
    // a fingerprint captured once at registration stops matching within minutes. Background
    // rotation then finds no claim for the CURRENT chain and rotates it, stranding the very
    // session the claim existed to protect — which is exactly how a user got logged out.
    readManagedClaudeRefreshCredentials.mockResolvedValueOnce(credentialsFor('chain-one'))
    const { reserveLiveClaudeRefreshChain } = await import('./live-claude-refresh-chain-claims')

    reserveLiveClaudeRefreshChain('gate-1', 'account-1')
    await settle()
    const first = setClaimFingerprint.mock.calls.at(-1)?.[1]
    expect(first).toBeTruthy()

    readManagedClaudeRefreshCredentials.mockResolvedValueOnce(credentialsFor('chain-two'))
    expect(renewalObserver).toBeTypeOf('function')
    renewalObserver?.()
    await settle()

    const second = setClaimFingerprint.mock.calls.at(-1)?.[1]
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
  })

  it('keeps the previously claimed chain when the credential read fails', async () => {
    // Why keep it rather than clear it: dropping the fingerprint would leave the claim matching
    // nothing, which silently unprotects a session that is still very much alive. A stale claim
    // is useless; an absent one is dangerous.
    readManagedClaudeRefreshCredentials.mockResolvedValueOnce(credentialsFor('chain-one'))
    const { reserveLiveClaudeRefreshChain } = await import('./live-claude-refresh-chain-claims')

    reserveLiveClaudeRefreshChain('gate-1', 'account-1')
    await settle()
    const callsAfterRegistration = setClaimFingerprint.mock.calls.length

    readManagedClaudeRefreshCredentials.mockRejectedValueOnce(new Error('keychain unavailable'))
    renewalObserver?.()
    await settle()

    expect(setClaimFingerprint.mock.calls.length).toBe(callsAfterRegistration)
  })

  it('stops re-resolving a released claim', async () => {
    readManagedClaudeRefreshCredentials.mockResolvedValueOnce(credentialsFor('chain-one'))
    const { reserveLiveClaudeRefreshChain, releaseLiveClaudeRefreshChain } =
      await import('./live-claude-refresh-chain-claims')

    reserveLiveClaudeRefreshChain('gate-1', 'account-1')
    await settle()
    releaseLiveClaudeRefreshChain('gate-1')
    readManagedClaudeRefreshCredentials.mockClear()

    renewalObserver?.()
    await settle()

    expect(readManagedClaudeRefreshCredentials).not.toHaveBeenCalled()
  })
})
