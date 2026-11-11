import { describe, expect, it } from 'vitest'
import { drawStationScreen, stationScreenStateOf } from './team-scene-station-screen'
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
      drawStationScreen(r.g, RECT, 'game', t)
      return JSON.stringify(r.calls)
    }
    expect(at(0)).not.toBe(at(0.3))
  })
})
