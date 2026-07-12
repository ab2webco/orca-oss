import { describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import {
  assertValidClaudeAccountPin,
  normalizeClaudeAccountPinForCreate
} from './worktree-account-pin'

function makeStore(accountIds: readonly string[]): Store {
  return {
    getSettings: vi.fn(() => ({
      claudeManagedAccounts: accountIds.map((id) => ({ id }))
    }))
  } as unknown as Store
}

describe('worktree Claude account pins', () => {
  it('drops a captured create pin after its account is removed', () => {
    expect(normalizeClaudeAccountPinForCreate(makeStore([]), 'removed')).toBeNull()
  })

  it('preserves current and inherit-global create choices', () => {
    const store = makeStore(['account-a'])
    expect(normalizeClaudeAccountPinForCreate(store, 'account-a')).toBe('account-a')
    expect(normalizeClaudeAccountPinForCreate(store, null)).toBeNull()
    expect(normalizeClaudeAccountPinForCreate(store, undefined)).toBeUndefined()
  })

  it('rejects renderer updates that reference a removed account', () => {
    expect(() => assertValidClaudeAccountPin(makeStore([]), 'removed')).toThrow('no longer exists')
  })
})
