import type { GameMerge, GameState } from '../types'
import { isShape, oneOf, REVIEW_PROVIDERS, str } from './game-state-shapes'

// Why a cap: the host sends a short tail; a longer list is not one this mod has to read.
const MAX_MERGES = 50

const mergeOf = (value: unknown): GameMerge[] => {
  if (!isShape(value) || typeof value.number !== 'number' || !Number.isInteger(value.number)) {
    return []
  }
  const key = str(value.key)
  const worktreeId = str(value.worktreeId)
  const provider = oneOf(value.provider, REVIEW_PROVIDERS)
  if (!key || !worktreeId || provider === undefined || typeof value.perfect !== 'boolean') {
    return []
  }
  const ticket = str(value.ticket) ?? null
  return [{ key, ticket, provider, number: value.number, worktreeId, perfect: value.perfect }]
}

/** The members' merges Orca recorded; absent from an older host, so its first list awards nothing. */
export const gameMergesOf = (value: unknown): Pick<GameState, 'merges'> =>
  Array.isArray(value) ? { merges: value.slice(-MAX_MERGES).flatMap(mergeOf) } : {}
