import { describe, expect, it } from 'vitest'
import { layoutTeamSceneNames } from './team-scene-engine-names'

describe('the Team scene name strip', () => {
  it('keeps a label as wide as its whole name when the row has room', () => {
    // Why fractions: a WebView measures text in fractional px, and a label a hair narrower
    // than its name shows an ellipsis instead of the name.
    const boxes = layoutTeamSceneNames(
      [
        { key: 'm1', name: 'Mario', x: 60, width: 36.32 },
        { key: 'm2', name: 'Luigi', x: 160, width: 32.7 }
      ],
      390
    )
    expect(boxes.map((one) => one.width)).toEqual([36.32, 32.7])
  })

  it('narrows every label of a crowded row alike, never past the strip', () => {
    const figures = Array.from({ length: 8 }, (_, at) => ({
      key: `m${at}`,
      name: `Member ${at}`,
      x: 20 + at * 10,
      width: 90
    }))
    const boxes = layoutTeamSceneNames(figures, 320)
    for (const one of boxes) {
      expect(one.left).toBeGreaterThanOrEqual(0)
      expect(one.left + one.width).toBeLessThanOrEqual(320)
    }
    const rows = [...new Set(boxes.map((one) => one.top))]
    for (const top of rows) {
      const row = boxes.filter((one) => one.top === top).sort((a, b) => a.left - b.left)
      expect(new Set(row.map((one) => one.width)).size).toBe(1)
      row.slice(1).forEach((one, at) => {
        expect(one.left).toBeGreaterThanOrEqual(row[at]!.left + row[at]!.width)
      })
    }
  })

  it('nudges a label past its neighbour on the first row while it still sits under its figure', () => {
    const boxes = layoutTeamSceneNames(
      [
        { key: 'advisor', name: 'advisor', x: 290, width: 45 },
        { key: 'lead', name: 'Peach', x: 330, width: 38 }
      ],
      390
    )
    const peach = boxes.find((one) => one.key === 'lead')!
    expect(new Set(boxes.map((one) => one.top)).size).toBe(1)
    expect(peach.left).toBeLessThanOrEqual(330)
    expect(peach.left + peach.width).toBeGreaterThan(330)
  })
})
