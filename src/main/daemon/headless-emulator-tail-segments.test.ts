import { describe, expect, it, afterEach } from 'vitest'
import { HeadlessEmulator } from './headless-emulator'

const ESC = '\u001b'
const sgr = (params: string): string => `${ESC}[${params}m`

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

  it('does not pad a row to the terminal width', async () => {
    const term = await render('short')
    const row = term.getBufferTailSegments(4).find((r) => r.length > 0) ?? []
    expect(row.map((s) => s.text).join('')).toBe('short')
  })
})
