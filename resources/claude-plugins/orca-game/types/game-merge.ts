import type { GameReview } from './index'

/** A member's merge as Orca recorded it, which outlives the member's row (ORCA-887). */
export type GameMerge = {
  /** The game event's key, one per merge. */
  key: string
  ticket: string | null
  provider: GameReview['provider']
  number: number
  worktreeId: string
  perfect: boolean
}
