import { describe, expect, it, vi } from 'vitest'
import {
  listClaudeAccountsForActiveHost,
  listCodexAccountsForActiveHost
} from './runtime-provider-account-roster'

const callRuntimeRpc = vi.hoisted(() => vi.fn())

vi.mock('./runtime-rpc-client', () => ({
  callRuntimeRpc,
  getActiveRuntimeTarget: (settings: { activeRuntimeEnvironmentId?: string | null }) =>
    settings.activeRuntimeEnvironmentId
      ? { kind: 'environment', environmentId: settings.activeRuntimeEnvironmentId }
      : { kind: 'local' }
}))

const localRoster = { accounts: [{ id: 'local-1' }], activeAccountId: 'local-1' }

describe('listClaudeAccountsForActiveHost', () => {
  it('reads the roster of the server that owns the accounts', async () => {
    callRuntimeRpc.mockResolvedValueOnce({ claude: { accounts: [{ id: 'server-1' }] } })
    vi.stubGlobal('window', { api: { claudeAccounts: { list: vi.fn() } } })

    const roster = await listClaudeAccountsForActiveHost({ activeRuntimeEnvironmentId: 'env-1' })

    expect(roster.accounts).toEqual([{ id: 'server-1' }])
    // Why refreshUsage false: a picker only needs identities, and the forced
    // refresh bypasses the poll throttle for every account in the roster.
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'accounts.list',
      { refreshUsage: false },
      expect.anything()
    )
    vi.unstubAllGlobals()
  })

  // Why this case matters: it is the one the pickers used to take always, which
  // is how a desktop offered its own accounts while a server owned them.
  it('falls back to this desktop only when no server is active', async () => {
    callRuntimeRpc.mockClear()
    const list = vi.fn().mockResolvedValue(localRoster)
    vi.stubGlobal('window', { api: { claudeAccounts: { list } } })

    const roster = await listClaudeAccountsForActiveHost({ activeRuntimeEnvironmentId: null })

    expect(roster).toEqual(localRoster)
    expect(callRuntimeRpc).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('listCodexAccountsForActiveHost', () => {
  // Why this matters as much as the Claude one: the workspace context menu pins
  // both providers, and a pin is what makes a terminal launch bound to an
  // account at all.
  it('reads the Codex roster of the server that owns the accounts', async () => {
    callRuntimeRpc.mockClear().mockResolvedValueOnce({ codex: { accounts: [{ id: 'srv-codex' }] } })
    vi.stubGlobal('window', { api: { codexAccounts: { list: vi.fn() } } })

    const roster = await listCodexAccountsForActiveHost({ activeRuntimeEnvironmentId: 'env-1' })

    expect(roster.accounts).toEqual([{ id: 'srv-codex' }])
    vi.unstubAllGlobals()
  })

  it('falls back to this desktop only when no server is active', async () => {
    callRuntimeRpc.mockClear()
    const local = { accounts: [{ id: 'local-codex' }] }
    const list = vi.fn().mockResolvedValue(local)
    vi.stubGlobal('window', { api: { codexAccounts: { list } } })

    await expect(
      listCodexAccountsForActiveHost({ activeRuntimeEnvironmentId: null })
    ).resolves.toEqual(local)
    expect(callRuntimeRpc).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
