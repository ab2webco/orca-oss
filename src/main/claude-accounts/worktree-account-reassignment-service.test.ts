import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeManagedAccount, GlobalSettings } from '../../shared/types'
import { ClaudeAccountService } from './service'
import { markClaudePtyExited, markInjectedClaudePtySpawned } from './live-pty-gate'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/orca-claude-reassign-test' } }))

const WORKTREE_A = 'repo-1::/work/feature-a'
const WORKTREE_B = 'repo-2::/work/feature-b'
const PTY_A = `${WORKTREE_A}@@pane-1`

function account(id: string, email: string): ClaudeManagedAccount {
  return {
    id,
    email,
    organizationUuid: null,
    organizationName: null,
    managedAuthPath: `/tmp/${id}`,
    managedAuthRuntime: 'host',
    wslDistro: null,
    wslLinuxAuthPath: null,
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

function createStore(): {
  store: Parameters<typeof buildService>[0]
  worktreeMeta: Record<string, { displayName: string; claudeAccountId?: string | null }>
  settings: Pick<GlobalSettings, 'claudeManagedAccounts' | 'activeClaudeManagedAccountId'>
  commits: { settings: Partial<GlobalSettings>; pins: Record<string, string | null> }[]
} {
  const worktreeMeta: Record<string, { displayName: string; claudeAccountId?: string | null }> = {
    [WORKTREE_A]: { displayName: 'feature-a', claudeAccountId: 'account-a' },
    [WORKTREE_B]: { displayName: 'feature-b', claudeAccountId: 'account-a' }
  }
  const settings = {
    claudeManagedAccounts: [account('account-a', 'a@example.com'), account('account-b', 'b@x.com')],
    activeClaudeManagedAccountId: null
  }
  const commits: { settings: Partial<GlobalSettings>; pins: Record<string, string | null> }[] = []
  const store = {
    getSettings: () => settings,
    getAllWorktreeMeta: () => worktreeMeta,
    updateSettings: () => {},
    commitClaudeAccountState: (
      nextSettings: Partial<GlobalSettings>,
      pins: Record<string, string | null>
    ) => {
      commits.push({ settings: nextSettings, pins })
      for (const [worktreeId, accountId] of Object.entries(pins)) {
        worktreeMeta[worktreeId] = { ...worktreeMeta[worktreeId], claudeAccountId: accountId }
      }
    }
  }
  return { store: store as never, worktreeMeta, settings, commits }
}

function buildService(
  store: never,
  onPinsChanged: (repoId: string) => void,
  terminate: (ptyId: string) => Promise<boolean>
): ClaudeAccountService {
  return new ClaudeAccountService(
    store,
    { evictInactiveClaudeCache: () => {}, refreshForClaudeAccountChange: async () => {} } as never,
    {} as never,
    onPinsChanged,
    terminate
  )
}

describe('ClaudeAccountService worktree reassignment', () => {
  beforeEach(() => {
    markClaudePtyExited(PTY_A)
  })

  it('moves every pin onto the chosen account and invalidates both repos', async () => {
    const { store, worktreeMeta } = createStore()
    const onPinsChanged = vi.fn()
    const service = buildService(store, onPinsChanged, async () => true)

    await service.reassignWorktreeAccountPins({
      fromAccountId: 'account-a',
      toAccountId: 'account-b',
      closeLiveTerminals: false
    })

    expect(worktreeMeta[WORKTREE_A].claudeAccountId).toBe('account-b')
    expect(worktreeMeta[WORKTREE_B].claudeAccountId).toBe('account-b')
    expect(onPinsChanged.mock.calls.map((call) => call[0]).sort()).toEqual(['repo-1', 'repo-2'])
  })

  it('clears the pins when the destination is the system default', async () => {
    const { store, worktreeMeta } = createStore()
    const service = buildService(store, () => {}, async () => true)

    await service.reassignWorktreeAccountPins({
      fromAccountId: 'account-a',
      toAccountId: null,
      closeLiveTerminals: false
    })

    expect(worktreeMeta[WORKTREE_A].claudeAccountId).toBeNull()
  })

  it('closes the live terminals of the source account before moving pins', async () => {
    const { store } = createStore()
    const terminate = vi.fn(async () => true)
    const service = buildService(store, () => {}, terminate)
    markInjectedClaudePtySpawned(PTY_A, 'account-a')

    await service.reassignWorktreeAccountPins({
      fromAccountId: 'account-a',
      toAccountId: 'account-b',
      closeLiveTerminals: true
    })

    expect(terminate).toHaveBeenCalledWith(PTY_A)
  })

  it('refuses a destination that does not exist', async () => {
    const { store } = createStore()
    const service = buildService(store, () => {}, async () => true)

    await expect(
      service.reassignWorktreeAccountPins({
        fromAccountId: 'account-a',
        toAccountId: 'account-missing',
        closeLiveTerminals: false
      })
    ).rejects.toThrow('That Claude account no longer exists.')
  })

  it('refuses reassigning an account onto itself', async () => {
    const { store } = createStore()
    const service = buildService(store, () => {}, async () => true)

    await expect(
      service.reassignWorktreeAccountPins({
        fromAccountId: 'account-a',
        toAccountId: 'account-a',
        closeLiveTerminals: false
      })
    ).rejects.toThrow('Pick a different Claude account')
  })

  it('keeps a live injected session on its original account after the pin moves', async () => {
    const { store } = createStore()
    const service = buildService(store, () => {}, async () => true)
    markInjectedClaudePtySpawned(PTY_A, 'account-a')

    await service.reassignWorktreeAccountPins({
      fromAccountId: 'account-a',
      toAccountId: 'account-b',
      closeLiveTerminals: false
    })

    // Why: a surviving CLI owns the credentials it launched with; repinning the
    // worktree must never re-bind that session to another account.
    expect(() => markInjectedClaudePtySpawned(PTY_A, 'account-b')).toThrow(
      'A live Claude terminal cannot change its assigned account.'
    )
  })

  it('reports which worktrees hold the account and which are live', () => {
    const { store } = createStore()
    const service = buildService(store, () => {}, async () => true)
    markInjectedClaudePtySpawned(PTY_A, 'account-a')

    const report = service.getAccountWorktreeUsageReport('account-a')

    expect(report.worktrees).toEqual([
      { worktreeId: WORKTREE_A, displayName: 'feature-a', hasLiveTerminal: true },
      { worktreeId: WORKTREE_B, displayName: 'feature-b', hasLiveTerminal: false }
    ])
    expect(report.liveTerminalCount).toBe(1)
  })
})
