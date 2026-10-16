import type { GameConfig, GameMode } from '../types'
import { isQuestMode } from './quest-policy'
import { DEFAULT_SCENE_ID } from './scenes/index'

export const DEFAULT_GAME_CONFIG: GameConfig = {
  mode: 'on',
  scene: DEFAULT_SCENE_ID,
  hud: true,
  rewards: true
}

export const GAME_ENV_KEYS = [
  'ORCA_GAME_MODE',
  'ORCA_GAME_SCENE',
  'ORCA_GAME_HUD',
  'ORCA_GAME_REWARDS'
] as const

export type GameEnv = Partial<Record<(typeof GAME_ENV_KEYS)[number], string | null | undefined>>

const flagOf = (value: string | null | undefined, fallback: boolean): boolean => {
  const said = value?.trim().toLowerCase()
  if (said === '1' || said === 'true') {
    return true
  }
  return said === '0' || said === 'false' ? false : fallback
}

export const gameConfigOfEnv = (env: GameEnv): GameConfig => {
  const mode = env.ORCA_GAME_MODE?.trim().toLowerCase()
  const scene = env.ORCA_GAME_SCENE?.trim() ?? ''
  return {
    mode: isQuestMode(mode) ? mode : DEFAULT_GAME_CONFIG.mode,
    scene: scene === '' ? DEFAULT_GAME_CONFIG.scene : scene,
    hud: flagOf(env.ORCA_GAME_HUD, DEFAULT_GAME_CONFIG.hud),
    rewards: flagOf(env.ORCA_GAME_REWARDS, DEFAULT_GAME_CONFIG.rewards)
  }
}

// The env is the launch snapshot, Orca's live answer can change since, and /quest wins for the session.
export const effectiveConfigOf = (
  env: GameConfig,
  live: Partial<GameConfig>,
  modeOverride: GameMode | undefined
): GameConfig => ({
  ...env,
  ...live,
  ...(modeOverride === undefined ? {} : { mode: modeOverride })
})

const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/

// Why: on Linux a bare `orca` is the GNOME screen reader; only the absolute path Orca hands over is run.
export const gameStateArgvOf = (cli: string | null | undefined): readonly string[] | undefined => {
  const path = cli?.trim() ?? ''
  return ABSOLUTE_PATH.test(path) ? [path, 'game', 'state', '--json'] : undefined
}
