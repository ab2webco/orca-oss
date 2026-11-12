import { creditGameMerge, settleClosedReview } from '../../shared/orchestrator-game-characters'
import { parseGameHistoryRecord } from '../../shared/orchestrator-game-history'
import {
  lateReviewChecksOf,
  type GameLateReviewCheck
} from '../../shared/orchestrator-game-late-merges'
import type { GameHistoryStore } from './orchestrator-game-history-store'

// What a project's characters earn from merges, kept in the history store's file (ORCA-1170).

/** Whose character a merged event pays, and for which PR. */
export type GameMergeCredit = { character: { key: string; name: string }; number: number }

/** Pays a merged PR to its character; false when that PR was already paid. */
export function payGameMerge(
  store: GameHistoryStore,
  projectKey: string,
  credit: GameMergeCredit,
  merge: { ticket: string; at: string }
): Promise<boolean> {
  return store.changeCharacters(projectKey, (characters) => {
    const next = creditGameMerge(characters, credit.character, { ...merge, number: credit.number })
    return { next, result: next !== null }
  })
}

/** Marks a PR that closed unmerged, so no later look reads it again. */
export function settleClosedGameReview(
  store: GameHistoryStore,
  projectKey: string,
  check: GameLateReviewCheck
): Promise<void> {
  return store.changeCharacters(projectKey, (characters) => {
    const next = settleClosedReview(characters, check.character, check)
    return { next: next === characters ? null : next, result: undefined }
  })
}

/** Freed members' PRs that were open when they left and that no merge or close settled since. */
export function lateGameReviewChecks(
  store: GameHistoryStore,
  projectKey: string,
  keyOf: (name: string) => string
): Promise<GameLateReviewCheck[]> {
  return store.changeCharacters(projectKey, (characters, records) => ({
    next: null,
    result: lateReviewChecksOf(
      records.flatMap((one) => parseGameHistoryRecord(one) ?? []),
      characters,
      keyOf
    )
  }))
}
