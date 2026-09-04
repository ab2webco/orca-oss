import { describe, expect, it } from 'vitest'

import { decodeAccountsSnapshot, invalidAccountsSnapshotDetail } from './accounts-snapshot'

function makeSnapshot(): unknown {
  return {
    extensionField: { retained: true },
    claude: {
      accounts: [],
      activeAccountId: null,
      activeAccountIdsByRuntime: { host: null, wsl: {} }
    },
    codex: {
      accounts: [
        {
          id: 'codex-host',
          email: 'host@example.com',
          managedHomeRuntime: 'host',
          wslDistro: null,
          updatedAt: 100,
          extensionField: 'account-extra'
        }
      ],
      activeAccountId: 'codex-host',
      activeAccountIdsByRuntime: {
        host: 'codex-host',
        wsl: { Ubuntu: 'codex-wsl' }
      }
    },
    rateLimits: {
      extensionField: 'limits-extra',
      claude: null,
      codex: {
        provider: 'codex',
        session: {
          usedPercent: 100,
          windowMinutes: 300,
          resetsAt: 200,
          resetDescription: 'soon'
        },
        weekly: null,
        rateLimitResetCredits: {
          availableCount: 1,
          totalEarnedCount: 2,
          nextExpiresAt: 300,
          credits: [{ status: 'available', expiresAt: 300, grantedAt: 50 }]
        },
        updatedAt: 100,
        error: null,
        status: 'ok',
        extensionField: 'provider-extra'
      },
      claudeTarget: { runtime: 'host', wslDistro: null },
      codexTarget: { runtime: 'host', wslDistro: null },
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: [
        {
          accountId: 'codex-inactive',
          rateLimits: null,
          updatedAt: 99,
          isFetching: false
        }
      ]
    }
  }
}

function setPath(root: unknown, path: string[], value: unknown): void {
  let current: unknown = root
  for (const segment of path.slice(0, -1)) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      throw new Error(`Invalid fixture path: ${path.join('.')}`)
    }
    current = (current as Record<string, unknown>)[segment]
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`Invalid fixture path: ${path.join('.')}`)
  }
  const record = current as Record<string, unknown>
  record[path.at(-1)!] = value
}

describe('decodeAccountsSnapshot', () => {
  it('validates nested account/rate-limit state and preserves forward-compatible fields', () => {
    const snapshot = decodeAccountsSnapshot(makeSnapshot())

    expect(snapshot.extensionField).toEqual({ retained: true })
    expect(snapshot.codex.accounts[0]?.extensionField).toBe('account-extra')
    expect(snapshot.rateLimits.extensionField).toBe('limits-extra')
    expect(snapshot.rateLimits.codex?.extensionField).toBe('provider-extra')
  })

  it('defaults missing runtime targets for older host-only snapshots', () => {
    const raw = makeSnapshot() as {
      rateLimits: { claudeTarget?: unknown; codexTarget?: unknown }
    }
    delete raw.rateLimits.claudeTarget
    delete raw.rateLimits.codexTarget

    const snapshot = decodeAccountsSnapshot(raw)

    expect(snapshot.rateLimits.claudeTarget).toEqual({ runtime: 'host', wslDistro: null })
    expect(snapshot.rateLimits.codexTarget).toEqual({ runtime: 'host', wslDistro: null })
  })

  it.each([
    ['account arrays', ['codex', 'accounts'], {}],
    ['active account IDs', ['codex', 'activeAccountId'], 42],
    ['runtime selections', ['codex', 'activeAccountIdsByRuntime', 'wsl'], []],
    ['targets', ['rateLimits', 'codexTarget', 'runtime'], 'remote'],
    ['provider identity', ['rateLimits', 'codex', 'provider'], 'claude'],
    ['inactive account arrays', ['rateLimits', 'inactiveCodexAccounts'], {}],
    ['window percentages', ['rateLimits', 'codex', 'session', 'usedPercent'], 101],
    ['credit counts', ['rateLimits', 'codex', 'rateLimitResetCredits', 'availableCount'], -1],
    [
      'credit status',
      ['rateLimits', 'codex', 'rateLimitResetCredits', 'credits'],
      [{ status: '', expiresAt: 300, grantedAt: 50 }]
    ],
    ['credit expiry', ['rateLimits', 'codex', 'rateLimitResetCredits', 'nextExpiresAt'], 'soon']
  ] satisfies Array<[string, string[], unknown]>)('rejects malformed %s', (_name, path, value) => {
    const snapshot = makeSnapshot()
    setPath(snapshot, path, value)

    expect(() => decodeAccountsSnapshot(snapshot)).toThrow('Invalid accounts snapshot from host')
  })

  it('identifies its own rejection by identity, not by message text', () => {
    const snapshot = makeSnapshot()
    setPath(snapshot, ['rateLimits', 'codexTarget', 'runtime'], 'kubernetes')

    let thrown: unknown
    try {
      decodeAccountsSnapshot(snapshot)
    } catch (error) {
      thrown = error
    }
    expect(invalidAccountsSnapshotDetail(thrown)).toContain('codexTarget.runtime')

    // Why: tying the check to the text is what broke — the message grew a suffix
    // in ORCA-348 and an equality test against the old string went dead.
    expect(invalidAccountsSnapshotDetail(new Error('Invalid accounts snapshot from host'))).toBe(
      null
    )
    expect(invalidAccountsSnapshotDetail('Invalid accounts snapshot from host')).toBe(null)
  })

  it('rejects a host target that smuggles a WSL distro', () => {
    const snapshot = makeSnapshot()
    setPath(snapshot, ['rateLimits', 'codexTarget', 'wslDistro'], 'Ubuntu')

    expect(() => decodeAccountsSnapshot(snapshot)).toThrow('Invalid accounts snapshot from host')
  })

  function withClaudeAccount(authMethod: unknown, email = 'a@example.com'): unknown {
    const raw = makeSnapshot() as {
      claude: { accounts: Record<string, unknown>[] }
    }
    raw.claude.accounts.push({ id: 'claude-a', email, authMethod })
    return raw
  }

  it('accepts a custom-endpoint account, which the host union has and this schema did not', () => {
    const snapshot = decodeAccountsSnapshot(withClaudeAccount('custom-endpoint'))
    expect(snapshot.claude.accounts[0]?.authMethod).toBe('custom-endpoint')
  })

  it('degrades an unrecognised authMethod instead of dropping every account', () => {
    // Why: one custom-endpoint account rejected the whole array and took the other five
    // with it. A client must never require an enum value it does not know.
    const snapshot = decodeAccountsSnapshot(withClaudeAccount('device-code-from-a-later-release'))
    expect(snapshot.claude.accounts[0]?.authMethod).toBe('unknown')
    expect(snapshot.claude.accounts).toHaveLength(1)
  })

  it('names the failing field, so a schema drift is not read as a host with no accounts', () => {
    expect(() => decodeAccountsSnapshot(withClaudeAccount('unknown', ''))).toThrow(
      /claude\.accounts\.0\.email/
    )
  })
})
