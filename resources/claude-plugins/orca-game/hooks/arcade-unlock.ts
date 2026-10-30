import type { EngineInterface } from 'claude-code'

import type { GameState } from '../types'
import { openArcade } from './arcade-pane'
import { fleetRewardsOf } from './fleet-rewards'

// A member's perfect merge earns its lead one offer of a run, kept by the reward's id in $.store so
// a merge seen again (a replay, a reload) never offers twice.

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

export async function offerArcadeOnUnlock(
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
  await openArcade($, true)
}
