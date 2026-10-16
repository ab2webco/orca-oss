import { describe, expect, it } from 'vitest'

import {
  DEFAULT_GAME_CONFIG,
  effectiveConfigOf,
  gameConfigOfEnv,
  gameStateArgvOf,
  terminalFocusArgvOf
} from '../hooks/game-config'

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

describe('gameStateArgvOf', () => {
  it('runs the absolute CLI path Orca hands the session', () => {
    expect(gameStateArgvOf('/Applications/Orca.app/Contents/Resources/bin/orca')).toEqual([
      '/Applications/Orca.app/Contents/Resources/bin/orca',
      'game',
      'state',
      '--json'
    ])
    expect(gameStateArgvOf('C:\\Orca\\bin\\orca.exe')?.[0]).toBe('C:\\Orca\\bin\\orca.exe')
  })

  // Why: on Linux a bare `orca` is the GNOME screen reader, and a relative name resolves against the cwd.
  it('never falls back to a bare or relative command', () => {
    expect(gameStateArgvOf(undefined)).toBeUndefined()
    expect(gameStateArgvOf('')).toBeUndefined()
    expect(gameStateArgvOf('orca')).toBeUndefined()
    expect(gameStateArgvOf('bin/orca')).toBeUndefined()
  })
})

describe('terminalFocusArgvOf', () => {
  it('focuses a teammate pane through the absolute CLI path', () => {
    expect(terminalFocusArgvOf('/opt/orca/bin/orca', 'term_3f2a')).toEqual([
      '/opt/orca/bin/orca',
      'terminal',
      'focus',
      '--terminal',
      'term_3f2a',
      '--json'
    ])
  })

  it('runs nothing for a bare CLI or a handle Orca would not issue', () => {
    expect(terminalFocusArgvOf('orca', 'term_3f2a')).toBeUndefined()
    expect(terminalFocusArgvOf(undefined, 'term_3f2a')).toBeUndefined()
    expect(terminalFocusArgvOf('/opt/orca/bin/orca', '--help')).toBeUndefined()
    expect(terminalFocusArgvOf('/opt/orca/bin/orca', '')).toBeUndefined()
  })
})
