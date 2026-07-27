import { describe, expect, it, vi } from 'vitest'
import type { ClaudeManagedAccount } from '../../shared/types'
import { readManagedClaudeRefreshCredentials } from './claude-managed-refresh-chain'

function account(overrides: Partial<ClaudeManagedAccount> = {}): ClaudeManagedAccount {
  return {
    id: 'account-wsl',
    email: 'developer@example.com',
    managedAuthPath:
      '\\\\wsl.localhost\\Ubuntu\\home\\developer\\.local\\share\\orca\\claude-accounts\\account-wsl\\auth',
    managedAuthRuntime: 'wsl',
    wslDistro: 'Ubuntu',
    wslLinuxAuthPath: '/home/developer/.local/share/orca/claude-accounts/account-wsl/auth',
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...overrides
  }
}

describe('managed Claude refresh-chain credentials', () => {
  it('reads a WSL account from its Linux credential source', async () => {
    const readWslCredentials = vi.fn(async () => '{"claudeAiOauth":{"refreshToken":"wsl"}}')

    const result = await readManagedClaudeRefreshCredentials('account-wsl', {
      accounts: [account()],
      platform: 'win32',
      readWslCredentials
    })

    expect(result).toContain('"wsl"')
    expect(readWslCredentials).toHaveBeenCalledWith(
      'Ubuntu',
      '/home/developer/.local/share/orca/claude-accounts/account-wsl/auth',
      'account-wsl'
    )
  })

  it('fails closed when a WSL account has no Linux auth path', async () => {
    const readWslCredentials = vi.fn()

    const result = await readManagedClaudeRefreshCredentials('account-wsl', {
      accounts: [account({ wslLinuxAuthPath: null })],
      platform: 'win32',
      readWslCredentials
    })

    expect(result).toBeNull()
    expect(readWslCredentials).not.toHaveBeenCalled()
  })

  it('does not derive credential storage from a workspace path', async () => {
    const readWslCredentials = vi.fn(async () => 'folder-workspace-credentials')

    const result = await readManagedClaudeRefreshCredentials('account-wsl', {
      accounts: [account()],
      platform: 'win32',
      readWslCredentials
    })

    expect(result).toBe('folder-workspace-credentials')
    expect(readWslCredentials).toHaveBeenCalledWith(
      'Ubuntu',
      '/home/developer/.local/share/orca/claude-accounts/account-wsl/auth',
      'account-wsl'
    )
  })
})
