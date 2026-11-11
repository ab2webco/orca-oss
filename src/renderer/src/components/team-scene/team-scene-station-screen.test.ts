import type { TeamSceneDesk } from '../../../../shared/team-scene/team-scene-desk'
import { describe, expect, it } from 'vitest'
import {
  drawStationScreen,
  STATION_SCREEN_GLOW,
  STATION_SCREEN_PASS,
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

  it("shows a working member's desk, after red CI and before plain code", () => {
    const plan = { kind: 'plan' as const }
    expect(stationScreenStateOf({ pose: 'work', desk: plan }, false)).toBe('desk')
    expect(stationScreenStateOf({ pose: 'work', desk: plan }, true)).toBe('fail')
    expect(stationScreenStateOf({ pose: 'idle', desk: plan }, false)).toBe('off')
    expect(stationScreenStateOf({ pose: 'work' }, false)).toBe('code')
  })

  it('draws each desk its own way, and the queue place as its number', () => {
    const shape = (desk: TeamSceneDesk) => {
      const r = recordingContext()
      drawStationScreen(r.g, RECT, 'desk', 1, { desk })
      return r
    }
    const desks = [
      { kind: 'plan' as const },
      { kind: 'tests' as const },
      { kind: 'checks' as const },
      { kind: 'review' as const, verdict: 'approved' as const },
      { kind: 'review' as const, verdict: 'changes' as const },
      { kind: 'review' as const, verdict: 'waiting' as const },
      { kind: 'queue' as const, position: 3 }
    ]
    const drawn = desks.map((desk) => JSON.stringify(shape(desk).calls))
    expect(new Set(drawn).size).toBe(desks.length)
    const queue = shape({ kind: 'queue', position: 3 }).calls
    expect(queue.some((c) => c.name === 'fillText' && c.args[0] === '#3')).toBe(true)
  })

  it('reads checks and a review at 320: a thick progress bar, and a tick or empty box as big as a ticket', () => {
    const draw = (desk: TeamSceneDesk, t = 1.4) => {
      const r = recordingContext()
      drawStationScreen(r.g, RECT, 'desk', t, { desk })
      return r.calls
    }
    const bar = draw({ kind: 'checks' }).find(
      (c) => c.name === 'fillRect' && c.fillStyle === '#ffd24a'
    )
    expect(bar!.args[3] as number).toBeGreaterThanOrEqual(RECT.height * 0.22)
    // The tick and the empty box are strokes across most of the screen, like the queue ticket.
    const span = (calls: ReturnType<typeof draw>) => {
      const xs = calls
        .filter((c) => c.name === 'moveTo' || c.name === 'lineTo' || c.name === 'strokeRect')
        .map((c) => c.args[0] as number)
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(span(draw({ kind: 'review', verdict: 'approved' }))).toBeGreaterThanOrEqual(
      RECT.width * 0.35
    )
    const empty = draw({ kind: 'review', verdict: 'waiting' })
    const box = empty.find((c) => c.name === 'strokeRect')
    expect((box?.args[2] as number) ?? 0).toBeGreaterThanOrEqual(RECT.width * 0.3)
  })

  it('names why a held member cannot work on its screen, before red CI, its away seat first', () => {
    expect(stationScreenStateOf({ pose: 'idle', hold: 'limited' }, true)).toBe('hold')
    expect(stationScreenStateOf({ pose: 'idle', hold: 'limited', away: true }, false)).toBe('away')
    const holds = ['limited', 'asleep', 'loggedOut', 'unreachable', 'queued', 'starting'] as const
    const drawn = holds.map((hold) => {
      const r = recordingContext()
      drawStationScreen(r.g, RECT, 'hold', 1, { hold, attention: '#e5484d', risk: '#f5b342' })
      return r
    })
    expect(new Set(drawn.map((r) => JSON.stringify(r.calls))).size).toBe(holds.length)
    // The card's own colours: a limit is a risk, a lost login needs you.
    expect(drawn[0]!.calls.map((c) => c.fillStyle)).toContain('#f5b342')
    expect(drawn[2]!.calls.map((c) => c.fillStyle)).toContain('#e5484d')
  })

  it('flashes a screen green with a tick for a moment as its CI passes', () => {
    const fills = (green?: number) => {
      const r = recordingContext()
      drawStationScreen(r.g, RECT, 'code', 0, green === undefined ? {} : { green })
      return r.calls.map((c) => c.fillStyle)
    }
    expect(fills(0.1)).toContain(STATION_SCREEN_PASS)
    expect(fills()).not.toContain(STATION_SCREEN_PASS)
  })
})
