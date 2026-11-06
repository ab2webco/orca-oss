import type { EngineInterface } from 'claude-code'

import type { GameState } from '../types'
import { arcadeWords } from './arcade-words'
import { fleetRewardsOf } from './fleet-rewards'
import { raiseTeamEvent } from './hd-team'
import { clawdReact } from './quest-runtime'

// A member's perfect merge celebrates once in its lead's scene, kept by the reward's id in $.store so
// a merge seen again (a replay, a reload) never celebrates twice. The host saves the play itself
// as a credit the Team panel spends (ORCA-1053); the terminal no longer offers one.

export const ARCADE_CHEERS_KEY = 'arcade-cheers'
/** What the old 15-second countdown offered; read-only now, and paid once by the host. */
export const ARCADE_OFFERS_KEY = 'arcade-offers'
export const ARCADE_OFFERS_MIGRATED_KEY = 'arcade-offers-migrated'
// Why a cap: the list only has to outlive the polls that could show one merge again.
const KEPT_CHEERS = 50

export const arcadeOffersOf = (stored: unknown): string[] =>
  Array.isArray(stored) ? stored.filter((one): one is string => typeof one === 'string') : []

/** The ids of the members' merges the host newly called perfect, not offered yet. */
export const arcadeUnlocksOf = (
  previous: GameState | null,
  next: GameState,
  offered: readonly string[]
): string[] =>
  fleetRewardsOf(previous, next)
    .filter((one) => one.kind === 'perfect-merge' && !offered.includes(one.id))
    .map((one) => one.id)

/** The scene's cheer for a saved play; the demo shows it too. */
export function celebrateArcadeCredit($: EngineInterface): void {
  raiseTeamEvent($, 'merged', arcadeWords().saved)
  clawdReact($, 'level')
}

export async function celebrateArcadeOnUnlock(
  $: EngineInterface,
  previous: GameState | null,
  next: GameState
): Promise<void> {
  const cheered = arcadeOffersOf(await $.store.get(ARCADE_CHEERS_KEY).catch(() => undefined))
  const offered = arcadeOffersOf(await $.store.get(ARCADE_OFFERS_KEY).catch(() => undefined))
  const unlocked = arcadeUnlocksOf(previous, next, [...offered, ...cheered])
  if (unlocked.length === 0) {
    return
  }
  await $.store
    .set(ARCADE_CHEERS_KEY, [...cheered, ...unlocked].slice(-KEPT_CHEERS))
    .catch(() => undefined)
  celebrateArcadeCredit($)
}

// Module state: one try per session, so an Orca too old to take them is not asked every poll.
let isMigrationTried = false

/**
 * Sends the offers the old countdown kept to the host once, which pays each as a saved play. Only a
 * confirmed answer marks them sent; an older Orca, or none at all, leaves them for a later session.
 */
export async function migrateKeptArcadeOffers(
  $: EngineInterface,
  next: GameState,
  send: (offers: readonly string[]) => Promise<boolean>
): Promise<void> {
  if (isMigrationTried || next.role === 'member') {
    return
  }
  isMigrationTried = true
  if ((await $.store.get(ARCADE_OFFERS_MIGRATED_KEY).catch(() => undefined)) === true) {
    return
  }
  const offers = arcadeOffersOf(await $.store.get(ARCADE_OFFERS_KEY).catch(() => undefined))
  if (offers.length > 0 && (await send(offers))) {
    await $.store.set(ARCADE_OFFERS_MIGRATED_KEY, true).catch(() => undefined)
  }
}
