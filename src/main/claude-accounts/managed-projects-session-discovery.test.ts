import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ClaudeManagedAccount } from '../../shared/types'
import { getManagedClaudeProjectsPathsForSessionDiscovery } from './managed-projects-session-discovery'

function account(overrides: Partial<ClaudeManagedAccount>): ClaudeManagedAccount {
  return {
    id: 'account-1',
    label: 'one@example.com',
    managedAuthPath: '/data/claude-accounts/account-1/auth',
    ...overrides
  } as ClaudeManagedAccount
}

describe('getManagedClaudeProjectsPathsForSessionDiscovery', () => {
  it('returns each host vault projects dir', () => {
    // Why: a pinned worktree writes its transcripts here, not to ~/.claude, so a
    // scan that misses these hides every pinned session from history and offers
    // resume ids the launch universe does not hold.
    const paths = getManagedClaudeProjectsPathsForSessionDiscovery([
      account({ id: 'a', managedAuthPath: '/data/claude-accounts/a/auth' }),
      account({ id: 'b', managedAuthPath: '/data/claude-accounts/b/auth' })
    ])

    expect(paths).toEqual([
      join('/data/claude-accounts/a/auth', 'projects'),
      join('/data/claude-accounts/b/auth', 'projects')
    ])
  })

  it('leaves out WSL vaults, whose paths live inside the distro', () => {
    const paths = getManagedClaudeProjectsPathsForSessionDiscovery([
      account({ id: 'host', managedAuthPath: '/data/claude-accounts/host/auth' }),
      account({
        id: 'wsl',
        managedAuthPath: '/data/claude-accounts/wsl/auth',
        managedAuthRuntime: 'wsl'
      })
    ])

    expect(paths).toEqual([join('/data/claude-accounts/host/auth', 'projects')])
  })

  it('collapses duplicate vault paths', () => {
    const paths = getManagedClaudeProjectsPathsForSessionDiscovery([
      account({ id: 'a', managedAuthPath: '/data/claude-accounts/a/auth' }),
      account({ id: 'a-duplicate', managedAuthPath: '/data/claude-accounts/a/auth' })
    ])

    expect(paths).toHaveLength(1)
  })
})
