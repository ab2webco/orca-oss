import { describe, expect, it } from 'vitest'
import type { AccountListEntry } from '../../../../shared/managed-account-list-entries'
import { resolveFederatedMemberAccount } from './orchestration-federation-member-account'

const NOW = Date.parse('2026-10-29T12:00:00Z')
const HOUR = 3_600_000

function entry(
  email: string,
  usedPercent: number | null,
  extra: Partial<AccountListEntry> = {}
): AccountListEntry {
  return {
    provider: 'claude',
    id: `id-${email}`,
    email,
    active: false,
    runtime: 'host',
    wslDistro: null,
    quota:
      usedPercent === null
        ? null
        : {
            status: 'ok',
            session: {
              usedPercent,
              windowMinutes: 300,
              resetsAt: NOW + HOUR,
              resetDescription: null
            },
            weekly: null,
            updatedAt: NOW,
            error: null,
            source: 'api'
          },
    ...extra
  } as AccountListEntry
}

const resolve = (entries: AccountListEntry[], selector: string, agent = 'claude') =>
  resolveFederatedMemberAccount({ entries, agent, selector, now: NOW })

describe('a remote member account resolved against the host roster (ORCA-798)', () => {
  it('pins a named account by email from this host roster', () => {
    const picked = resolve(
      [entry('ana@koombea.com', 80), entry('ops@netsat.co', 5)],
      'ANA@koombea.com'
    )
    expect(picked).toEqual({
      pin: { claudeAccountId: 'id-ana@koombea.com' },
      account: { provider: 'claude', email: 'ana@koombea.com' }
    })
  })

  it('refuses an email this host does not have instead of falling back to its login', () => {
    expect(() => resolve([entry('ops@netsat.co', 5)], 'ana@koombea.com')).toThrow(
      expect.objectContaining({
        code: 'invalid_argument',
        message: expect.stringContaining('ana@koombea.com')
      })
    )
  })

  it('refuses a named account whose sign-in failed on this host', () => {
    const broken = entry('ana@koombea.com', 5, {
      auth: {
        accountId: 'id-ana@koombea.com',
        state: 'failed'
      } as AccountListEntry['auth']
    })
    expect(() => resolve([broken], 'ana@koombea.com')).toThrow(
      expect.objectContaining({
        code: 'invalid_argument',
        message: expect.stringContaining('sign-in')
      })
    )
  })

  it('picks the freest account for auto and reports its email', () => {
    const picked = resolve([entry('ana@koombea.com', 70), entry('bo@koombea.com', 10)], 'auto')
    expect(picked.account).toEqual({
      provider: 'claude',
      email: 'bo@koombea.com'
    })
    expect(picked.pin).toEqual({ claudeAccountId: 'id-bo@koombea.com' })
  })

  it('runs auto on the global login when this host has no managed account (ORCA-891)', () => {
    expect(resolve([], 'auto')).toEqual({ pin: {}, account: null, globalLogin: 'claude' })
    expect(resolve([entry('ana@koombea.com', 5)], 'auto', 'codex')).toEqual({
      pin: {},
      account: null,
      globalLogin: 'codex'
    })
  })

  it('refuses auto rather than the global login when managed accounts exist but none is usable (ORCA-891)', () => {
    const broken = entry('ana@koombea.com', 5, {
      auth: { accountId: 'id-ana@koombea.com', state: 'failed' } as AccountListEntry['auth']
    })
    expect(() => resolve([broken], 'auto')).toThrow(
      expect.objectContaining({ code: 'accounts_unusable' })
    )
  })

  it('still refuses a named account on a host with no managed account', () => {
    expect(() => resolve([], 'ana@koombea.com')).toThrow(
      expect.objectContaining({ code: 'invalid_argument' })
    )
  })

  it('refuses auto with the earliest reset when every account is at its limit', () => {
    expect(() => resolve([entry('ana@koombea.com', 100)], 'auto')).toThrow(
      expect.objectContaining({
        code: 'accounts_limited',
        data: { resetsAt: NOW + HOUR }
      })
    )
  })

  it('refuses an account for an agent Orca does not manage accounts for', () => {
    expect(() => resolve([entry('ana@koombea.com', 5)], 'auto', 'gemini')).toThrow(
      expect.objectContaining({ code: 'invalid_argument' })
    )
  })
})
