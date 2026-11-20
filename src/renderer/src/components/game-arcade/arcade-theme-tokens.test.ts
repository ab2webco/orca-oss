import { describe, expect, it } from 'vitest'
import { arcadeCssOf, arcadeTokensOf } from './arcade-theme-tokens'

describe('arcadeCssOf', () => {
  it('writes an opaque colour without alpha and a translucent one with it', () => {
    expect(arcadeCssOf([10, 20, 30])).toBe('rgb(10 20 30)')
    expect(arcadeCssOf([10, 20, 30], 0.4)).toBe('rgb(10 20 30 / 0.4)')
    expect(arcadeCssOf([10, 20, 30], 1)).toBe('rgb(10 20 30)')
  })
})

describe('arcadeTokensOf', () => {
  it('gives each role its resolved colour as a canvas colour', () => {
    const rgb = { info: [1, 2, 3] } as unknown as Parameters<typeof arcadeTokensOf>[2]
    const tokens = arcadeTokensOf('dark', true, rgb)
    expect(tokens.css('info')).toBe('rgb(1 2 3)')
    expect(tokens.css('info', 0.5)).toBe('rgb(1 2 3 / 0.5)')
    expect(tokens.isDark).toBe(true)
    expect(tokens.key).toBe('dark')
  })
})
