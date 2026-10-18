import { describe, expect, it } from 'vitest'

import { daylightAt, duskOf, hourOf, nightnessOf } from '../hooks/hd-daylight'
import { flashInto, flashOf, floatingRowOf, particleKindOf, particlesInto } from '../hooks/hd-fx'
import { marchesOf, marchShiftOf, MARCH_TICKS } from '../hooks/hd-party'
import { hdHeroPoseOf } from '../hooks/scene-hd'

const NOON_BOGOTA = Date.UTC(2026, 9, 16, 17, 0)

describe('day and night', () => {
  it('reads the hour on the project’s clock, or the machine’s', () => {
    expect(hourOf(NOON_BOGOTA, 'America/Bogota')).toBe(12)
    expect(hourOf(NOON_BOGOTA, 'Asia/Tokyo')).toBe(2)
    expect(hourOf(Date.UTC(2026, 9, 16, 17, 30), 'UTC')).toBe(17.5)
    const local = new Date(NOON_BOGOTA)
    expect(hourOf(NOON_BOGOTA, 'local')).toBe(local.getHours() + local.getMinutes() / 60)
    expect(hourOf(NOON_BOGOTA, 'Mars/Olympus')).toBe(hourOf(NOON_BOGOTA, 'local'))
  })

  it('is dark from 19 to 5, light from 7 to 17, and orange around 6 and 18', () => {
    expect(nightnessOf(12)).toBe(0)
    expect(nightnessOf(22)).toBe(1)
    expect(nightnessOf(18)).toBe(0.5)
    expect(duskOf(18)).toBe(1)
    expect(duskOf(12)).toBe(0)
    expect(daylightAt(22)).toEqual({ night: 1, dusk: 0, hour: 22 })
  })
})

describe('light and particles', () => {
  it('gives each scene and moment its particles, inside the scene', () => {
    expect(particleKindOf('vigilante', 0, false)).toBe('snow')
    expect(particleKindOf('jrpg', 0, false)).toBe('glitter')
    expect(particleKindOf('quest', 1, false)).toBe('fireflies')
    expect(particleKindOf('quest', 0, false)).toBe('dust')
    expect(particleKindOf('tamer', 0, true)).toBe('embers')
    for (const kind of ['dust', 'fireflies', 'snow', 'embers', 'glitter'] as const) {
      const buf = new Uint32Array(60 * 20)
      particlesInto(buf, 60, 20, 17, 7, kind, 20)
      expect(buf.length).toBe(1200)
    }
    const snow = new Uint32Array(60 * 20)
    particlesInto(snow, 60, 20, 17, 7, 'snow')
    expect(snow.some((color) => color === 0xf2f5ff)).toBe(true)
  })

  it('flashes a reaction', () => {
    const flash = new Uint32Array(4).fill(0x000000)
    flashInto(flash, 0xffffff, flashOf('merged', 0))
    expect(flash[0]).not.toBe(0)
    expect(flashOf('merged', 9)).toBe(0)
    expect(floatingRowOf(4, 0)).toBe(4)
    expect(floatingRowOf(4, 9)).toBe(2)
  })
})

describe('motion', () => {
  it('walks in four frames: two leg poses, each up and down', () => {
    const poses = new Set([0, 2, 4, 6].map((tick) => JSON.stringify(hdHeroPoseOf(tick, false))))
    expect(poses.size).toBe(4)
    expect(hdHeroPoseOf(3, true).bob).toBe(0)
  })

  it('marches a new member in from the right edge and a gone one out', () => {
    const marches = marchesOf(['a', 'b'], ['b', 'c'], new Map(), 100)
    expect(marches.get('c')).toEqual({ kind: 'in', at: 100 })
    expect(marches.get('a')).toEqual({ kind: 'out', at: 100 })
    expect(marchShiftOf(marches.get('c'), 100, 40)).toBe(40)
    expect(marchShiftOf(marches.get('c'), 100 + MARCH_TICKS, 40)).toBe(0)
    expect(marchShiftOf(marches.get('a'), 100 + MARCH_TICKS / 2, 40)).toBe(20)
    expect(marchesOf(['b'], ['b'], marches, 100 + MARCH_TICKS).size).toBe(0)
  })
})
