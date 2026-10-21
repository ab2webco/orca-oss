import { describe, expect, it } from 'vitest'

import { lightnessOf } from '../hooks/hd-lightness'
import { facingOf, materialPixel, toneRampOf, textureOf } from '../hooks/hd-material'

describe('hd materials', () => {
  it('ramps a base color into four tones from shadow to highlight', () => {
    for (const base of [0x4f8a55, 0x7cbd4b, 0x6d7f99, 0xc84c0c]) {
      const ramp = toneRampOf(base)
      expect(ramp).toHaveLength(4)
      expect(ramp[2]).toBe(base)
      const lightness = ramp.map(lightnessOf)
      expect([...lightness].sort((a, b) => a - b)).toEqual(lightness)
    }
  })

  it('gives a layer texture: a row of one material shows several tones, the same ones every frame', () => {
    const row = Array.from({ length: 120 }, (_, x) => materialPixel(0x4f8a55, x, 30, 7))
    expect(new Set(row).size).toBeGreaterThanOrEqual(3)
    expect(Array.from({ length: 120 }, (_, x) => materialPixel(0x4f8a55, x, 30, 7))).toEqual(row)
  })

  it('keeps texture noise in range and smooth between neighbours', () => {
    for (let x = 0; x < 200; x += 1) {
      const here = textureOf(x * 0.37, 5.5, 3)
      expect(here).toBeGreaterThanOrEqual(0)
      expect(here).toBeLessThanOrEqual(1)
      expect(Math.abs(textureOf(x * 0.37 + 0.05, 5.5, 3) - here)).toBeLessThan(0.2)
    }
  })

  it('lights the flank that faces the sun and shades the one that turns away', () => {
    // A peak at x=50: heights rise to its left and fall to its right; the sun sits on the right.
    const rightFlank = facingOf(10, 6, 60, 100)
    const leftFlank = facingOf(6, 10, 40, 100)
    expect(rightFlank).toBeGreaterThan(0.5)
    expect(leftFlank).toBeLessThan(0.5)
    expect(facingOf(8, 8, 40, 100)).toBe(0.5)
  })
})
