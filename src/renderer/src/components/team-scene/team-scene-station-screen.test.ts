import { describe, expect, it } from 'vitest'
import {
  drawStationScreen,
  STATION_SCREEN_GLOW,
  stationScreenStateOf
} from './team-scene-station-screen'
import { recordingContext } from './team-scene-recording-context'

const RECT = { x: 0, y: 0, width: 28, height: 18 }

describe('station screen', () => {
  it('plays a game on the screen of a member at play with one, red CI still first', () => {
    expect(stationScreenStateOf('idle', false, 'game')).toBe('game')
    expect(stationScreenStateOf('idle', false, 'music')).toBe('off')
    expect(stationScreenStateOf('idle', true, 'game')).toBe('fail')
  })

  it('moves its game on the clock', () => {
    const at = (t: number) => {
      const r = recordingContext()
      drawStationScreen(r.g, RECT, 'game', t, {})
      return JSON.stringify(r.calls)
    }
    expect(at(0)).not.toBe(at(0.3))
  })

  it('boots a screen with a soft glow and its code lines ticking in one by one', () => {
    const lines = (boot?: number) => {
      const r = recordingContext()
      drawStationScreen(r.g, RECT, 'code', 0, boot === undefined ? {} : { boot })
      return r
    }
    const count = (r: ReturnType<typeof recordingContext>) =>
      r.calls.filter((c) => c.name === 'fillRect').length
    expect(
      lines(0.2)
        .fills()
        .concat(lines(0.2).calls.map((c) => c.fillStyle))
    ).toContain(STATION_SCREEN_GLOW)
    expect(count(lines(0.2))).toBeLessThan(count(lines(0.7)))
    expect(count(lines(0.7))).toBeLessThanOrEqual(count(lines()))
    expect(lines().calls.map((c) => c.fillStyle)).not.toContain(STATION_SCREEN_GLOW)
  })
})
