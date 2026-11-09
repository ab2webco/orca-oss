import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeManagedAccount } from '../../shared/types'

const TEST_ROOT = join(tmpdir(), 'orca-managed-vault-authentication-test')

vi.mock('electron', () => ({ app: { getPath: () => TEST_ROOT } }))
vi.mock('./keychain', () => ({ readManagedClaudeKeychainCredentials: vi.fn(async () => null) }))

function vault(settings: unknown): ClaudeManagedAccount {
  const managedAuthPath = join(TEST_ROOT, 'claude-accounts', 'acct-1', 'auth')
  mkdirSync(managedAuthPath, { recursive: true })
  writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), 'acct-1\n', 'utf-8')
  writeFileSync(join(managedAuthPath, 'settings.json'), JSON.stringify(settings), 'utf-8')
  return {
    id: 'acct-1',
    email: 'a@example.com',
    managedAuthPath,
    authMethod: 'subscription-oauth',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
}

describe('isManagedClaudeVaultAuthenticated', () => {
  beforeEach(() => rmSync(TEST_ROOT, { recursive: true, force: true }))
  afterEach(() => rmSync(TEST_ROOT, { recursive: true, force: true }))

  it('accepts a vault whose only credential is a long-lived token (ORCA-1039)', async () => {
    const { isManagedClaudeVaultAuthenticated } = await import('./managed-vault-authentication')
    const account = vault({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'fixture-token' } })
    await expect(isManagedClaudeVaultAuthenticated(account)).resolves.toBe(true)
  })

  it('still refuses a vault with no credential at all', async () => {
    const { isManagedClaudeVaultAuthenticated } = await import('./managed-vault-authentication')
    await expect(isManagedClaudeVaultAuthenticated(vault({ theme: 'dark' }))).resolves.toBe(false)
  })
})
