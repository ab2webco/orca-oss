import { describe, expect, it } from 'vitest'
import type { BandMember } from './band-scene'
import {
  cameraAt,
  DEPTH,
  fogAt,
  memberPoseOf,
  memberRectOf,
  memberXsOf,
  particleOf,
  particlesShownOf,
  screenOf,
  sunDiscOf
} from './hd2d-layout'

const member = (overrides: Partial<BandMember>): BandMember => ({
  key: 'a',
  name: 'a',
  isLead: false,
  state: 'working',
  lives: 3,
  benched: false,
  lifeChange: null,
  ticket: '',
  review: '',
  hurt: false,
  ...overrides
})

const view = { cssWidth: 1440, cssHeight: 170, pixels: 20 }

describe('hd2d camera walk', () => {
  it('starts half a far-layer screen in, at the band middle height', () => {
    const camera = cameraAt(0, { pixels: 20, ground: 17, aspect: 8 })
    expect(camera).toEqual({ x: 208, y: 7, width: 160 })
  })

  it('walks 3.5 hd pixels a second and loops before the mid layer runs out', () => {
    expect(cameraAt(1000, { pixels: 20, ground: 17, aspect: 8 }).x).toBeCloseTo(211.5)
    // span = 1600 * 1.6 - 208 - 160 * 1.6 = 2096
    const wrapped = ((2096 + 7) / 3.5) * 1000
    expect(cameraAt(wrapped, { pixels: 20, ground: 17, aspect: 8 }).x).toBeCloseTo(215)
  })
})

describe('hd2d member layout', () => {
  const camera = { x: 208, y: 7, width: 160 }

  it('puts the lead ahead and the followers behind at a capped pitch', () => {
    const members = [{ isLead: false }, { isLead: true }, { isLead: false }]
    const xs = memberXsOf(members, camera)
    expect(xs[1]).toBeCloseTo(220.8)
    expect(xs[0]).toBeCloseTo(207.8)
    expect(xs[2]).toBeCloseTo(194.8)
  })

  it('tightens the pitch when the band would not fit', () => {
    const members = Array.from({ length: 20 }, (_, i) => ({ isLead: i === 0 }))
    const xs = memberXsOf(members, camera)
    expect((xs[1] ?? 0) - (xs[2] ?? 0)).toBeCloseTo(6.4)
  })

  it('projects the characters plane so feet land on the ground line', () => {
    expect(screenOf({ x: 208, y: 7 }, view, 208, 0)).toEqual({ x: 720, y: 144.5 })
    const far = screenOf({ x: 208, y: 7 }, view, 218, 7, DEPTH * 2)
    expect(far).toEqual({ x: 762.5, y: 85 })
  })

  it('boxes a member from its feet to just above its sprite', () => {
    expect(memberRectOf('k', 208, 14, { x: 208, y: 7 }, view)).toEqual({
      key: 'k',
      x: 669,
      y: 8.5,
      width: 102,
      height: 136
    })
  })
})

describe('hd2d member pose', () => {
  it('bobs on the walk step while working', () => {
    expect(memberPoseOf(member({ state: 'working' }), 440, 1)).toEqual({
      step: 3,
      isSitting: false,
      isBenched: false,
      lift: 1
    })
  })

  it('hops while waiting and sits when idle, done or benched', () => {
    expect(memberPoseOf(member({ state: 'waiting' }), (260 * Math.PI) / 2, 0).lift).toBeCloseTo(3)
    expect(memberPoseOf(member({ state: 'idle' }), 0, 0).isSitting).toBe(true)
    expect(memberPoseOf(member({ state: 'done' }), 0, 0).isSitting).toBe(true)
    const benched = memberPoseOf(member({ benched: true }), 0, 0)
    expect(benched.isSitting && benched.isBenched).toBe(true)
  })
})

describe('hd2d particles', () => {
  it('rains from the top on a CI failure', () => {
    const one = particleOf({ i: 1, t: 0, raining: true, merged: false, pixels: 20, width: 160 })
    expect(one.x).toBeCloseTo(68.723, 2)
    expect(one.y).toBeCloseTo(1.34, 2)
    expect(one.distance).toBe(74)
    expect(one.color).toBe(0x9fb4e6)
  })

  it('floats fireflies at night and confetti on a merge', () => {
    const night = particleOf({ i: 1, t: 0, raining: false, merged: false, pixels: 20, width: 160 })
    expect(night.y).toBeCloseTo(-1.151, 2)
    expect(night.color).toBe(0xfff6a0)
    const confetti = particleOf({
      i: 2,
      t: 0,
      raining: false,
      merged: true,
      pixels: 20,
      width: 160
    })
    expect(confetti.color).toBe(0xff7ab8)
    expect(confetti.distance).toBe(DEPTH - 12)
  })

  it('shows only on a failure, a merge or at night', () => {
    expect(particlesShownOf({ ci: 'success', merged: false }, 0.2)).toBe(false)
    expect(particlesShownOf({ ci: 'failure', merged: false }, 0)).toBe(true)
    expect(particlesShownOf({ ci: 'none', merged: true }, 0)).toBe(true)
    expect(particlesShownOf({ ci: 'none', merged: false }, 0.8)).toBe(true)
  })
})

describe('hd2d sky', () => {
  it('places the sun disc from its column and row, at least five pixels wide', () => {
    expect(sunDiscOf({ x: 800, y: 4 }, 20, 8)).toEqual({ x: 0, y: 6, size: 6 })
    expect(sunDiscOf({ x: 1200, y: 4 }, 10, 8).x).toBeCloseTo(20)
    expect(sunDiscOf({ x: 1200, y: 4 }, 10, 8).size).toBe(5)
  })

  it('fogs like three: smoothstep between 1.25 and 5.2 depths', () => {
    expect(fogAt(DEPTH)).toBe(0)
    expect(fogAt(DEPTH * 6)).toBe(1)
    expect(fogAt(DEPTH * 2.6)).toBeCloseTo(0.2706, 3)
  })
})
