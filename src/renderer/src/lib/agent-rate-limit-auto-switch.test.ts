import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits, RateLimitState } from '../../../shared/rate-limit-types'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../shared/types'
import { assessSourceAccountQuota, selectAutoSwitchAccount } from './agent-rate-limit-auto-switch'

function limits(provider: 'claude' | 'codex', usedPercent: number): ProviderRateLimits {
  return {
    provider,
    session: {
      usedPercent,
      windowMinutes: 300,
      resetsAt: null,
      resetDescription: null
    },
    weekly: null,
    updatedAt: 1,
    error: null,
    status: 'ok'
  }
}

function unavailableLimits(provider: 'claude' | 'codex'): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    updatedAt: 1,
    error: 'sign in',
    status: 'error'
  }
}

const emptyClaude: ClaudeRateLimitAccountsState = {
  accounts: [],
  activeAccountId: null,
  activeAccountIdsByRuntime: { host: null, wsl: {} }
}

const emptyCodex: CodexRateLimitAccountsState = {
  accounts: [],
  activeAccountId: null,
  activeAccountIdsByRuntime: { host: null, wsl: {} }
}

function rateLimitState(overrides: Partial<RateLimitState>): RateLimitState {
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

describe('selectAutoSwitchAccount', () => {
  it('selects the lowest-usage inactive Codex account for the same runtime', () => {
    const result = selectAutoSwitchAccount({
      agent: 'codex',
      target: { runtime: 'host', wslDistro: null },
      accounts: {
        claude: emptyClaude,
        codex: {
          accounts: [
            {
              id: 'active',
              email: 'active@example.com',
              managedHomeRuntime: 'host',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            },
            {
              id: 'busy',
              email: 'busy@example.com',
              managedHomeRuntime: 'host',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            },
            {
              id: 'free',
              email: 'free@example.com',
              managedHomeRuntime: 'host',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            }
          ],
          activeAccountId: 'active',
          activeAccountIdsByRuntime: { host: 'active', wsl: {} }
        },
        rateLimits: rateLimitState({
          inactiveCodexAccounts: [
            { accountId: 'busy', rateLimits: limits('codex', 95), updatedAt: 1, isFetching: false },
            { accountId: 'free', rateLimits: limits('codex', 12), updatedAt: 1, isFetching: false }
          ]
        })
      }
    })

    expect(result).toMatchObject({
      accountId: 'free',
      label: 'free@example.com',
      usedPercent: 12
    })
  })

  it('skips unavailable and exhausted Claude accounts', () => {
    const result = selectAutoSwitchAccount({
      agent: 'claude',
      target: { runtime: 'host', wslDistro: null },
      accounts: {
        claude: {
          accounts: [
            {
              id: 'active',
              email: 'active@example.com',
              managedAuthRuntime: 'host',
              authMethod: 'subscription-oauth',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            },
            {
              id: 'bad',
              email: 'bad@example.com',
              managedAuthRuntime: 'host',
              authMethod: 'subscription-oauth',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            },
            {
              id: 'full',
              email: 'full@example.com',
              managedAuthRuntime: 'host',
              authMethod: 'subscription-oauth',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            }
          ],
          activeAccountId: 'active',
          activeAccountIdsByRuntime: { host: 'active', wsl: {} }
        },
        codex: emptyCodex,
        rateLimits: rateLimitState({
          inactiveClaudeAccounts: [
            {
              accountId: 'bad',
              rateLimits: unavailableLimits('claude'),
              updatedAt: 1,
              isFetching: false
            },
            {
              accountId: 'full',
              rateLimits: limits('claude', 100),
              updatedAt: 1,
              isFetching: false
            }
          ]
        })
      }
    })

    expect(result).toBeNull()
  })

  it('never selects a custom-endpoint Claude account, even with usable usage data', () => {
    const result = selectAutoSwitchAccount({
      agent: 'claude',
      target: { runtime: 'host', wslDistro: null },
      accounts: {
        claude: {
          accounts: [
            {
              id: 'active',
              email: 'active@example.com',
              managedAuthRuntime: 'host',
              authMethod: 'subscription-oauth',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            },
            {
              id: 'endpoint',
              email: 'z.ai · GLM',
              managedAuthRuntime: 'host',
              authMethod: 'custom-endpoint',
              endpointLabel: 'z.ai · GLM',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            }
          ],
          activeAccountId: 'active',
          activeAccountIdsByRuntime: { host: 'active', wsl: {} }
        },
        codex: emptyCodex,
        rateLimits: rateLimitState({
          // Why: even if a usage entry leaks in for the endpoint account, it must stay ineligible.
          inactiveClaudeAccounts: [
            {
              accountId: 'endpoint',
              rateLimits: limits('claude', 5),
              updatedAt: 1,
              isFetching: false
            }
          ]
        })
      }
    })

    expect(result).toBeNull()
  })

  it('keeps WSL account selection scoped to the same distro', () => {
    const result = selectAutoSwitchAccount({
      agent: 'codex',
      target: { runtime: 'wsl', wslDistro: 'Ubuntu' },
      accounts: {
        claude: emptyClaude,
        codex: {
          accounts: [
            {
              id: 'active',
              email: 'active@example.com',
              managedHomeRuntime: 'wsl',
              wslDistro: 'Ubuntu',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            },
            {
              id: 'debian',
              email: 'debian@example.com',
              managedHomeRuntime: 'wsl',
              wslDistro: 'Debian',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            },
            {
              id: 'ubuntu',
              email: 'ubuntu@example.com',
              managedHomeRuntime: 'wsl',
              wslDistro: 'Ubuntu',
              createdAt: 1,
              updatedAt: 1,
              lastAuthenticatedAt: 1
            }
          ],
          activeAccountId: null,
          activeAccountIdsByRuntime: { host: null, wsl: { Ubuntu: 'active' } }
        },
        rateLimits: rateLimitState({
          inactiveCodexAccounts: [
            {
              accountId: 'debian',
              rateLimits: limits('codex', 1),
              updatedAt: 1,
              isFetching: false
            },
            {
              accountId: 'ubuntu',
              rateLimits: limits('codex', 20),
              updatedAt: 1,
              isFetching: false
            }
          ]
        })
      }
    })

    expect(result?.accountId).toBe('ubuntu')
  })
})

describe('assessSourceAccountQuota', () => {
  it('rejects retained inactive usage that predates the completed refresh', () => {
    const staleLimits = { ...limits('claude', 4), updatedAt: 10 }
    const result = assessSourceAccountQuota({
      agent: 'claude',
      target: { runtime: 'host', wslDistro: null },
      sourceAccountId: 'source',
      verifiedAfter: 20,
      accounts: {
        claude: {
          accounts: [claudeAccount('active'), claudeAccount('source')],
          activeAccountId: 'active',
          activeAccountIdsByRuntime: { host: 'active', wsl: {} }
        },
        codex: emptyCodex,
        rateLimits: rateLimitState({
          inactiveClaudeAccounts: [
            {
              accountId: 'source',
              rateLimits: staleLimits,
              updatedAt: 10,
              isFetching: false
            }
          ]
        })
      }
    })

    expect(result).toBe('unknown')
  })
})

function claudeAccount(id: string): ClaudeRateLimitAccountsState['accounts'][number] {
  return {
    id,
    email: `${id}@example.com`,
    managedAuthRuntime: 'host',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  } as unknown as ClaudeRateLimitAccountsState['accounts'][number]
}

/** Quota is known but the read itself failed — the shape applyStalePolicy retains. */
function retainedLimits(usedPercent: number, failureKind?: string): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 1,
    error: 'read failed',
    status: 'error',
    ...(failureKind ? { usageMetadata: { failureKind } } : {})
  } as unknown as ProviderRateLimits
}

function selectClaude(
  accountIds: readonly string[],
  inactiveClaudeAccounts: RateLimitState['inactiveClaudeAccounts']
): ReturnType<typeof selectAutoSwitchAccount> {
  return selectAutoSwitchAccount({
    agent: 'claude',
    target: { runtime: 'host', wslDistro: null },
    accounts: {
      claude: {
        accounts: accountIds.map(claudeAccount),
        activeAccountId: 'active',
        activeAccountIdsByRuntime: { host: 'active', wsl: {} }
      },
      codex: emptyCodex,
      rateLimits: rateLimitState({ inactiveClaudeAccounts })
    }
  })
}

describe('selectAutoSwitchAccount — accounts whose usage read failed', () => {
  it('still switches to a healthy account whose usage read was deferred', () => {
    // Why: a live CLI owning the account defers its read (lab.17/18). Excluding it
    // sent the switch straight to the quota-less endpoint — the reported bug.
    const result = selectClaude(
      ['active', 'spare'],
      [
        {
          accountId: 'spare',
          rateLimits: retainedLimits(12, 'deferred-by-live-session'),
          updatedAt: 1,
          isFetching: false
        }
      ]
    )

    expect(result?.accountId).toBe('spare')
  })

  it('chooses the largest real margin before using freshness as a tie-breaker', () => {
    const result = selectClaude(
      ['active', 'retained', 'verified'],
      [
        {
          accountId: 'retained',
          rateLimits: retainedLimits(5),
          updatedAt: 1,
          isFetching: false
        },
        {
          accountId: 'verified',
          rateLimits: limits('claude', 40),
          updatedAt: 1,
          isFetching: false
        }
      ]
    )

    expect(result?.accountId).toBe('retained')
  })

  it('excludes the PTY owner even when the globally active account is different', () => {
    const result = selectAutoSwitchAccount({
      agent: 'claude',
      target: { runtime: 'host', wslDistro: null },
      sourceAccountId: 'pane-owner',
      accounts: {
        claude: {
          accounts: ['global-active', 'pane-owner', 'spare'].map(claudeAccount),
          activeAccountId: 'global-active',
          activeAccountIdsByRuntime: { host: 'global-active', wsl: {} }
        },
        codex: emptyCodex,
        rateLimits: rateLimitState({
          claude: limits('claude', 10),
          inactiveClaudeAccounts: [
            {
              accountId: 'pane-owner',
              rateLimits: limits('claude', 1),
              updatedAt: 1,
              isFetching: false
            },
            {
              accountId: 'spare',
              rateLimits: limits('claude', 20),
              updatedAt: 1,
              isFetching: false
            }
          ]
        })
      }
    })

    expect(result?.accountId).toBe('global-active')
  })

  it('never switches to an account with no credentials', () => {
    const result = selectClaude(
      ['active', 'signed-out'],
      [
        {
          accountId: 'signed-out',
          rateLimits: retainedLimits(0, 'missing-credentials'),
          updatedAt: 1,
          isFetching: false
        }
      ]
    )

    expect(result).toBeNull()
  })

  it('never switches to an exhausted account even when its read failed', () => {
    const result = selectClaude(
      ['active', 'exhausted'],
      [
        {
          accountId: 'exhausted',
          rateLimits: retainedLimits(100),
          updatedAt: 1,
          isFetching: false
        }
      ]
    )

    expect(result).toBeNull()
  })

  it('ignores an account still being fetched', () => {
    const result = selectClaude(
      ['active', 'loading'],
      [
        {
          accountId: 'loading',
          rateLimits: { ...retainedLimits(10), status: 'fetching' } as ProviderRateLimits,
          updatedAt: 1,
          isFetching: true
        }
      ]
    )

    expect(result).toBeNull()
  })
})
