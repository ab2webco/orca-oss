import type { TeamXp } from '../../../../shared/team-xp-model'

type Level = Pick<TeamXp, 'level' | 'into' | 'need'>

/** One rise of the team total between two polls, as the level row plays it (ORCA-1264). */
export type TeamXpGain = {
  gained: number
  /** The level the bar fills first, then the one it lands on with the ledger's carry-over. */
  from: Level
  to: Level
  /** The newest reward the poll brought, which names the gain; null when none did. */
  reason: string | null
}

const levelOf = ({ level, into, need }: Level): Level => ({ level, into, need })

/** Null when the total did not rise, or a side predates totals. */
export function teamXpGainOf(before: TeamXp, after: TeamXp): TeamXpGain | null {
  if (before.total === undefined || after.total === undefined || after.total <= before.total) {
    return null
  }
  const seen = new Set((before.recent ?? []).map((one) => one.id))
  const fresh = (after.recent ?? []).find((one) => !seen.has(one.id))
  return {
    gained: after.total - before.total,
    from: levelOf(before),
    to: levelOf(after),
    reason: fresh?.label ?? null
  }
}

export const teamXpLeftOf = (xp: Level): number => Math.max(0, xp.need - xp.into)

export const isTeamLevelUp = (gain: TeamXpGain): boolean => gain.to.level > gain.from.level
