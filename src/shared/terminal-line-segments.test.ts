import { describe, expect, it } from 'vitest'
import {
  coalesceTerminalLineSegments,
  terminalLineColorForAnsiIndex,
  terminalLineColorForRgb,
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

describe('terminalLineColorForRgb', () => {
  it('classifies a truecolor value by hue', () => {
    expect(terminalLineColorForRgb(0xff0000)).toBe('red')
    expect(terminalLineColorForRgb(0x00ff00)).toBe('green')
    expect(terminalLineColorForRgb(0x0000ff)).toBe('blue')
    expect(terminalLineColorForRgb(0x00ffff)).toBe('cyan')
  })

  it('does not read the packed value as a palette index', () => {
    // 0xcc0000 % 8 is 0, so a reader that confused the two modes would say
    // 'black' for xterm's own red.
    expect(terminalLineColorForRgb(0xcc0000)).toBe('red')
    expect(terminalLineColorForRgb(0xcc0000)).not.toBe(terminalLineColorForAnsiIndex(0xcc0000 % 8))
  })

  it('agrees with the palette path on every tone', () => {
    // One policy for both inputs: each slot's own value must map to the tone
    // that slot's index maps to, or the same visible colour would render two
    // different ways depending on which escape produced it.
    const slots: [number, number][] = [
      [0, 0x2e3436],
      [1, 0xcc0000],
      [2, 0x4e9a06],
      [3, 0xc4a000],
      [4, 0x3465a4],
      [5, 0x75507b],
      [6, 0x06989a],
      [7, 0xd3d7cf]
    ]
    for (const [index, rgb] of slots) {
      expect(terminalLineColorForRgb(rgb)).toBe(terminalLineColorForAnsiIndex(index))
    }
  })

  it('folds a bright truecolor value onto its plain hue', () => {
    expect(terminalLineColorForRgb(0xef2929)).toBe('red')
    expect(terminalLineColorForRgb(0x8ae234)).toBe('green')
  })

  it('resolves greys instead of leaving them between black and white', () => {
    // A mid-grey is near-equidistant from pure black and pure white; the
    // palette's own two greys at each end are what decide it.
    expect(terminalLineColorForRgb(0x000000)).toBe('black')
    expect(terminalLineColorForRgb(0xffffff)).toBe('white')
    expect(terminalLineColorForRgb(0x808080)).toBe('black')
    expect(terminalLineColorForRgb(0xc8c8c8)).toBe('white')
  })

  it('reports no colour rather than guessing', () => {
    expect(terminalLineColorForRgb(undefined)).toBe('default')
    expect(terminalLineColorForRgb(-1)).toBe('default')
    expect(terminalLineColorForRgb(Number.NaN)).toBe('default')
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
