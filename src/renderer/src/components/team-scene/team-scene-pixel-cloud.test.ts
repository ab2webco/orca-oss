import { describe, expect, it } from 'vitest'
import { pixelCloudOf } from './team-scene-pixel-cloud'

const OUTLINE = '#7d879c'

describe('pixelCloudOf', () => {
  it('draws a closed cloud body with an outline and a shaded base', () => {
    const cloud = pixelCloudOf({ width: 60, height: 16, tailX: 30, tailY: 26, bob: 0 })
    const colors = new Set(cloud.pixels.values())
    expect(colors.has(OUTLINE)).toBe(true)
    expect(colors.has('#c9ccd6')).toBe(true)
    expect(colors.has('#f4f4f0')).toBe(true)
  })

  it('trails two squares from the cloud toward its speaker', () => {
    const cloud = pixelCloudOf({ width: 60, height: 16, tailX: 40, tailY: 30, bob: 0 })
    const below = [...cloud.pixels.keys()]
      .map((k) => ({ x: k % 4096, y: Math.floor(k / 4096) }))
      .filter((p) => p.y >= 16)
    expect(below.length).toBeGreaterThan(4)
    expect(Math.min(...below.map((p) => Math.abs(p.x - 40)))).toBeLessThanOrEqual(3)
    expect(cloud.rows).toBe(30)
  })

  it('stays inside its own grid', () => {
    const cloud = pixelCloudOf({ width: 40, height: 12, tailX: 2, tailY: 20, bob: 1 })
    for (const k of cloud.pixels.keys()) {
      const x = k % 4096
      const y = Math.floor(k / 4096)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(40)
      expect(y).toBeLessThan(cloud.rows)
    }
  })
})
