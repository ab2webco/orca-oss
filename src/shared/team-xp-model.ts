import type { GameRewardWeights } from './orchestrator-game-reward-weights'

/** The team's level row (ORCA-1264); the optional facts are absent from a client built before it. */
export type TeamXp = {
  level: number
  into: number
  need: number
  /** The team total the level comes from, so a rise between two polls is the gain to play. */
  total?: number
  /** The newest rewards, newest first; the one a poll brings names its gain. */
  recent?: { id: string; label: string; xp: number }[]
  /** What each reward earns after every layer, for the row's tooltip. */
  earns?: GameRewardWeights
}
