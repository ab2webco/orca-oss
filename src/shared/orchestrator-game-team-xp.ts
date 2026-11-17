import {
  GAME_CHARACTER_XP,
  listGameCharacters,
  paidGameMergeNumbers
} from './orchestrator-game-characters'
import {
  GAME_REWARD_KINDS,
  GAME_REWARD_WEIGHT_MAX,
  type GameRewardKind,
  type GameTeamXp,
  type GameXpAward,
  type GameXpReward
} from './orchestrator-game-reward-weights'

export type { GameTeamXp, GameXpAward, GameXpReward }

// One team XP for the panel bar and the mod's score line: the characters' XP plus every reward the
// mod toasted, which it reports to the lead's host (ORCA-1264).

/** What the history file keeps under `teamXp`; `folded` is the XP of rows dropped by the cap. */
type StoredTeamXp = { folded: number; awards: GameXpAward[] }

// Why bounded: one row per reward ever; the oldest fold into one number, still counted.
const AWARDS_MAX = 1000
const RECENT_MAX = 10

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const REVIEW_ID = /^(review-merged|perfect-merge|ci-green):[a-z-]*([#!]\d+)@/

/**
 * Why drop the worktree: a lead and its member see one PR from two panes, and a merge the host
 * paid to a character is keyed by its number, so one PR must earn once whichever pane saw it.
 */
export const gameXpKeyOf = (id: string): string => {
  const found = REVIEW_ID.exec(id)
  return found ? `${found[1]}:${found[2]}` : id
}

const isXp = (xp: unknown): xp is number =>
  typeof xp === 'number' && Number.isInteger(xp) && Math.abs(xp) <= GAME_REWARD_WEIGHT_MAX

const awardOf = (raw: unknown): GameXpAward[] =>
  isRecord(raw) &&
  typeof raw.id === 'string' &&
  GAME_REWARD_KINDS.some((kind) => kind === raw.kind) &&
  isXp(raw.xp) &&
  typeof raw.label === 'string' &&
  typeof raw.at === 'number'
    ? [{ id: raw.id, kind: raw.kind as GameRewardKind, xp: raw.xp, label: raw.label, at: raw.at }]
    : []

function storedOf(raw: unknown): StoredTeamXp {
  if (!isRecord(raw)) {
    return { folded: 0, awards: [] }
  }
  return {
    folded: typeof raw.folded === 'number' && Number.isFinite(raw.folded) ? raw.folded : 0,
    awards: Array.isArray(raw.awards) ? raw.awards.flatMap(awardOf) : []
  }
}

const mergeNumberOf = (award: GameXpAward): number | null => {
  const found = award.kind === 'review-merged' ? /[#!](\d+)$/.exec(award.id) : null
  return found ? Number(found[1]) : null
}

/** An award's XP net of the merge pay its character already holds, which the award replaces. */
const netOf = (award: GameXpAward, paid: ReadonlySet<number>): number =>
  paid.has(mergeNumberOf(award) ?? -1) ? award.xp - GAME_CHARACTER_XP.merged : award.xp

/** Adds the rewards no row holds yet; `next` is null when every one was already there. */
export function awardGameTeamXp(
  raw: unknown,
  characters: Record<string, unknown>,
  rewards: readonly GameXpReward[],
  at: number
): { next: StoredTeamXp | null; added: GameXpAward[] } {
  const stored = storedOf(raw)
  const seen = new Set(stored.awards.map((one) => one.id))
  const added: GameXpAward[] = []
  for (const one of rewards) {
    const id = gameXpKeyOf(one.id)
    if (!seen.has(id)) {
      seen.add(id)
      added.push({ ...one, id, at })
    }
  }
  if (added.length === 0) {
    return { next: null, added }
  }
  const awards = [...stored.awards, ...added]
  const dropped = awards.slice(0, Math.max(0, awards.length - AWARDS_MAX))
  const paid = paidGameMergeNumbers(characters)
  return {
    next: {
      folded: stored.folded + dropped.reduce((sum, one) => sum + netOf(one, paid), 0),
      awards: awards.slice(dropped.length)
    },
    added
  }
}

/** The characters' XP plus the awards; a merge paid to a character counts at its award's XP. */
export function teamXpOf(raw: unknown, characters: Record<string, unknown>): GameTeamXp {
  const stored = storedOf(raw)
  const paid = paidGameMergeNumbers(characters)
  const own = listGameCharacters(characters).reduce((sum, one) => sum + Math.max(0, one.xp), 0)
  const awarded = stored.awards.reduce((sum, one) => sum + netOf(one, paid), 0)
  return {
    total: own + stored.folded + awarded,
    recent: stored.awards.slice(-RECENT_MAX).toReversed()
  }
}
