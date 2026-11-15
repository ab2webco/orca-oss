import { describe, expect, it } from 'vitest'
import { arcadeFitPxOf, arcadeLinesOf, ridgeStepsOf } from './arcade-canvas-paint'

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

describe('ridgeStepsOf', () => {
  it('ends the ridge on the right edge when the width is not a multiple of the step', () => {
    const steps = ridgeStepsOf(318)
    expect(steps[0]).toBe(0)
    expect(steps.at(-1)).toBe(318)
  })

  it('does not repeat the edge when the width lands on a step', () => {
    const steps = ridgeStepsOf(320)
    expect(steps.at(-1)).toBe(320)
    expect(steps.filter((x) => x === 320)).toHaveLength(1)
  })
})
