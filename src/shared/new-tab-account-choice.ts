import {
  gameAccountStandingOf,
  pickGameMemberAccount,
  type GameAccountUsage
} from './orchestrator-game-account-pick'

export type NewTabAccountOption = {
  usage: GameAccountUsage
  customEndpoint: boolean
  failedLogin: boolean
}

export type NewTabAccountDisabled = 'limited' | 'signed-out'

export type NewTabAccountRow = {
  id: string
  email: string
  disabled: NewTabAccountDisabled | null
  inUseBy: string[]
  otherModel: boolean
  /** The highest live window's use; null with no reading. */
  usedPercent: number | null
}

export type NewTabAccountChoice =
  | { kind: 'own-login' }
  | { kind: 'picker'; defaultId: string | null; rows: NewTabAccountRow[] }

// Why: the default is the native member pick, so the + menu never invents its own rule (ORCA-717).
export function newTabAccountChoiceOf(
  options: readonly NewTabAccountOption[],
  now: number
): NewTabAccountChoice {
  if (options.length === 0) {
    return { kind: 'own-login' }
  }
  const eligible = options
    .filter((option) => !option.customEndpoint && !option.failedLogin)
    .map((option) => option.usage)
  const pick = pickGameMemberAccount(eligible, now)
  return {
    kind: 'picker',
    defaultId: pick.kind === 'account' ? pick.account.id : null,
    rows: options.map((option) => ({
      id: option.usage.id,
      email: option.usage.email,
      disabled: disabledOf(option, now),
      inUseBy: option.usage.members,
      otherModel: option.customEndpoint,
      usedPercent: gameAccountStandingOf(option.usage, now).usedPercent
    }))
  }
}

function disabledOf(option: NewTabAccountOption, now: number): NewTabAccountDisabled | null {
  // Why: a member stopped on /login reads 'limited' in the standing, but the fix is a sign-in.
  if (option.failedLogin || option.usage.stopped?.loggedOut) {
    return 'signed-out'
  }
  if (option.customEndpoint) {
    return null
  }
  return gameAccountStandingOf(option.usage, now).standing === 'limited' ? 'limited' : null
}
