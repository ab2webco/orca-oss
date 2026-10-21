import { describe, expect, it } from 'vitest'

import { DEFAULT_GAME_CONFIG, effectiveConfigOf, gameConfigOfEnv } from '../hooks/game-config'
import { isGameTimezone } from '../hooks/game-render'
import { parseGameState } from '../hooks/game-state'
import { questCommandOf } from '../hooks/quest-policy'
import { HD_COMPACT_ROWS, HD_ROWS, hdBandRowsOf, hdRowsOf } from '../hooks/scene-hd'

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

  it('/quest render picks classic, hd or hd-compact and refuses anything else', () => {
    const unknown = (asked: string) =>
      `Unknown render "${asked}". Use /orca-game:render classic, hd or hd-compact.`
    expect(questCommandOf('render hd')).toEqual({ render: 'hd' })
    expect(questCommandOf(' RENDER Classic ')).toEqual({ render: 'classic' })
    expect(questCommandOf('render HD-Compact')).toEqual({ render: 'hd-compact' })
    expect(questCommandOf('render neon')).toEqual({ error: unknown('neon') })
    expect(questCommandOf('render')).toEqual({ error: unknown('') })
  })

  it('reads hd-compact from the launch env and from Orca live answer', () => {
    expect(gameConfigOfEnv({ ORCA_GAME_RENDER: 'hd-compact' }).render).toBe('hd-compact')
    expect(
      parseGameState(JSON.stringify({ ...STATE, config: { render: 'hd-compact' } }))?.config
    ).toEqual({ render: 'hd-compact' })
  })

  it('gives hd-compact a short band that does not grow with the pane', () => {
    expect(hdBandRowsOf('hd', 80)).toBe(hdRowsOf(80))
    for (const viewportRows of [undefined, 24, 60, 120]) {
      expect(hdBandRowsOf('hd-compact', viewportRows)).toBe(HD_COMPACT_ROWS)
    }
    expect(HD_COMPACT_ROWS).toBeLessThan(HD_ROWS)
  })

  it('validates a timezone the way Orca does', () => {
    expect(isGameTimezone('local')).toBe(true)
    expect(isGameTimezone('Europe/Madrid')).toBe(true)
    expect(isGameTimezone('Mars/Olympus')).toBe(false)
    expect(isGameTimezone('')).toBe(false)
  })
})
