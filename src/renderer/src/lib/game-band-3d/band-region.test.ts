import { describe, expect, it } from 'vitest'
import { findBandRegion, type BandCell } from './band-region'

const HALF = 0x2580
const text = (line: string): BandCell[] =>
  [...line].map((ch) => ({ code: ch.codePointAt(0) ?? 32, isRgb: false }))
const raster = (cols: number, from = 0, glyphs: Record<number, string> = {}): BandCell[] =>
  Array.from({ length: cols }, (_, x) =>
    x < from ? { code: 32, isRgb: false } : { code: glyphs[x]?.codePointAt(0) ?? HALF, isRgb: true }
  )

const reader = (rows: BandCell[][]) => (y: number) => rows[y] ?? null

describe('findBandRegion', () => {
  it('finds a run of raster rows between ordinary text', () => {
    const rows = [
      text('$ claude'),
      ...Array.from({ length: 9 }, () => raster(80)),
      text('> prompt')
    ]
    expect(findBandRegion(rows.length, reader(rows))).toEqual({
      top: 1,
      rows: 9,
      left: 0,
      cols: 80
    })
  })

  it('keeps words drawn inside the scene as part of the band', () => {
    const rows = Array.from({ length: 9 }, (_, y) =>
      y === 2 ? raster(60, 0, { 10: 'R', 11: 'e', 12: 'a', 13: 'd' }) : raster(60)
    )
    expect(findBandRegion(rows.length, reader(rows))).toEqual({
      top: 0,
      rows: 9,
      left: 0,
      cols: 60
    })
  })

  it('takes the lowest band when scrollback still shows an older copy', () => {
    const band = Array.from({ length: 5 }, () => raster(40))
    const rows = [...band, text('output'), text('more'), ...band, text('> ')]
    expect(findBandRegion(rows.length, reader(rows))?.top).toBe(7)
  })

  it('ignores a short block and rows of half blocks without truecolor', () => {
    const plain = Array.from({ length: 9 }, () =>
      raster(80).map((cell) => ({ ...cell, isRgb: false }))
    )
    expect(findBandRegion(plain.length, reader(plain))).toBeNull()
    const short = Array.from({ length: 3 }, () => raster(80))
    expect(findBandRegion(short.length, reader(short))).toBeNull()
  })

  it('ignores a narrow strip of half blocks', () => {
    const narrow = Array.from({ length: 9 }, () => raster(12))
    expect(findBandRegion(narrow.length, reader(narrow))).toBeNull()
  })

  it('reports the band offset when it does not start at column zero', () => {
    const rows = Array.from({ length: 6 }, () => raster(50, 2))
    expect(findBandRegion(rows.length, reader(rows))).toEqual({
      top: 0,
      rows: 6,
      left: 2,
      cols: 48
    })
  })
})
