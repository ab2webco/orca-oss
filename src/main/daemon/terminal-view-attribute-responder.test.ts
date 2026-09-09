import { describe, expect, it, vi } from 'vitest'
import { installTerminalViewAttributeResponder } from './terminal-view-attribute-responder'
import type { TerminalViewAttributes } from '../../shared/terminal-view-attributes'

type OscHandler = (data: string) => boolean

function makeParser(): {
  parser: Parameters<typeof installTerminalViewAttributeResponder>[0]['parser']
  osc: Map<number, OscHandler>
} {
  const osc = new Map<number, OscHandler>()
  return {
    osc,
    parser: {
      registerOscHandler: (ident: number, handler: OscHandler) => {
        osc.set(ident, handler)
        return { dispose: () => {} }
      },
      registerCsiHandler: () => ({ dispose: () => {} })
    } as never
  }
}

const ATTRIBUTES = {
  foreground: [200, 200, 200],
  background: [40, 44, 52],
  cursor: [255, 255, 255],
  ansi: Array.from({ length: 256 }, () => [0, 0, 0]),
  colorSchemeMode: 'dark',
  cursorStyle: 'block',
  cursorBlink: false
} as unknown as TerminalViewAttributes

describe('terminal view attribute responder', () => {
  it('answers a background query from the pushed palette and consumes it', () => {
    const { parser, osc } = makeParser()
    const emitReply = vi.fn()
    installTerminalViewAttributeResponder({
      parser,
      getBaseAttributes: () => ATTRIBUTES,
      emitReply
    })

    expect(osc.get(11)!('?')).toBe(true)
    expect(emitReply).toHaveBeenCalledWith(expect.stringContaining(']11;rgb:'))
  })

  // Why this case: with no palette we must not invent a colour, but consuming
  // the sequence anyway also hides it from the headless core, so nothing
  // downstream can react. Declining keeps the stream honest.
  it('declines a query it cannot answer instead of swallowing it', () => {
    const { parser, osc } = makeParser()
    const emitReply = vi.fn()
    installTerminalViewAttributeResponder({
      parser,
      getBaseAttributes: () => null,
      emitReply
    })

    expect(osc.get(11)!('?')).toBe(false)
    expect(emitReply).not.toHaveBeenCalled()
  })

  it('still consumes a SET with no palette, which needs no reply', () => {
    const { parser, osc } = makeParser()
    installTerminalViewAttributeResponder({
      parser,
      getBaseAttributes: () => null,
      emitReply: vi.fn()
    })

    expect(osc.get(11)!('rgb:2828/2c2c/3434')).toBe(true)
  })
})
