import type { GameStoreData } from '../../shared/orchestrator-game-store-migration'
import {
  gameArcadeOfferIdsOf,
  laterGameArcadeCredits,
  migrateGameArcadeOffers,
  parseGameArcadeCredits,
  type GameArcadeCredits
} from '../../shared/orchestrator-game-arcade-credits'

// A project file's arcade fields: the ledger, and the ids of the terminal offers it already paid.

type ArcadeFields = { data: GameStoreData; arcade: Record<string, unknown> | null }

// Why top-level in the raw file: every write spreads `data` first, so the ids survive each rewrite.
const OFFERS_KEY = 'arcadeOffers'

/** `fields` is null when every offer was paid before, so the file stays as it is. */
export function migratedArcadeFields(
  current: ArcadeFields,
  offers: readonly unknown[]
): { fields: { data: GameStoreData; arcade: GameArcadeCredits } | null; paid: number } {
  const seen = gameArcadeOfferIdsOf(current.data[OFFERS_KEY])
  const migrated = migrateGameArcadeOffers(parseGameArcadeCredits(current.arcade), seen, offers)
  // Why the last id: a full list keeps its length when it takes a new one.
  const isSame = migrated.seen.at(-1) === seen.at(-1)
  return {
    fields: isSame
      ? null
      : { data: { ...current.data, [OFFERS_KEY]: migrated.seen }, arcade: migrated.next },
    paid: migrated.paid
  }
}

/** The larger ledger and both lists of paid offers, so an adoption pays nothing twice. */
export function adoptedArcadeFields(
  current: ArcadeFields,
  adopted: ArcadeFields
): { data: GameStoreData; arcade: GameArcadeCredits } {
  const paid = new Set([
    ...gameArcadeOfferIdsOf(adopted.data[OFFERS_KEY]),
    ...gameArcadeOfferIdsOf(current.data[OFFERS_KEY])
  ])
  return {
    data: { ...current.data, [OFFERS_KEY]: [...paid] },
    arcade: laterGameArcadeCredits(
      parseGameArcadeCredits(current.arcade),
      parseGameArcadeCredits(adopted.arcade)
    )
  }
}
