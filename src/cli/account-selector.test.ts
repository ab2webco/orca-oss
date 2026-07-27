import { describe, expect, it, vi } from 'vitest'
import { resolveAccountSelectorFlags, resolveManagedAccountSelector } from './account-selector'
import type { RuntimeClient } from './runtime-client'

const ACCOUNTS = [
  { id: 'acc-work', email: 'work@example.com' },
  { id: 'acc-personal', email: 'personal@example.com' },
  { id: 'acc-dup-a', email: 'shared@example.com' },
  { id: 'acc-dup-b', email: 'shared@example.com' }
]

describe('resolveManagedAccountSelector', () => {
  it('resolves by account id', () => {
    expect(
      resolveManagedAccountSelector({
        flag: 'claude-account',
        providerLabel: 'Claude',
        selector: 'acc-work',
        accounts: ACCOUNTS
      })
    ).toBe('acc-work')
  })

  it('resolves by email, case-insensitively', () => {
    expect(
      resolveManagedAccountSelector({
        flag: 'claude-account',
        providerLabel: 'Claude',
        selector: 'Personal@Example.COM',
        accounts: ACCOUNTS
      })
    ).toBe('acc-personal')
  })

  it('rejects an unknown selector and names the available accounts', () => {
    expect(() =>
      resolveManagedAccountSelector({
        flag: 'claude-account',
        providerLabel: 'Claude',
        selector: 'nobody@example.com',
        accounts: ACCOUNTS
      })
    ).toThrow(
      '--claude-account "nobody@example.com" does not match any Claude account. ' +
        'Available: work@example.com (id acc-work), personal@example.com (id acc-personal), ' +
        'shared@example.com (id acc-dup-a), shared@example.com (id acc-dup-b).'
    )
  })

  it('rejects an ambiguous email and points at the ids', () => {
    expect(() =>
      resolveManagedAccountSelector({
        flag: 'codex-account',
        providerLabel: 'Codex',
        selector: 'shared@example.com',
        accounts: ACCOUNTS
      })
    ).toThrow(
      '--codex-account "shared@example.com" is ambiguous: it matches ' +
        'shared@example.com (id acc-dup-a), shared@example.com (id acc-dup-b). ' +
        'Pass the account id instead.'
    )
  })

  it('rejects when no accounts are configured', () => {
    expect(() =>
      resolveManagedAccountSelector({
        flag: 'codex-account',
        providerLabel: 'Codex',
        selector: 'work@example.com',
        accounts: []
      })
    ).toThrow('no managed Codex accounts are configured')
  })
})

describe('resolveAccountSelectorFlags', () => {
  function makeClient(): { client: RuntimeClient; call: ReturnType<typeof vi.fn> } {
    const call = vi.fn(async () => ({
      id: 'req_1',
      ok: true as const,
      result: {
        claude: { accounts: [{ id: 'acc-claude', email: 'claude@example.com' }] },
        codex: { accounts: [{ id: 'acc-codex', email: 'codex@example.com' }] }
      }
    }))
    return { client: { call } as unknown as RuntimeClient, call }
  }

  it('skips the roster RPC when neither flag is present', async () => {
    const { client, call } = makeClient()
    await expect(resolveAccountSelectorFlags(new Map(), client)).resolves.toEqual({})
    expect(call).not.toHaveBeenCalled()
  })

  it('resolves both flags from one accounts.snapshot call', async () => {
    const { client, call } = makeClient()
    const flags = new Map<string, string | boolean>([
      ['claude-account', 'claude@example.com'],
      ['codex-account', 'acc-codex']
    ])
    await expect(resolveAccountSelectorFlags(flags, client)).resolves.toEqual({
      claudeAccountId: 'acc-claude',
      codexAccountId: 'acc-codex'
    })
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('accounts.snapshot')
  })

  it('rejects a valueless flag before calling the runtime', async () => {
    const { client, call } = makeClient()
    const flags = new Map<string, string | boolean>([['claude-account', true]])
    await expect(resolveAccountSelectorFlags(flags, client)).rejects.toThrow(
      'Missing value for --claude-account'
    )
    expect(call).not.toHaveBeenCalled()
  })
})
