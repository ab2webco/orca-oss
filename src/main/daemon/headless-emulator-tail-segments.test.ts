import { describe, expect, it, afterEach } from 'vitest'
import { HeadlessEmulator } from './headless-emulator'

const ESC = '\u001b'
const sgr = (params: string): string => `${ESC}[${params}m`
/** 24-bit foreground: the shape Claude Code and Codex actually emit. */
const sgrRgb = (r: number, g: number, b: number): string => sgr(`38;2;${r};${g};${b}`)

let emulator: HeadlessEmulator | null = null

afterEach(() => {
  emulator?.dispose()
  emulator = null
})

async function render(data: string): Promise<HeadlessEmulator> {
  emulator = new HeadlessEmulator({ cols: 40, rows: 4, scrollback: 20 })
  await emulator.write(data)
  return emulator
}

describe('HeadlessEmulator.getBufferTailSegments', () => {
  it('reports the colour the escape asked for', async () => {
    const term = await render(`ok ${sgr('31')}FAIL${sgr('0')} done`)
    const row = term.getBufferTailSegments(4).find((r) => r.length > 0) ?? []
    expect(row.map((s) => [s.text, s.color])).toEqual([
      ['ok ', 'default'],
      ['FAIL', 'red'],
      [' done', 'default']
    ])
  })

  // ORCA-296: agents paint their TUIs in 24-bit colour, not in the 16-colour
  // palette, so this is the only shape that exercises the branch the product
  // fails on. A palette fixture (`sgr('31')`) passes either way — which is why
  // the ORCA-281 E2E was green while the grid read white in the real app.
  it('reports the colour a truecolor escape asked for', async () => {
    // 0xcc0000 on purpose: read as a palette index it would be 13369344 % 8 = 0,
    // i.e. 'black'. Only a reader that treats it as packed RGB says 'red'.
    const term = await render(`ok ${sgrRgb(0xcc, 0x00, 0x00)}FAIL${sgr('0')} done`)
    const row = term.getBufferTailSegments(4).find((r) => r.length > 0) ?? []
    expect(row.map((s) => [s.text, s.color])).toEqual([
      ['ok ', 'default'],
      ['FAIL', 'red'],
      [' done', 'default']
    ])
  })

  it('gives a truecolor cell and its palette twin the same tone', async () => {
    // The two paths are pinned to one policy, so a TUI that paints xterm's own
    // red and one that sends SGR 31 cannot disagree about what the user sees.
    const term = await render(
      `${sgrRgb(0x4e, 0x9a, 0x06)}rgb${sgr('0')} ${sgr('32')}pal${sgr('0')}`
    )
    const row = term.getBufferTailSegments(4).find((r) => r.length > 0) ?? []
    expect(row.find((s) => s.text === 'rgb')?.color).toBe('green')
    expect(row.find((s) => s.text === 'pal')?.color).toBe('green')
  })

  it('folds a bright truecolor hue onto its plain tone', async () => {
    // Same rule the palette path already documents for 8-15.
    const term = await render(`${sgrRgb(0xef, 0x29, 0x29)}bright${sgr('0')}`)
    const row = term.getBufferTailSegments(4).find((r) => r.length > 0) ?? []
    expect(row.find((s) => s.text === 'bright')?.color).toBe('red')
  })

  it('never leaks an escape into the text', async () => {
    // The renderer prints text nodes; a surviving escape would show literally.
    const term = await render(`a${sgr('1;32')}b${ESC}[2Kc`)
    const text = term
      .getBufferTailSegments(4)
      .flat()
      .map((s) => s.text)
      .join('')
    expect(text).not.toContain(ESC)
  })

  it('carries bold and dim', async () => {
    const term = await render(`${sgr('1')}strong${sgr('22')} ${sgr('2')}faint`)
    const row = term.getBufferTailSegments(4).find((r) => r.length > 0) ?? []
    expect(row.find((s) => s.text === 'strong')?.bold).toBe(true)
    expect(row.find((s) => s.text === 'faint')?.dim).toBe(true)
  })

  // ORCA-285: a grid cell forwards a tall viewport, so the pty's grid can have
  // more rows than the tail window asks for. The window must follow the content,
  // not the buffer's end, or a short screen in a tall grid reads as blank.
  async function renderInTallGrid(data: string): Promise<HeadlessEmulator> {
    emulator = new HeadlessEmulator({ cols: 52, rows: 64, scrollback: 200 })
    await emulator.write(data)
    return emulator
  }

  it('finds a short screen inside a grid taller than the tail window', async () => {
    const term = await renderInTallGrid(`ok ${sgr('31')}MARK${sgr('0')}\r\nprompt$ `)
    const rows = term.getBufferTailSegments(48).filter((row) => row.length > 0)
    expect(
      rows.map((row) =>
        row
          .map((s) => s.text)
          .join('')
          .trim()
      )
    ).toEqual(['ok MARK', 'prompt$'])
    expect(rows.flat().find((s) => s.text === 'MARK')?.color).toBe('red')
  })

  it('agrees with the plain-text tail about which rows have content', async () => {
    const term = await renderInTallGrid(`${sgr('31')}MARK${sgr('0')}\r\nprompt$ `)
    const segmentRows = term.getBufferTailSegments(48).filter((row) => row.length > 0)
    const textRows = term.getBufferTailLines(48).filter((line) => line.trim().length > 0)
    expect(segmentRows.length).toBe(textRows.length)
  })

  it('still returns the newest rows when the content overflows the window', async () => {
    const term = await renderInTallGrid(
      `${Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\r\n')}\r\n${sgr('31')}NEWEST${sgr('0')}`
    )
    const rows = term.getBufferTailSegments(8).filter((row) => row.length > 0)
    expect(rows).toHaveLength(8)
    expect(
      rows
        .at(-1)
        ?.map((s) => s.text)
        .join('')
    ).toBe('NEWEST')
  })

  // ORCA-306: a TUI parks its composer at the foot and leaves the screen above
  // it blank, so the rows immediately before the cursor are the gap, not the
  // conversation. Anchoring on the cursor is still right — spending the window
  // on blanks is not.
  async function renderTuiWithGapAboveComposer(): Promise<HeadlessEmulator> {
    emulator = new HeadlessEmulator({ cols: 40, rows: 24, scrollback: 200 })
    const content = ['Advising using Opus 5', 'answer line one', 'answer line two'].join('\r\n')
    // CUP to the last row: the composer sits at the foot, the rows between stay blank.
    await emulator.write(`${content}${ESC}[24;1HDeciphering...`)
    return emulator
  }

  it('spends the window on rows that carry content, not on the gap', async () => {
    const term = await renderTuiWithGapAboveComposer()
    const rows = term
      .getBufferTailSegments(6)
      .map((row) =>
        row
          .map((segment) => segment.text)
          .join('')
          .trim()
      )
      .filter((line) => line.length > 0)
    expect(rows).toEqual([
      'Advising using Opus 5',
      'answer line one',
      'answer line two',
      'Deciphering...'
    ])
  })

  it('keeps the cursor row in the window while skipping the gap', async () => {
    const term = await renderTuiWithGapAboveComposer()
    const lines = term.getBufferTailLines(6).map((line) => line.trim())
    // The composer holds the live prompt; ORCA-285 put it inside the window.
    expect(lines.at(-1)).toBe('Deciphering...')
  })

  it('keeps the blank line a transcript uses to separate turns', async () => {
    // The gap above a composer is waste; a single blank between two turns is the
    // separation a reader scans by, and compressing it would show the grid
    // something the terminal never drew.
    emulator = new HeadlessEmulator({ cols: 40, rows: 24, scrollback: 200 })
    const transcript = ['turn one', '', 'turn two', '', 'turn three'].join('\r\n')
    await emulator.write(`${transcript}${ESC}[24;1HDeciphering...`)
    expect(emulator.getBufferTailLines(8).map((line) => line.trim())).toEqual([
      'turn one',
      '',
      'turn two',
      '',
      'turn three',
      '',
      'Deciphering...'
    ])
  })

  it('spends one row on a run of blanks, however tall the run is', async () => {
    emulator = new HeadlessEmulator({ cols: 40, rows: 24, scrollback: 200 })
    // Four blank rows between two turns: still one row of separation, not four.
    const transcript = ['turn one', '', '', '', '', 'turn two'].join('\r\n')
    await emulator.write(`${transcript}${ESC}[24;1HDeciphering...`)
    expect(emulator.getBufferTailLines(8).map((line) => line.trim())).toEqual([
      'turn one',
      '',
      'turn two',
      '',
      'Deciphering...'
    ])
  })

  it('leaves a blank screen blank instead of resurrecting scrollback', async () => {
    emulator = new HeadlessEmulator({ cols: 40, rows: 8, scrollback: 200 })
    // Old output, then a cleared screen: the pane the user is looking at is empty.
    await emulator.write(`stale output line\r\n${ESC}[2J${ESC}[H`)
    const lines = emulator.getBufferTailLines(6).filter((line) => line.trim().length > 0)
    expect(lines).toEqual([])
  })

  it('does not pad a row to the terminal width', async () => {
    const term = await render('short')
    const row = term.getBufferTailSegments(4).find((r) => r.length > 0) ?? []
    expect(row.map((s) => s.text).join('')).toBe('short')
  })
})
