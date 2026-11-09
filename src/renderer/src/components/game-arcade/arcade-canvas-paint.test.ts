import { describe, expect, it } from 'vitest'
import { ridgeStepsOf } from './arcade-canvas-paint'

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
