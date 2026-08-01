// @vitest-environment happy-dom
import type { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import {
  TERMINAL_SCROLLABLE_ATTRIBUTE,
  attachTerminalScrollbarPersistence,
  isTerminalBufferScrollable
} from './terminal-scrollbar-persistence'

type Listener = () => void

function createEmitter(): { fire: () => void; register: (cb: Listener) => { dispose(): void } } {
  const listeners = new Set<Listener>()
  return {
    fire: () => {
      for (const listener of listeners) {
        listener()
      }
    },
    register: (cb) => {
      listeners.add(cb)
      return { dispose: () => listeners.delete(cb) }
    }
  }
}

function createTerminalStub(options: { rows: number; length: number; withElement?: boolean }): {
  terminal: Terminal
  element: HTMLElement
  setLength: (length: number) => void
  scroll: () => void
  resize: () => void
  writeParsed: () => void
  bufferChange: () => void
} {
  const element = document.createElement('div')
  const scroll = createEmitter()
  const resize = createEmitter()
  const writeParsed = createEmitter()
  const bufferChange = createEmitter()
  const state = { length: options.length }
  const terminal = {
    rows: options.rows,
    element: options.withElement === false ? undefined : element,
    buffer: {
      get active() {
        return { length: state.length }
      },
      onBufferChange: bufferChange.register
    },
    onScroll: scroll.register,
    onResize: resize.register,
    onWriteParsed: writeParsed.register
  } as unknown as Terminal
  return {
    terminal,
    element,
    setLength: (length) => {
      state.length = length
    },
    scroll: scroll.fire,
    resize: resize.fire,
    writeParsed: writeParsed.fire,
    bufferChange: bufferChange.fire
  }
}

describe('isTerminalBufferScrollable', () => {
  it('is false when the buffer holds exactly the visible rows', () => {
    const { terminal } = createTerminalStub({ rows: 24, length: 24 })
    expect(isTerminalBufferScrollable(terminal)).toBe(false)
  })

  it('is true once the buffer holds more lines than the viewport shows', () => {
    const { terminal } = createTerminalStub({ rows: 24, length: 25 })
    expect(isTerminalBufferScrollable(terminal)).toBe(true)
  })
})

describe('attachTerminalScrollbarPersistence', () => {
  it('publishes the attribute for a buffer that already overflows', () => {
    const { terminal, element } = createTerminalStub({ rows: 24, length: 500 })
    attachTerminalScrollbarPersistence(terminal)
    expect(element.getAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)).toBe('true')
  })

  it('withdraws the attribute when a write drops the scrollback', () => {
    const { terminal, element, setLength, writeParsed } = createTerminalStub({
      rows: 24,
      length: 500
    })
    attachTerminalScrollbarPersistence(terminal)

    // ED 3 truncates the scrollback without scrolling — the write signal is the only
    // notification a relay snapshot repaint gives us.
    setLength(24)
    writeParsed()
    expect(element.hasAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)).toBe(false)
  })

  it('republishes when the buffer overflows again', () => {
    const { terminal, element, setLength, scroll } = createTerminalStub({ rows: 24, length: 24 })
    attachTerminalScrollbarPersistence(terminal)
    expect(element.hasAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)).toBe(false)

    setLength(120)
    scroll()
    expect(element.getAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)).toBe('true')
  })

  it('follows an alt-screen switch that removes the scrollback', () => {
    const { terminal, element, setLength, bufferChange } = createTerminalStub({
      rows: 24,
      length: 500
    })
    attachTerminalScrollbarPersistence(terminal)

    setLength(24)
    bufferChange()
    expect(element.hasAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)).toBe(false)
  })

  it('tracks a resize that makes the viewport tall enough to hold the buffer', () => {
    const { terminal, element, resize } = createTerminalStub({ rows: 24, length: 30 })
    attachTerminalScrollbarPersistence(terminal)
    expect(element.getAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)).toBe('true')

    ;(terminal as unknown as { rows: number }).rows = 30
    resize()
    expect(element.hasAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)).toBe(false)
  })

  it('stops publishing and clears the attribute once disposed', () => {
    const { terminal, element, setLength, scroll } = createTerminalStub({ rows: 24, length: 500 })
    const disposable = attachTerminalScrollbarPersistence(terminal)
    disposable.dispose()
    expect(element.hasAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)).toBe(false)

    setLength(900)
    scroll()
    expect(element.hasAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)).toBe(false)
  })

  it('no-ops for a terminal that has not been opened yet', () => {
    const { terminal, element } = createTerminalStub({
      rows: 24,
      length: 500,
      withElement: false
    })
    expect(() => attachTerminalScrollbarPersistence(terminal).dispose()).not.toThrow()
    expect(element.hasAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)).toBe(false)
  })
})
