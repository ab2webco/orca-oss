import { describe, expect, it, vi } from 'vitest'
import {
  resolveSharedClaudePtyOwner,
  type SharedClaudePtyOwnerProbe
} from './shared-claude-pty-owner'

function credentials(refreshToken: string): string {
  return JSON.stringify({ claudeAiOauth: { refreshToken } })
}

function probe(overrides: Partial<SharedClaudePtyOwnerProbe> = {}): SharedClaudePtyOwnerProbe {
  return {
    readClaudeConfigDirEnv: async () => ({ value: null }),
    managedAccounts: () => [],
    readSharedRuntimeCredentials: async () => ({ credentialsJson: null }),
    readManagedCredentials: async () => null,
    platform: 'darwin',
    ...overrides
  }
}

describe('resolveSharedClaudePtyOwner', () => {
  it('binds a process to the managed account whose vault its CLAUDE_CONFIG_DIR names', async () => {
    const owner = await resolveSharedClaudePtyOwner(
      4321,
      probe({
        readClaudeConfigDirEnv: async () => ({ value: '/vaults/account-b/auth/' }),
        managedAccounts: () => [
          { id: 'account-a', managedAuthPath: '/vaults/account-a/auth' },
          { id: 'account-b', managedAuthPath: '/vaults/account-b/auth' }
        ]
      })
    )

    expect(owner).toEqual({ kind: 'managed', accountId: 'account-b' })
  })

  it('stays unknown for a CLAUDE_CONFIG_DIR no managed account claims', async () => {
    const owner = await resolveSharedClaudePtyOwner(
      4321,
      probe({
        readClaudeConfigDirEnv: async () => ({ value: '/somewhere/else' }),
        managedAccounts: () => [{ id: 'account-a', managedAuthPath: '/vaults/account-a/auth' }]
      })
    )

    expect(owner).toMatchObject({ kind: 'unknown' })
  })

  it('resolves to unmanaged when the shared dir holds no OAuth chain', async () => {
    const owner = await resolveSharedClaudePtyOwner(
      4321,
      probe({
        managedAccounts: () => [{ id: 'account-a', managedAuthPath: '/vaults/account-a/auth' }],
        readSharedRuntimeCredentials: async () => ({ credentialsJson: null })
      })
    )

    expect(owner).toEqual({ kind: 'unmanaged' })
  })

  it('resolves to unmanaged when the shared chain matches no managed account', async () => {
    const owner = await resolveSharedClaudePtyOwner(
      4321,
      probe({
        managedAccounts: () => [{ id: 'account-a', managedAuthPath: '/vaults/account-a/auth' }],
        readSharedRuntimeCredentials: async () => ({
          credentialsJson: credentials('the-users-own-login')
        }),
        readManagedCredentials: async () => credentials('managed-token')
      })
    )

    expect(owner).toEqual({ kind: 'unmanaged' })
  })

  it('binds to the managed account whose chain the shared dir actually holds', async () => {
    const owner = await resolveSharedClaudePtyOwner(
      4321,
      probe({
        managedAccounts: () => [
          { id: 'account-a', managedAuthPath: '/vaults/account-a/auth' },
          { id: 'account-b', managedAuthPath: '/vaults/account-b/auth' }
        ],
        readSharedRuntimeCredentials: async () => ({ credentialsJson: credentials('token-b') }),
        readManagedCredentials: async (accountId) =>
          credentials(accountId === 'account-b' ? 'token-b' : 'token-a')
      })
    )

    expect(owner).toEqual({ kind: 'managed', accountId: 'account-b' })
  })

  it('stays unknown when a managed credential cannot be compared', async () => {
    const owner = await resolveSharedClaudePtyOwner(
      4321,
      probe({
        managedAccounts: () => [{ id: 'account-a', managedAuthPath: '/vaults/account-a/auth' }],
        readSharedRuntimeCredentials: async () => ({ credentialsJson: credentials('unknown') }),
        readManagedCredentials: async () => null
      })
    )

    expect(owner).toMatchObject({ kind: 'unknown' })
  })

  it('stays unknown when the shared credential read fails', async () => {
    const owner = await resolveSharedClaudePtyOwner(
      4321,
      probe({ readSharedRuntimeCredentials: async () => null })
    )

    expect(owner).toMatchObject({ kind: 'unknown' })
  })

  it('falls back to the shared runtime chain where the environment is unreadable', async () => {
    // macOS hides another process's environment from a non-root `ps` and Windows
    // exposes it to nobody, so the recorded shared-launch mode carries the config
    // dir and the chain in it still decides the owner.
    const readClaudeConfigDirEnv = vi.fn(async () => null)
    const owner = await resolveSharedClaudePtyOwner(
      4321,
      probe({
        readClaudeConfigDirEnv,
        platform: 'win32',
        managedAccounts: () => [{ id: 'account-a', managedAuthPath: 'c:\\vaults\\a' }],
        readSharedRuntimeCredentials: async () => ({ credentialsJson: credentials('token-a') }),
        readManagedCredentials: async () => credentials('token-a')
      })
    )

    expect(owner).toEqual({ kind: 'managed', accountId: 'account-a' })
    expect(readClaudeConfigDirEnv).toHaveBeenCalledWith(4321)
  })

  it('stays unknown without a pid and never probes', async () => {
    const readClaudeConfigDirEnv = vi.fn(async () => ({ value: null }))
    const owner = await resolveSharedClaudePtyOwner(null, probe({ readClaudeConfigDirEnv }))

    expect(owner).toMatchObject({ kind: 'unknown' })
    expect(readClaudeConfigDirEnv).not.toHaveBeenCalled()
  })

  it('matches a WSL vault path case-insensitively on Windows', async () => {
    const owner = await resolveSharedClaudePtyOwner(
      4321,
      probe({
        platform: 'win32',
        readClaudeConfigDirEnv: async () => ({ value: 'C:\\Vaults\\Account-A\\Auth' }),
        managedAccounts: () => [{ id: 'account-a', managedAuthPath: 'c:\\vaults\\account-a\\auth' }]
      })
    )

    expect(owner).toEqual({ kind: 'managed', accountId: 'account-a' })
  })
})
