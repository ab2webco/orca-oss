import { describe, expect, it } from 'vitest'

import {
  GAME_ACCOUNT_NEAR_LIMIT_PERCENT,
  GAME_ACCOUNT_WEEKLY_NEAR_LIMIT_PERCENT,
  gameAccountStandingOf,
  gameResetInText,
  pickGameMemberAccount,
  type GameAccountUsage
} from './orchestrator-game-account-pick'

const NOW = 1_000_000
const HOUR = 3_600_000

const usage = (
  email: string,
  session: number | null,
  weekly: number | null,
  members: string[] = [],
  resetsAt: number | null = NOW + HOUR
): GameAccountUsage => ({
  provider: 'claude',
  id: `acct_${email}`,
  email,
  session: session === null ? null : { usedPercent: session, resetsAt },
  weekly: weekly === null ? null : { usedPercent: weekly, resetsAt: NOW + 48 * HOUR },
  members
})

describe('gameAccountStandingOf', () => {
  it('reads the tightest live window, and a window past its reset as empty', () => {
    expect(gameAccountStandingOf(usage('a', 20, 55), NOW)).toEqual({
      standing: 'free',
      usedPercent: 55,
      resetsAt: null
    })
    expect(gameAccountStandingOf(usage('a', 100, 10, [], NOW - 1), NOW)).toEqual({
      standing: 'free',
      usedPercent: 10,
      resetsAt: null
    })
  })

  it('is near at the threshold and limited at 100%, available again when every such window resets', () => {
    expect(gameAccountStandingOf(usage('a', GAME_ACCOUNT_NEAR_LIMIT_PERCENT, 10), NOW)).toEqual({
      standing: 'near',
      usedPercent: GAME_ACCOUNT_NEAR_LIMIT_PERCENT,
      resetsAt: NOW + HOUR
    })
    expect(gameAccountStandingOf(usage('a', 100, 95), NOW)).toEqual({
      standing: 'limited',
      usedPercent: 100,
      resetsAt: NOW + 48 * HOUR
    })
  })

  it('is near at 75% of the 7d window, so 81% weekly with days left is not free (ORCA-1028)', () => {
    expect(gameAccountStandingOf(usage('a', 10, 81), NOW)).toEqual({
      standing: 'near',
      usedPercent: 81,
      resetsAt: NOW + 48 * HOUR
    })
    expect(
      gameAccountStandingOf(usage('a', 10, GAME_ACCOUNT_WEEKLY_NEAR_LIMIT_PERCENT - 1), NOW)
    ).toEqual({ standing: 'free', usedPercent: 74, resetsAt: null })
    // Why: the 5h window keeps its own 90% line; 81% there is still free.
    expect(gameAccountStandingOf(usage('a', 81, 10), NOW).standing).toBe('free')
  })

  it('is unknown with no usage reading', () => {
    expect(gameAccountStandingOf(usage('a', null, null), NOW)).toEqual({
      standing: 'unknown',
      usedPercent: null,
      resetsAt: null
    })
  })
})

describe('an account whose member stopped on a limit', () => {
  const stopped = (resetsAt: number | null): GameAccountUsage => ({
    ...usage('a', 20, 40, ['CIN-1']),
    stopped: { resetsAt }
  })

  it('is limited until that limit resets, whatever its 5h and 7d readings say', () => {
    expect(gameAccountStandingOf(stopped(NOW + HOUR), NOW)).toEqual({
      standing: 'limited',
      usedPercent: 40,
      resetsAt: NOW + HOUR
    })
    expect(gameAccountStandingOf(stopped(null), NOW).standing).toBe('limited')
    expect(gameAccountStandingOf(stopped(NOW - 1), NOW).standing).toBe('free')
  })

  it('is skipped for a busier account that can still take a member', () => {
    const pick = pickGameMemberAccount([stopped(null), usage('b', 60, 70, ['CIN-2'])], NOW)
    expect(pick.kind === 'account' && pick.account.email).toBe('b')
  })
})

describe('pickGameMemberAccount', () => {
  it('picks the account with the most free quota', () => {
    const pick = pickGameMemberAccount(
      [usage('a', 60, 30), usage('b', 10, 20), usage('c', 5, 70)],
      NOW
    )
    expect(pick.kind === 'account' && pick.account.email).toBe('b')
  })

  it('breaks a tie (within 5 points) by the fewest members running on it', () => {
    const pick = pickGameMemberAccount(
      [usage('a', 12, 10, ['CIN-1', 'CIN-2']), usage('b', 14, 10, ['CIN-3']), usage('c', 40, 10)],
      NOW
    )
    expect(pick.kind === 'account' && pick.account.email).toBe('b')
  })

  it('skips accounts at or near their limit, and picks a known-free one over an unknown one', () => {
    const pick = pickGameMemberAccount(
      [
        usage('limited', 100, 10),
        usage('near', 92, 10),
        usage('dark', null, null),
        usage('free', 70, 60)
      ],
      NOW
    )
    expect(pick.kind === 'account' && pick.account.email).toBe('free')
  })

  it('never launches on an account with no reading: unknown is unverified, not free (ORCA-1028)', () => {
    const pick = pickGameMemberAccount(
      [usage('limited', 100, 10), usage('dark', null, null, ['CIN-1']), usage('dim', null, null)],
      NOW
    )
    expect(pick.kind).toBe('unverified')
    expect(pick.kind === 'unverified' && pick.accounts.map((one) => one.email)).toEqual([
      'dim',
      'dark'
    ])
  })

  it('neither picks 81% weekly as free nor falls through to an unread account (ORCA-1028)', () => {
    const pick = pickGameMemberAccount([usage('busy', 5, 81), usage('dark', null, null)], NOW)
    expect(pick.kind === 'unverified' && pick.accounts.map((one) => one.email)).toEqual(['dark'])
    expect(pickGameMemberAccount([usage('busy', 5, 81)], NOW)).toEqual({
      kind: 'limited',
      resetsAt: NOW + 48 * HOUR
    })
  })

  it('waits for the earliest account to come back when every one is limited or near', () => {
    expect(
      pickGameMemberAccount(
        [usage('a', 100, 10, [], NOW + 3 * HOUR), usage('b', 95, 10, [], NOW + 2 * HOUR)],
        NOW
      )
    ).toEqual({ kind: 'limited', resetsAt: NOW + 2 * HOUR })
  })

  it('has nothing to pick with no accounts', () => {
    expect(pickGameMemberAccount([], NOW)).toEqual({ kind: 'none' })
  })
})

describe('gameResetInText', () => {
  it('says how long until a reset, in hours and minutes', () => {
    expect(gameResetInText(NOW + 90 * 60_000, NOW)).toBe('in 1h 30m')
    expect(gameResetInText(NOW + 2 * HOUR, NOW)).toBe('in 2h')
    expect(gameResetInText(NOW + 59_000, NOW)).toBe('in 1m')
    expect(gameResetInText(NOW - 1, NOW)).toBe('now')
    expect(gameResetInText(null, NOW)).toBe('at an unknown time')
  })
})
