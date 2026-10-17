import { describe, expect, it } from 'vitest'

import { DEFAULT_GAME_CONFIG, effectiveConfigOf, gameConfigOfEnv } from '../hooks/game-config'
import { isGameTimezone } from '../hooks/game-render'
import { parseGameState } from '../hooks/game-state'
import { questCommandOf } from '../hooks/quest-policy'

const STATE = {
  config: {},
  agents: [],
  worktree: null,
  review: null,
  workItem: null,
  links: [],
  warnings: [],
  extensions: { scenes: [] }
}

describe('the render and the clock in the mod', () => {
  it('draws classic on local time by default and reads both from the launch env', () => {
    expect(DEFAULT_GAME_CONFIG).toMatchObject({ render: 'classic', timezone: 'local' })
    expect(
      gameConfigOfEnv({ ORCA_GAME_RENDER: ' HD ', ORCA_GAME_TIMEZONE: 'America/Bogota' })
    ).toMatchObject({ render: 'hd', timezone: 'America/Bogota' })
    expect(
      gameConfigOfEnv({ ORCA_GAME_RENDER: 'neon', ORCA_GAME_TIMEZONE: 'Mars/Olympus' })
    ).toMatchObject({ render: 'classic', timezone: 'local' })
  })

  it('takes Orca live answer, and /quest render wins for the session', () => {
    const env = gameConfigOfEnv({})
    expect(effectiveConfigOf(env, { render: 'hd' }, undefined).render).toBe('hd')
    expect(effectiveConfigOf(env, { render: 'hd' }, undefined, 'classic').render).toBe('classic')
    expect(effectiveConfigOf(env, {}, 'zen', 'hd')).toMatchObject({ mode: 'zen', render: 'hd' })
  })

  it('keeps a live render and timezone only when they are valid', () => {
    const live = (config: unknown) =>
      parseGameState(JSON.stringify({ ...STATE, config }))?.config ?? {}
    expect(live({ render: 'hd', timezone: 'Asia/Tokyo' })).toEqual({
      render: 'hd',
      timezone: 'Asia/Tokyo'
    })
    expect(live({ render: 'neon', timezone: 'Nowhere/Land' })).toEqual({})
  })

  it('/quest render picks classic or hd and refuses anything else', () => {
    expect(questCommandOf('render hd')).toEqual({ render: 'hd' })
    expect(questCommandOf(' RENDER Classic ')).toEqual({ render: 'classic' })
    expect(questCommandOf('render neon')).toEqual({
      error: 'Unknown render "neon". Use /orca-game:render classic or /orca-game:render hd.'
    })
    expect(questCommandOf('render')).toEqual({
      error: 'Unknown render "". Use /orca-game:render classic or /orca-game:render hd.'
    })
  })

  it('validates a timezone the way Orca does', () => {
    expect(isGameTimezone('local')).toBe(true)
    expect(isGameTimezone('Europe/Madrid')).toBe(true)
    expect(isGameTimezone('Mars/Olympus')).toBe(false)
    expect(isGameTimezone('')).toBe(false)
  })
})
