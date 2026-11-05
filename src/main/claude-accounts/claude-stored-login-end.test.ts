import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claudeStoredLoginOf,
  readClaudeStoredLogin,
  reportEndedClaudeLogins,
  resetStoredClaudeLoginChecksForTests
} from './claude-stored-login-end'

const NOW = Date.UTC(2026, 10, 5, 1, 0, 0)
const DAY = 86_400_000
const GRANT_END = NOW + 20 * DAY

// Placeholder strings only: the shapes the Claude CLI 2.1.318 writes, never a real token.
const live = (endsAt: number | undefined = GRANT_END, expiresAt = NOW + 3_600_000) =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: 'access-placeholder',
      refreshToken: 'refresh-placeholder',
      expiresAt,
      ...(endsAt !== undefined ? { refreshTokenExpiresAt: endsAt } : {})
    }
  })
// The CLI's dead-token disk clear after invalid_grant keeps every other field.
const wiped = (endsAt: number = GRANT_END) =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: '',
      refreshToken: '',
      expiresAt: 0,
      refreshTokenExpiresAt: endsAt
    }
  })

describe('readClaudeStoredLogin', () => {
  it('reads a wiped refresh token as ended', () => {
    expect(readClaudeStoredLogin(wiped(), NOW).ended).toBe('wiped')
    // orca-contabo's dead logins: empty tokens, refreshTokenExpiresAt 1.
    expect(readClaudeStoredLogin(wiped(1), NOW).ended).toBe('wiped')
  })

  it('reads a login past its hard end as ended, and a live one with its end date', () => {
    expect(readClaudeStoredLogin(live(NOW - 1), NOW).ended).toBe('time-limit')
    expect(readClaudeStoredLogin(live(), NOW)).toEqual({ ended: null, endsAt: GRANT_END })
  })

  it('decides nothing from what it cannot parse', () => {
    expect(readClaudeStoredLogin('not json', NOW)).toEqual({ ended: null, endsAt: null })
    expect(readClaudeStoredLogin('{}', NOW)).toEqual({ ended: null, endsAt: null })
    expect(
      readClaudeStoredLogin(JSON.stringify({ claudeAiOauth: { refreshToken: 'placeholder' } }), NOW)
    ).toEqual({ ended: null, endsAt: null })
  })
})

describe('claudeStoredLoginOf', () => {
  it('keeps a login alive while any copy from another grant still works (re-auth after a wipe)', () => {
    const reauth = live(NOW + 30 * DAY)
    expect(claudeStoredLoginOf([wiped(), reauth], NOW)).toEqual({
      ended: null,
      endsAt: NOW + 30 * DAY
    })
  })

  it('ends a stale copy of the same grant the CLI already wiped', () => {
    // macOS: the pinned CLI wiped its scoped item; Orca's managed copy is an older link of that chain.
    expect(claudeStoredLoginOf([wiped(), live(GRANT_END, NOW + 3_600_000)], NOW).ended).toBe(
      'wiped'
    )
  })

  it('reports the time limit when every copy is past it', () => {
    expect(claudeStoredLoginOf([live(NOW - 1), null], NOW).ended).toBe('time-limit')
  })

  it('decides nothing with no stored copy', () => {
    expect(claudeStoredLoginOf([null, ''], NOW)).toEqual({ ended: null, endsAt: null })
  })
})

describe('reportEndedClaudeLogins', () => {
  beforeEach(() => resetStoredClaudeLoginChecksForTests())

  const run = (
    copies: Record<string, (string | null)[]>,
    options: { failed?: string[]; now?: number } = {}
  ) => {
    const ended: string[] = []
    const endsAt: [string, number | null][] = []
    const readCopies = vi.fn(async (account: { id: string }) => copies[account.id] ?? [])
    return {
      ended,
      endsAt,
      readCopies,
      done: reportEndedClaudeLogins({
        accounts: [{ id: 'scloud' }, { id: 'fab' }, { id: 'wsl', managedAuthRuntime: 'wsl' }],
        alreadyFailed: (id) => options.failed?.includes(id) ?? false,
        recordEnded: (id) => ended.push(id),
        recordEndsAt: (id, at) => endsAt.push([id, at]),
        readCopies,
        now: () => options.now ?? NOW
      })
    }
  }

  it('fails the login the CLI wiped and records the live one’s end, without touching WSL', async () => {
    const result = run({ scloud: [wiped()], fab: [live()] })
    await result.done
    expect(result.ended).toEqual(['scloud'])
    expect(result.endsAt).toEqual([
      ['scloud', null],
      ['fab', GRANT_END]
    ])
    expect(result.readCopies).toHaveBeenCalledTimes(2)
  })

  it('skips an account already failed and re-reads each one at most every 30 s', async () => {
    await run({ scloud: [live()], fab: [live()] }, { failed: ['fab'] }).done
    const again = run({ scloud: [wiped()] }, { now: NOW + 10_000 })
    await again.done
    expect(again.readCopies).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'scloud' }))

    const later = run({ scloud: [wiped()] }, { now: NOW + 31_000 })
    await later.done
    expect(later.ended).toContain('scloud')
  })

  it('records nothing for an account whose store cannot be read', async () => {
    const ended: string[] = []
    await reportEndedClaudeLogins({
      accounts: [{ id: 'scloud' }],
      alreadyFailed: () => false,
      recordEnded: (id) => ended.push(id),
      recordEndsAt: () => {},
      readCopies: async () => {
        throw new Error('keychain locked')
      },
      now: () => NOW
    })
    expect(ended).toEqual([])
  })
})
