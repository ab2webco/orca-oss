import type { GameAccountProvider } from './orchestrator-game-member-agent'

/** One quota window of a managed account; `resetsAt` is Unix ms, null when unknown. */
export type GameQuotaWindow = { usedPercent: number; resetsAt: number | null }

/** A managed account as the lead weighs it: its 5h and 7d use and the members on it. */
export type GameAccountUsage = {
  provider: GameAccountProvider
  id: string
  email: string
  /** The 5-hour window; null with no usage reading for it. */
  session: GameQuotaWindow | null
  /** The 7-day window; null with no usage reading for it. */
  weekly: GameQuotaWindow | null
  /** Tickets of the lead's members running on it. */
  members: string[]
  /** A member on it stopped on a usage or spend limit; usable again at `resetsAt`, null when unknown. */
  stopped?: { resetsAt: number | null }
}

export type GameAccountStanding = 'free' | 'near' | 'limited' | 'unknown'

// Why 90: a member's turn can burn several points of a 5h window, so a launch past it would hit the limit mid-ticket.
export const GAME_ACCOUNT_NEAR_LIMIT_PERCENT = 90
const LIMIT_PERCENT = 100
// Why 5 points: readings that close are noise, so the account with fewer members is the better pick.
const TIE_PERCENT = 5

export function gameAccountStandingOf(
  usage: Pick<GameAccountUsage, 'session' | 'weekly' | 'stopped'>,
  now: number
): { standing: GameAccountStanding; usedPercent: number | null; resetsAt: number | null } {
  const stopped = usage.stopped
  // Why first: the agent's own refusal outranks a reading that cannot see spend limits (ORCA-896).
  if (stopped && (stopped.resetsAt === null || stopped.resetsAt > now)) {
    const { usedPercent } = gameAccountStandingOf({ ...usage, stopped: undefined }, now)
    return { standing: 'limited', usedPercent, resetsAt: stopped.resetsAt }
  }
  const read = [usage.session, usage.weekly].filter(
    (window): window is GameQuotaWindow => window !== null
  )
  if (read.length === 0) {
    return { standing: 'unknown', usedPercent: null, resetsAt: null }
  }
  // Why: a window past its reset proves nothing about its use now; it starts empty.
  const live = read.filter((window) => window.resetsAt === null || window.resetsAt > now)
  const usedPercent = Math.max(0, ...live.map((window) => window.usedPercent))
  const blocking = live.filter((window) => window.usedPercent >= GAME_ACCOUNT_NEAR_LIMIT_PERCENT)
  if (blocking.length === 0) {
    return { standing: 'free', usedPercent, resetsAt: null }
  }
  // Why the latest reset: the account is usable only once every blocking window has reset.
  const resets = blocking.map((window) => window.resetsAt)
  const resetsAt = resets.includes(null) ? null : Math.max(...resets.map(Number))
  return {
    standing: usedPercent >= LIMIT_PERCENT ? 'limited' : 'near',
    usedPercent,
    resetsAt
  }
}

export type GameAccountPick =
  | { kind: 'account'; account: GameAccountUsage; standing: 'free' | 'unknown' }
  /** Every account is at or near its limit; `resetsAt` is when the first one is usable again. */
  | { kind: 'limited'; resetsAt: number | null }
  | { kind: 'none' }

const byMembersThenEmail = (a: GameAccountUsage, b: GameAccountUsage): number =>
  a.members.length - b.members.length || a.email.localeCompare(b.email)

/** The account a new member of this provider should run on (`orchestrator.accounts: auto`). */
export function pickGameMemberAccount(
  accounts: readonly GameAccountUsage[],
  now: number
): GameAccountPick {
  if (accounts.length === 0) {
    return { kind: 'none' }
  }
  const rated = accounts.map((account) => ({ account, ...gameAccountStandingOf(account, now) }))
  const free = rated
    .filter((one) => one.standing === 'free')
    .sort(
      (a, b) =>
        Math.floor((a.usedPercent ?? 0) / TIE_PERCENT) -
          Math.floor((b.usedPercent ?? 0) / TIE_PERCENT) || byMembersThenEmail(a.account, b.account)
    )
  if (free[0]) {
    return { kind: 'account', account: free[0].account, standing: 'free' }
  }
  const unknown = rated
    .filter((one) => one.standing === 'unknown')
    .map((one) => one.account)
    .sort(byMembersThenEmail)
  if (unknown[0]) {
    return { kind: 'account', account: unknown[0], standing: 'unknown' }
  }
  const resets = rated.flatMap((one) => (one.resetsAt === null ? [] : [one.resetsAt]))
  return { kind: 'limited', resetsAt: resets.length === 0 ? null : Math.min(...resets) }
}

/** "in 1h 30m" until a reset, rounded up to the minute; for the lead's and the person's text. */
export function gameResetInText(resetsAt: number | null, now: number): string {
  if (resetsAt === null) {
    return 'at an unknown time'
  }
  const minutes = Math.ceil((resetsAt - now) / 60_000)
  if (minutes <= 0) {
    return 'now'
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `in ${[hours > 0 ? `${hours}h` : '', rest > 0 ? `${rest}m` : ''].filter(Boolean).join(' ')}`
}
