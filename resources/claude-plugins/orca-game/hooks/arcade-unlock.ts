import type { EngineInterface } from 'claude-code'

import type { GameState } from '../types'
import { arcadeWords } from './arcade-words'
import { fleetRewardsOf } from './fleet-rewards'
import { raiseTeamEvent } from './hd-team'
import { clawdReact } from './quest-runtime'

// A member's perfect merge celebrates once in its lead's scene, kept by the reward's id in $.store so
// a merge seen again (a replay, a reload) never celebrates twice. The host saves the play itself
// as a credit the Team panel spends (ORCA-1053); the terminal no longer offers one.

export const ARCADE_OFFERS_KEY = 'arcade-offers'
// Why a cap: the list only has to outlive the polls that could show one merge again.
const KEPT_OFFERS = 50

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
  const offered = arcadeOffersOf(await $.store.get(ARCADE_OFFERS_KEY).catch(() => undefined))
  const unlocked = arcadeUnlocksOf(previous, next, offered)
  if (unlocked.length === 0) {
    return
  }
  const kept = [...offered, ...unlocked].slice(-KEPT_OFFERS)
  await $.store.set(ARCADE_OFFERS_KEY, kept).catch(() => undefined)
  celebrateArcadeCredit($)
}
