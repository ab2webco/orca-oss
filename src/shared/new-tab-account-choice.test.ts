import { describe, expect, it } from 'vitest'
import type { GameAccountUsage } from './orchestrator-game-account-pick'
import { newTabAccountChoiceOf, type NewTabAccountOption } from './new-tab-account-choice'

const now = Date.parse('2026-11-10T12:00:00Z')
const free: GameAccountUsage['session'] = { usedPercent: 20, resetsAt: now + 3_600_000 }

function usage(id: string, patch: Partial<GameAccountUsage> = {}): GameAccountUsage {
  return {
    provider: 'claude',
    id,
    email: `${id}@example.test`,
    session: free,
    weekly: free,
    members: [],
    ...patch
  }
}

function option(
  account: GameAccountUsage,
  patch: Partial<Omit<NewTabAccountOption, 'usage'>> = {}
): NewTabAccountOption {
  return { usage: account, customEndpoint: false, failedLogin: false, ...patch }
}

// Why (ORCA-717): the default is the native member pick, never a new rule for the + menu.
describe('newTabAccountChoiceOf', () => {
  it('shows Own login for a provider with no managed accounts', () => {
    expect(newTabAccountChoiceOf([], now)).toEqual({ kind: 'own-login' })
  })

  it('defaults to the first free account the native member pick would choose', () => {
    const busy = usage('acct-busy', { session: { usedPercent: 60, resetsAt: null } })
    const idle = usage('acct-idle', { session: { usedPercent: 10, resetsAt: null } })

    const choice = newTabAccountChoiceOf([option(busy), option(idle)], now)

    expect(choice).toMatchObject({ kind: 'picker', defaultId: 'acct-idle' })
  })

  it('disables an account past its limit with the reason, and never defaults to it', () => {
    const limited = usage('acct-limited', {
      session: { usedPercent: 100, resetsAt: now + 1_800_000 }
    })

    const choice = newTabAccountChoiceOf([option(limited)], now)

    expect(choice).toMatchObject({
      kind: 'picker',
      defaultId: null,
      rows: [{ id: 'acct-limited', disabled: 'limited' }]
    })
  })

  it('disables an account whose sign-in failed, with its own reason', () => {
    const broken = usage('acct-broken')
    const healthy = usage('acct-ok')

    const choice = newTabAccountChoiceOf(
      [option(broken, { failedLogin: true }), option(healthy)],
      now
    )

    expect(choice).toMatchObject({
      kind: 'picker',
      defaultId: 'acct-ok',
      rows: [
        { id: 'acct-broken', disabled: 'signed-out' },
        { id: 'acct-ok', disabled: null }
      ]
    })
  })

  it('keeps an account with a member selectable and names the ticket using it', () => {
    const inUse = usage('acct-in-use', { members: ['NETSA-121'] })

    const choice = newTabAccountChoiceOf([option(inUse)], now)

    expect(choice).toMatchObject({
      kind: 'picker',
      defaultId: 'acct-in-use',
      rows: [{ id: 'acct-in-use', disabled: null, inUseBy: ['NETSA-121'] }]
    })
  })

  it('offers a custom endpoint by hand but never as the default', () => {
    const custom = usage('acct-glm', { provider: 'claude' })
    const healthy = usage('acct-ok')

    const choice = newTabAccountChoiceOf(
      [option(custom, { customEndpoint: true }), option(healthy)],
      now
    )

    expect(choice).toMatchObject({
      kind: 'picker',
      defaultId: 'acct-ok',
      rows: [
        { id: 'acct-glm', disabled: null, otherModel: true },
        { id: 'acct-ok', disabled: null, otherModel: false }
      ]
    })
  })

  it('leaves no default when only unverified quota is left', () => {
    const unread = usage('acct-unread', { session: null, weekly: null })

    const choice = newTabAccountChoiceOf([option(unread)], now)

    expect(choice).toMatchObject({ kind: 'picker', defaultId: null })
  })

  it('names a member stopped on a logged-out session as signed out, not as quota', () => {
    const loggedOut = usage('acct-logged-out', { stopped: { resetsAt: null, loggedOut: true } })

    const choice = newTabAccountChoiceOf([option(loggedOut)], now)

    expect(choice).toMatchObject({
      kind: 'picker',
      rows: [{ id: 'acct-logged-out', disabled: 'signed-out' }]
    })
  })
})
