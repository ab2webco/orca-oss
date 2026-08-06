import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachClaudeLivePtyPersistence,
  attachLiveClaudeTerminalDescriptions,
  attachLiveClaudeWorktreeDisplayNames,
  confirmSeededClaudeLivePtys,
  hasLiveSharedClaudePtysForAccount,
  isUnknownOwnerLiveSharedClaudePty,
  markClaudePtyExited,
  markClaudePtySpawned,
  recordResolvedSharedClaudePtyOwner,
  reserveInjectedClaudeAccountLaunch,
  releaseInjectedClaudeAccountLaunch,
  seedLiveClaudePtysFromPersistence
} from './live-pty-gate'
import { getLiveClaudeRotationOwnership } from './live-pty-account-ownership'
import { resolveUnknownSharedClaudePtyOwnersFor } from './unknown-shared-claude-pty-owner-resolution'
import type { SharedClaudePtyOwnerProbe } from './shared-claude-pty-owner'

const PTY_IDS = ['global-unmanaged', 'global-account-a', 'seeded-legacy', 'seeded-known'] as const

function credentials(refreshToken: string): string {
  return JSON.stringify({ claudeAiOauth: { refreshToken } })
}

afterEach(() => {
  for (const ptyId of PTY_IDS) {
    markClaudePtyExited(ptyId)
  }
  confirmSeededClaudeLivePtys([])
  attachClaudeLivePtyPersistence(null)
  attachLiveClaudeWorktreeDisplayNames(null)
  attachLiveClaudeTerminalDescriptions(null)
})

describe('a shared Claude PTY that owns no managed account', () => {
  it('does not block a pinned launch of any managed account', () => {
    markClaudePtySpawned('global-unmanaged', null)

    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(false)
    expect(hasLiveSharedClaudePtysForAccount('account-b')).toBe(false)
    expect(isUnknownOwnerLiveSharedClaudePty('global-unmanaged')).toBe(false)
  })

  it('still lets the reservation gate refuse a pin to the account it does own', () => {
    markClaudePtySpawned('global-account-a', 'account-a')

    expect(() => reserveInjectedClaudeAccountLaunch('account-a')).toThrow(
      'already in use by a global terminal'
    )
    const reservationId = reserveInjectedClaudeAccountLaunch('account-b')
    expect(reservationId).toEqual(expect.any(String))
    releaseInjectedClaudeAccountLaunch(reservationId)
  })

  it('records the resolved null so a restart does not read it as unknown again', () => {
    const addClaudeLivePtySessionId = vi.fn()
    attachClaudeLivePtyPersistence({
      addClaudeLivePtySessionId,
      removeClaudeLivePtySessionId: vi.fn()
    })

    markClaudePtySpawned('global-unmanaged', null)

    expect(addClaudeLivePtySessionId).toHaveBeenCalledWith('global-unmanaged', null, {
      accountResolved: true
    })
  })

  it('keeps background rotation conservative even though launches are allowed', () => {
    markClaudePtySpawned('global-unmanaged', null)

    expect(getLiveClaudeRotationOwnership().hasUnknownAccount).toBe(true)
  })
})

describe('a seeded shared Claude PTY with no recorded ownership', () => {
  it('blocks every managed account until it is resolved', () => {
    seedLiveClaudePtysFromPersistence(['seeded-legacy'])

    expect(isUnknownOwnerLiveSharedClaudePty('seeded-legacy')).toBe(true)
    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(true)
    expect(hasLiveSharedClaudePtysForAccount('account-b')).toBe(true)
  })

  it('trusts a persisted resolved null instead of blocking again', () => {
    seedLiveClaudePtysFromPersistence(
      ['seeded-known'],
      [{ sessionId: 'seeded-known', accountId: null, accountResolved: true }]
    )

    expect(isUnknownOwnerLiveSharedClaudePty('seeded-known')).toBe(false)
    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(false)
  })

  it('releases every account once its process proves it owns no managed chain', async () => {
    seedLiveClaudePtysFromPersistence(['seeded-legacy'])
    const probe: SharedClaudePtyOwnerProbe = {
      readClaudeConfigDirEnv: async () => ({ value: null }),
      managedAccounts: () => [
        { id: 'account-a', managedAuthPath: '/vaults/account-a/auth', forksOauthChain: true }
      ],
      readSharedRuntimeCredentials: async () => ({ credentialsJson: credentials('own-login') }),
      readManagedCredentials: async () => credentials('managed-a'),
      platform: 'darwin'
    }

    const result = await resolveUnknownSharedClaudePtyOwnersFor(
      [{ sessionId: 'seeded-legacy', pid: 4321 }],
      probe
    )

    expect(result.resolved).toEqual([{ sessionId: 'seeded-legacy', accountId: null }])
    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(false)
  })

  it('narrows to the one account its process actually runs, still refusing that one', async () => {
    seedLiveClaudePtysFromPersistence(['seeded-legacy'])
    const probe: SharedClaudePtyOwnerProbe = {
      readClaudeConfigDirEnv: async () => ({ value: null }),
      managedAccounts: () => [
        { id: 'account-a', managedAuthPath: '/vaults/account-a/auth', forksOauthChain: true },
        { id: 'account-b', managedAuthPath: '/vaults/account-b/auth', forksOauthChain: true }
      ],
      readSharedRuntimeCredentials: async () => ({ credentialsJson: credentials('token-a') }),
      readManagedCredentials: async (accountId) =>
        credentials(accountId === 'account-a' ? 'token-a' : 'token-b'),
      platform: 'darwin'
    }

    await resolveUnknownSharedClaudePtyOwnersFor([{ sessionId: 'seeded-legacy', pid: 4321 }], probe)

    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(true)
    expect(hasLiveSharedClaudePtysForAccount('account-b')).toBe(false)
  })

  it('keeps blocking every account when the credentials cannot be read', async () => {
    seedLiveClaudePtysFromPersistence(['seeded-legacy'])
    const probe: SharedClaudePtyOwnerProbe = {
      readClaudeConfigDirEnv: async () => null,
      managedAccounts: () => [
        { id: 'account-a', managedAuthPath: '/vaults/account-a/auth', forksOauthChain: true }
      ],
      readSharedRuntimeCredentials: async () => null,
      readManagedCredentials: async () => null,
      platform: 'win32'
    }

    const result = await resolveUnknownSharedClaudePtyOwnersFor(
      [{ sessionId: 'seeded-legacy', pid: 4321 }],
      probe
    )

    expect(result.resolved).toEqual([])
    expect(result.unresolved).toEqual([
      {
        sessionId: 'seeded-legacy',
        reason: 'the shared runtime credentials could not be read'
      }
    ])
    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(true)
  })

  it('keeps blocking every account when one managed chain cannot be compared', async () => {
    seedLiveClaudePtysFromPersistence(['seeded-legacy'])
    const probe: SharedClaudePtyOwnerProbe = {
      readClaudeConfigDirEnv: async () => null,
      managedAccounts: () => [
        { id: 'account-a', managedAuthPath: '/vaults/account-a/auth', forksOauthChain: true }
      ],
      readSharedRuntimeCredentials: async () => ({ credentialsJson: credentials('some-chain') }),
      readManagedCredentials: async () => null,
      platform: 'darwin'
    }

    await resolveUnknownSharedClaudePtyOwnersFor([{ sessionId: 'seeded-legacy', pid: 4321 }], probe)

    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(true)
    expect(isUnknownOwnerLiveSharedClaudePty('seeded-legacy')).toBe(true)
  })

  it('never reassigns a PTY whose owner a launch already bound', () => {
    markClaudePtySpawned('global-account-a', 'account-a')

    expect(recordResolvedSharedClaudePtyOwner('global-account-a', null)).toBe(false)
    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(true)
  })

  it('does not let a reattach silently declare a legacy PTY unmanaged', () => {
    seedLiveClaudePtysFromPersistence(['seeded-legacy'])

    // A reattach carries the CURRENT global selection, which says nothing about
    // what the surviving process has owned since before the restart.
    markClaudePtySpawned('seeded-legacy', null)

    expect(isUnknownOwnerLiveSharedClaudePty('seeded-legacy')).toBe(true)
    expect(hasLiveSharedClaudePtysForAccount('account-a')).toBe(true)
  })
})

describe('the refusal names the terminals that block it', () => {
  it('carries the handle and title of each blocking global terminal', () => {
    markClaudePtySpawned('repo-1::/work/feature-a@@pane-1', 'account-a')
    markClaudePtySpawned('repo-1::/work/feature-b@@pane-2', 'account-a')
    attachLiveClaudeTerminalDescriptions((ptyId) =>
      ptyId.includes('pane-1')
        ? { handle: 't1', title: 'claude — ORCA-188' }
        : { handle: 't7', title: null }
    )

    try {
      expect(() => reserveInjectedClaudeAccountLaunch('account-a')).toThrow(
        /terminal t1 "claude — ORCA-188" in "feature-a"/
      )
      expect(() => reserveInjectedClaudeAccountLaunch('account-a')).toThrow(
        /terminal t7 in "feature-b"/
      )
    } finally {
      markClaudePtyExited('repo-1::/work/feature-a@@pane-1')
      markClaudePtyExited('repo-1::/work/feature-b@@pane-2')
    }
  })

  it('says an unknown-ownership terminal is what blocks every account', () => {
    seedLiveClaudePtysFromPersistence(['repo-1::/work/feature-a@@pane-1'])
    attachLiveClaudeTerminalDescriptions(() => ({ handle: 't3', title: 'zsh' }))

    try {
      expect(() => reserveInjectedClaudeAccountLaunch('account-a')).toThrow(
        /whose account Orca could not read blocks every assigned account until it exits \(terminal t3 "zsh" in "feature-a"\)/
      )
    } finally {
      markClaudePtyExited('repo-1::/work/feature-a@@pane-1')
    }
  })
})
