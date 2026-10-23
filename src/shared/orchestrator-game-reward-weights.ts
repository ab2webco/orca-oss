/** The facts the game awards XP for; the bundled mod keeps the same ids. */
export const GAME_REWARD_KINDS = [
  'review-merged',
  'ci-green',
  'work-item-review',
  'work-item-done',
  'member-claimed'
] as const

export type GameRewardKind = (typeof GAME_REWARD_KINDS)[number]

export type GameRewardWeights = Record<GameRewardKind, number>

export const DEFAULT_GAME_REWARD_WEIGHTS: Readonly<GameRewardWeights> = {
  'review-merged': 100,
  'ci-green': 20,
  'work-item-review': 50,
  'work-item-done': 70,
  'member-claimed': 10
}

export const GAME_REWARD_WEIGHT_MAX = 1000

const at = (key: string): string => `orchestratorGame.rewardWeights.${key}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRewardKind = (key: string): key is GameRewardKind =>
  (GAME_REWARD_KINDS as readonly string[]).includes(key)

export const isGameRewardWeight = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= GAME_REWARD_WEIGHT_MAX

/** A layer's `rewardWeights`; 0 turns a reward off, and a bad value keeps that reward's default. */
export function parseGameRewardWeights(raw: unknown): {
  value: Partial<GameRewardWeights> | undefined
  warnings: string[]
} {
  if (!isRecord(raw)) {
    return { value: undefined, warnings: ['orchestratorGame.rewardWeights must be a mapping'] }
  }
  const value: Partial<GameRewardWeights> = {}
  const warnings: string[] = []
  for (const [key, entry] of Object.entries(raw)) {
    if (!isRewardKind(key)) {
      warnings.push(`${at(key)} is not a known reward`)
    } else if (isGameRewardWeight(entry)) {
      value[key] = entry
    } else {
      warnings.push(`${at(key)} must be a whole number from 0 to ${GAME_REWARD_WEIGHT_MAX}`)
    }
  }
  return { value, warnings }
}

// Why key by key: a project tunes one reward in orca.yaml while a dev turns another off in Settings.
export function resolveGameRewardWeights(
  layers: readonly (Partial<GameRewardWeights> | undefined)[]
): GameRewardWeights {
  const weights: GameRewardWeights = { ...DEFAULT_GAME_REWARD_WEIGHTS }
  for (const layer of layers) {
    Object.assign(weights, layer === undefined ? undefined : parseGameRewardWeights(layer).value)
  }
  return weights
}
