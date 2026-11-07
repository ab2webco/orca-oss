import { describe, expect, it, vi } from 'vitest'
import { resolveHostMemberAccount } from './orchestration-federation-member-account'

const snapshotWith = (auth: unknown[]) => ({
  claude: {
    accounts: [
      { id: 'acct_scloud', email: 'scloud@example.com', authMethod: 'subscription-oauth' }
    ],
    activeAccountId: null
  },
  codex: { accounts: [], activeAccountId: null },
  rateLimits: {
    claude: null,
    codex: null,
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: [],
    claudeAccountAuth: auth
  }
})

describe('a paired host resolving a member account reads its stored logins first', () => {
  it('refuses a named account whose stored login the CLI already ended', async () => {
    let auth: unknown[] = []
    const runtime = {
      reportEndedClaudeLogins: vi.fn(async () => {
        // The host's offline read finds the wiped login and fails its verdict.
        auth = [{ accountId: 'acct_scloud', state: 'failed', failure: 'credential-rejected' }]
      }),
      getAccountsSnapshot: vi.fn(() => snapshotWith(auth)),
      refreshAccountsForMobile: vi.fn(async () => {}),
      gameAgentsOnAccounts: vi.fn(() => [])
    }

    await expect(
      resolveHostMemberAccount({
        runtime: runtime as never,
        agent: 'claude',
        selector: 'scloud@example.com',
        reusesTerminal: false
      })
    ).rejects.toThrow(/scloud@example\.com's sign-in failed on this host/)
    expect(runtime.reportEndedClaudeLogins).toHaveBeenCalledOnce()
  })

  it('launches on an ended login when the host holds a long-lived token for it (ORCA-1039)', async () => {
    const snapshot = snapshotWith([
      { accountId: 'acct_scloud', state: 'failed', failure: 'credential-rejected' }
    ])
    const accounts: Record<string, unknown>[] = snapshot.claude.accounts
    accounts[0] = { ...accounts[0], longLivedTokenSetAt: 1 }
    const runtime = {
      reportEndedClaudeLogins: vi.fn(async () => {}),
      getAccountsSnapshot: vi.fn(() => snapshot),
      refreshAccountsForMobile: vi.fn(async () => {}),
      gameAgentsOnAccounts: vi.fn(() => [])
    }

    await expect(
      resolveHostMemberAccount({
        runtime: runtime as never,
        agent: 'claude',
        selector: 'scloud@example.com',
        reusesTerminal: false
      })
    ).resolves.toMatchObject({ pin: { claudeAccountId: 'acct_scloud' } })
  })
})
