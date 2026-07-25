import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { resolveManagedClaudeAccountIdFromConfigDir } from './managed-config-dir-account'

const ROOT = join('/tmp', 'userData', 'claude-accounts')

describe('resolveManagedClaudeAccountIdFromConfigDir', () => {
  it('recovers the account id from a managed config dir', () => {
    expect(resolveManagedClaudeAccountIdFromConfigDir(join(ROOT, 'account-1', 'auth'), ROOT)).toBe(
      'account-1'
    )
  })

  it('returns null for the shared ~/.claude dir', () => {
    expect(
      resolveManagedClaudeAccountIdFromConfigDir(join('/Users', 'someone', '.claude'), ROOT)
    ).toBeNull()
  })

  it('returns null for the root itself', () => {
    expect(resolveManagedClaudeAccountIdFromConfigDir(ROOT, ROOT)).toBeNull()
  })

  it('returns null when the dir escapes the managed root', () => {
    expect(
      resolveManagedClaudeAccountIdFromConfigDir(join(ROOT, '..', 'elsewhere', 'auth'), ROOT)
    ).toBeNull()
  })

  it('returns null for a deeper path than <accountId>/auth', () => {
    expect(
      resolveManagedClaudeAccountIdFromConfigDir(join(ROOT, 'account-1', 'auth', 'nested'), ROOT)
    ).toBeNull()
  })

  it('returns null when the leaf is not the auth dir', () => {
    expect(
      resolveManagedClaudeAccountIdFromConfigDir(join(ROOT, 'account-1', 'other'), ROOT)
    ).toBeNull()
  })

  it('returns null for missing inputs', () => {
    expect(resolveManagedClaudeAccountIdFromConfigDir(null, ROOT)).toBeNull()
    expect(resolveManagedClaudeAccountIdFromConfigDir(join(ROOT, 'a', 'auth'), null)).toBeNull()
  })
})
