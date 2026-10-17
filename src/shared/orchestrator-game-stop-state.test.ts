import { describe, expect, it } from 'vitest'
import { gameStopRefusal, parseGameStop } from './orchestrator-game-stop-state'

describe('game STOP state', () => {
  it('reads a well-formed STOP and fails closed on anything else', () => {
    expect(parseGameStop({ since: '2026-10-16T10:00:00.000Z', by: 'lead' })).toEqual({
      since: '2026-10-16T10:00:00.000Z',
      by: 'lead'
    })
    expect(parseGameStop({ since: 'soon', by: 'lead' })).toEqual({
      since: null,
      by: null,
      unreadable: true
    })
    expect(parseGameStop('STOP')).toEqual({ since: null, by: null, unreadable: true })
  })

  it('says what is refused, since when and how it ends', () => {
    expect(gameStopRefusal({ since: '2026-10-16T10:00:00.000Z', by: 'lead' }, 'CIN-1')).toBe(
      'The project is on STOP since 2026-10-16T10:00:00.000Z (by lead): CIN-1 is refused until `orca game resume`.'
    )
    expect(gameStopRefusal({ since: null, by: null, unreadable: true }, 'the wave')).toBe(
      'The project is on STOP (its STOP state cannot be read, so it counts as set): the wave is refused until `orca game resume`.'
    )
  })
})
