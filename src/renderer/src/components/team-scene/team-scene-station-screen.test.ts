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
    expect(stationScreenStateOf({ pose: 'idle', play: 'game' }, false)).toBe('game')
    expect(stationScreenStateOf({ pose: 'idle', play: 'music' }, false)).toBe('off')
    expect(stationScreenStateOf({ pose: 'idle', play: 'game' }, true)).toBe('fail')
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

  it("darkens an away member's screen with a small warning mark in the card's colour", () => {
    expect(stationScreenStateOf({ pose: 'idle', away: true }, false)).toBe('away')
    expect(stationScreenStateOf({ pose: 'idle', away: true }, true)).toBe('away')
    const r = recordingContext()
    drawStationScreen(r.g, RECT, 'away', 0, { attention: '#e5484d' })
    expect(r.fills()).toContain('#e5484d')
  })
})
