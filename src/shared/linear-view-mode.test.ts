import { describe, expect, it } from 'vitest'
import { normalizeLinearViewMode } from './linear-view-mode'

describe('normalizeLinearViewMode', () => {
  it.each([
    [undefined, 'board'],
    ['board', 'board'],
    ['list', 'list'],
    ['timeline', 'board']
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeLinearViewMode(value)).toBe(expected)
  })
})
