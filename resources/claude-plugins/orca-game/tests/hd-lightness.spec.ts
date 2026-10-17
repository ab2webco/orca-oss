import { describe, expect, it } from 'vitest'

import { lightnessOf, luminanceOf, withLuminance } from '../hooks/hd-lightness'

describe('hd lightness', () => {
  it('measures relative luminance and CIE lightness', () => {
    expect(luminanceOf(0xffffff)).toBeCloseTo(1, 5)
    expect(luminanceOf(0x000000)).toBe(0)
    expect(luminanceOf(0x808080)).toBeCloseTo(0.2159, 3)
    expect(lightnessOf(0x777777)).toBeCloseTo(50, 0)
    expect(lightnessOf(0xffffff)).toBeCloseTo(100, 3)
  })

  it('moves a colour to a luminance, never past it, keeping its hue', () => {
    const darker = withLuminance(0x4fc3f7, 0.03)
    expect(luminanceOf(darker)).toBeLessThanOrEqual(0.03)
    expect(luminanceOf(darker)).toBeGreaterThan(0.025)
    expect(darker & 0xff).toBeGreaterThan((darker >> 16) & 0xff)
    const lighter = withLuminance(0x101828, 0.1)
    expect(luminanceOf(lighter)).toBeGreaterThanOrEqual(0.1)
    expect(luminanceOf(lighter)).toBeLessThan(0.105)
  })
})
