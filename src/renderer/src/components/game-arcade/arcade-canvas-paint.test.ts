import { describe, expect, it } from 'vitest'
import { arcadeFitPxOf, arcadeLinesOf } from './arcade-canvas-paint'

describe('arcadeLinesOf', () => {
  const chars = (line: string) => line.length

  it('keeps a line that fits', () => {
    expect(arcadeLinesOf('Space to jump', 20, chars)).toEqual(['Space to jump'])
  })

  it('wraps at a space instead of squeezing the text', () => {
    expect(arcadeLinesOf('Paused · Luigi needs you', 10, chars)).toEqual([
      'Paused ·',
      'Luigi needs you'
    ])
  })

  it('puts the rest on the last line when it needs more than the max', () => {
    expect(arcadeLinesOf('aa bb cc dd', 2, chars)).toEqual(['aa', 'bb cc dd'])
  })
})

describe('arcadeFitPxOf', () => {
  it('keeps the size when the widest line fits', () => {
    expect(arcadeFitPxOf(22, 100, 120, 12)).toBe(22)
  })

  it('shrinks the size in proportion so the widest line fits, down to the floor', () => {
    expect(arcadeFitPxOf(22, 160, 105, 12)).toBe(14)
    expect(arcadeFitPxOf(22, 400, 105, 12)).toBe(12)
  })
})
