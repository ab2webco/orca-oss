import { describe, expect, it } from 'vitest'

import { DEFAULT_GAME_CONFIG, effectiveConfigOf, gameConfigOfEnv } from '../hooks/game-config'

describe('gameConfigOfEnv', () => {
  it('defaults to quest mode on with the HUD and rewards', () => {
    expect(gameConfigOfEnv({})).toEqual({ mode: 'on', scene: 'quest', hud: true, rewards: true })
    expect(DEFAULT_GAME_CONFIG).toEqual(gameConfigOfEnv({}))
  })

  it('reads every ORCA_GAME_* variable', () => {
    expect(
      gameConfigOfEnv({
        ORCA_GAME_MODE: 'ZEN',
        ORCA_GAME_SCENE: 'space',
        ORCA_GAME_HUD: '0',
        ORCA_GAME_REWARDS: 'false'
      })
    ).toEqual({ mode: 'zen', scene: 'space', hud: false, rewards: false })
    expect(gameConfigOfEnv({ ORCA_GAME_HUD: '1', ORCA_GAME_REWARDS: 'true' })).toMatchObject({
      hud: true,
      rewards: true
    })
  })

  it('ignores values it cannot read', () => {
    expect(
      gameConfigOfEnv({
        ORCA_GAME_MODE: 'loud',
        ORCA_GAME_SCENE: '  ',
        ORCA_GAME_HUD: 'maybe',
        ORCA_GAME_REWARDS: undefined
      })
    ).toEqual(DEFAULT_GAME_CONFIG)
  })
})

describe('effectiveConfigOf', () => {
  it('layers the env, then what Orca reports live, then the /quest override', () => {
    const env = gameConfigOfEnv({ ORCA_GAME_MODE: 'zen' })
    expect(effectiveConfigOf(env, { hud: false }, undefined)).toEqual({
      ...env,
      hud: false
    })
    expect(effectiveConfigOf(env, { mode: 'off' }, undefined).mode).toBe('off')
    expect(effectiveConfigOf(env, { mode: 'off' }, 'on').mode).toBe('on')
  })
})
