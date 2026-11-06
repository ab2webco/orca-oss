import type { GameEventMerge } from './orchestrator-game-events'
import type { GameReview } from './orchestrator-game-state'

/** The perfect merge the panel congratulates until the person plays or keeps its credit. */
export type GameArcadeOffer = {
  provider: GameReview['provider']
  number: number
}

/** A project's saved arcade plays, kept on the host's board so every client sees one count. */
export type GameArcadeCredits = {
  credits: number
  offer: GameArcadeOffer | null
}

export const GAME_ARCADE_ACTIONS = ['play', 'keep'] as const

export type GameArcadeAction = (typeof GAME_ARCADE_ACTIONS)[number]

// Why a cap: a credit is a treat, and a busy month of merges should not read as a backlog.
export const GAME_ARCADE_CREDITS_MAX = 9

export const NO_GAME_ARCADE_CREDITS: GameArcadeCredits = {
  credits: 0,
  offer: null
}

const PROVIDERS: readonly GameReview['provider'][] = [
  'github',
  'gitlab',
  'bitbucket',
  'azure-devops',
  'gitea'
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const offerOf = (raw: unknown): GameArcadeOffer | null =>
  isRecord(raw) &&
  PROVIDERS.some((one) => one === raw.provider) &&
  Number.isInteger(raw.number) &&
  (raw.number as number) > 0
    ? {
        provider: raw.provider as GameReview['provider'],
        number: raw.number as number
      }
    : null

/** The ledger as the store keeps it; anything this build cannot read counts as none. */
export function parseGameArcadeCredits(raw: unknown): GameArcadeCredits {
  if (!isRecord(raw) || typeof raw.credits !== 'number' || !(raw.credits >= 0)) {
    return NO_GAME_ARCADE_CREDITS
  }
  return {
    credits: Math.min(GAME_ARCADE_CREDITS_MAX, Math.floor(raw.credits)),
    offer: offerOf(raw.offer)
  }
}

export function earnGameArcadeCredit(
  current: GameArcadeCredits,
  merge: GameEventMerge
): GameArcadeCredits {
  if (!merge.perfect) {
    return current
  }
  return {
    credits: Math.min(GAME_ARCADE_CREDITS_MAX, current.credits + 1),
    offer: { provider: merge.provider, number: merge.number }
  }
}

/** `ok` is false only for a play with no credit left. */
export function applyGameArcadeAction(
  current: GameArcadeCredits,
  action: GameArcadeAction
): { ok: boolean; next: GameArcadeCredits } {
  if (action === 'keep') {
    return { ok: true, next: { ...current, offer: null } }
  }
  if (current.credits < 1) {
    return { ok: false, next: current }
  }
  return { ok: true, next: { credits: current.credits - 1, offer: null } }
}

// Why bounded: a terminal kept at most 50 offers, and a second migration is refused by the mod's own flag.
export const GAME_ARCADE_MIGRATED_MAX = 500
const OFFER_ID_MAX = 200

/** Stored migrated offer ids; anything else in the list is dropped. */
export const gameArcadeOfferIdsOf = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? raw.filter(
        (one): one is string =>
          typeof one === 'string' && one.length > 0 && one.length <= OFFER_ID_MAX
      )
    : []

/**
 * The offers the terminal's old 15-second countdown kept, each paid once up to the cap. Every one is
 * recorded, the ones past the cap too, so a later migration pays none of them.
 */
export function migrateGameArcadeOffers(
  current: GameArcadeCredits,
  seen: readonly string[],
  offered: readonly unknown[]
): { next: GameArcadeCredits; seen: string[]; paid: number } {
  const known = new Set(seen)
  const fresh = [...new Set(gameArcadeOfferIdsOf(offered))].filter((one) => !known.has(one))
  const credits = Math.min(GAME_ARCADE_CREDITS_MAX, current.credits + fresh.length)
  return {
    next: { ...current, credits },
    seen: [...seen, ...fresh].slice(-GAME_ARCADE_MIGRATED_MAX),
    paid: credits - current.credits
  }
}

/** Two projects' ledgers folded into one: the larger, so a repeated adoption adds nothing. */
export function laterGameArcadeCredits(
  current: GameArcadeCredits,
  adopted: GameArcadeCredits
): GameArcadeCredits {
  return adopted.credits > current.credits ? adopted : current
}
