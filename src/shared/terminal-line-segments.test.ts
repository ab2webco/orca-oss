import { describe, expect, it } from 'vitest'
import {
  coalesceTerminalLineSegments,
  terminalLineColorForAnsiIndex,
  TERMINAL_LINE_MAX_SEGMENTS,
  type TerminalLineColor,
  type TerminalLineSegment
} from './terminal-line-segments'

const run = (
  text: string,
  color: TerminalLineColor = 'default',
  bold = false,
  dim = false
): TerminalLineSegment => ({ text, color, bold, dim })

describe('terminalLineColorForAnsiIndex', () => {
  it('maps the plain palette', () => {
    expect(terminalLineColorForAnsiIndex(1)).toBe('red')
    expect(terminalLineColorForAnsiIndex(2)).toBe('green')
  })

  it('folds bright onto the same hue', () => {
    // The cell is too small to tell two sets of eight apart.
    expect(terminalLineColorForAnsiIndex(9)).toBe('red')
    expect(terminalLineColorForAnsiIndex(10)).toBe('green')
  })

  it('reports no colour rather than guessing', () => {
    expect(terminalLineColorForAnsiIndex(undefined)).toBe('default')
    expect(terminalLineColorForAnsiIndex(-1)).toBe('default')
  })
})

describe('coalesceTerminalLineSegments', () => {
  it('merges neighbours that share a style', () => {
    // A per-cell walk emits one run per character.
    const merged = coalesceTerminalLineSegments('npm test'.split('').map((c) => run(c)))
    expect(merged).toEqual([run('npm test')])
  })

  it('keeps a colour change as its own run', () => {
    const merged = coalesceTerminalLineSegments([
      run('ok '),
      run('F', 'red'),
      run('AIL', 'red'),
      run(' done')
    ])
    expect(merged.map((s) => [s.text, s.color])).toEqual([
      ['ok ', 'default'],
      ['FAIL', 'red'],
      [' done', 'default']
    ])
  })

  it('trims the trailing blanks a fixed-width row pads with', () => {
    expect(coalesceTerminalLineSegments([run('x'), run('     ')])).toEqual([run('x')])
    expect(coalesceTerminalLineSegments([run('    ')])).toEqual([])
  })

  it('keeps the text past the segment cap, losing only the styling', () => {
    // A truncated line reads as missing output, which is worse than monochrome.
    const many = Array.from({ length: TERMINAL_LINE_MAX_SEGMENTS + 6 }, (_, i) =>
      run(`${i}`, i % 2 === 0 ? 'red' : 'green')
    )
    const merged = coalesceTerminalLineSegments(many)
    expect(merged.length).toBeLessThanOrEqual(TERMINAL_LINE_MAX_SEGMENTS)
    expect(merged.map((s) => s.text).join('')).toBe(many.map((s) => s.text).join(''))
  })
})
