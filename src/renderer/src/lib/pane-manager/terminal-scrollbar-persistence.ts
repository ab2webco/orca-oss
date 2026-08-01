import type { IDisposable, Terminal } from '@xterm/xterm'

/** Attribute terminal.css keys the persistent-scrollbar rule on. */
export const TERMINAL_SCROLLABLE_ATTRIBUTE = 'data-terminal-scrollable'

/**
 * Mirrors xterm's own `scrollSize > visibleSize` test (ScrollbarState._computeValues),
 * which it evaluates as `cellHeight * buffer.lines.length > canvas.height`. Both sides
 * scale by the cell height, so comparing rows is the same predicate without depending
 * on render dimensions — and it reads `false` in the alternate buffer, where
 * `length === rows` and there is genuinely nothing to scroll.
 */
export function isTerminalBufferScrollable(terminal: Terminal): boolean {
  return terminal.buffer.active.length > terminal.rows
}

/**
 * Publish "this buffer overflows" onto the `.xterm` element so CSS can keep the
 * scrollbar painted for exactly as long as it is grabbable.
 *
 * Why this cannot be pure CSS: xterm writes the same `xterm-invisible` class for
 * "hidden because it is not needed" and "hidden because the 500ms auto-hide fired",
 * and its visibility controller skips the class write entirely when the bar is
 * already hidden (ScrollbarVisibilityController._hide early-returns on !_isVisible).
 * `xterm-fade` therefore records only that the bar was revealed at *some* point —
 * ORCA-133 keyed the rescue on it, which kept a no-longer-needed bar painted as a
 * full-track strip: a filled gutter with no distinguishable thumb, and inert to
 * dragging because xterm's drag math early-returns when the bar is not needed
 * (ScrollbarState.getDesiredScrollPositionFromDelta). Relay/SSH panes hit that state
 * on every snapshot, which wraps its payload in ED 3 and drops the scrollback
 * (remote-runtime-terminal-multiplexer.ts).
 *
 * `onWriteParsed` is required alongside the scroll/resize signals: ED 3 truncates the
 * scrollback without scrolling, so it is the only notification that the buffer stopped
 * overflowing. The DOM is touched only on a state change, so streamed output costs one
 * length comparison per chunk.
 */
export function attachTerminalScrollbarPersistence(terminal: Terminal): IDisposable {
  const element = terminal.element
  if (!element) {
    return { dispose: () => undefined }
  }
  // Seeded false because a freshly opened `.xterm` carries no attribute: the DOM already
  // says "not scrollable", so an empty buffer must not provoke a write.
  let published = false
  const sync = (): void => {
    const scrollable = isTerminalBufferScrollable(terminal)
    if (scrollable === published) {
      return
    }
    published = scrollable
    if (scrollable) {
      element.setAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE, 'true')
    } else {
      element.removeAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)
    }
  }
  sync()

  // Optional chaining throughout: a Terminal stub or a future xterm build missing one of
  // these events must degrade to the remaining signals, never break pane creation.
  const disposables = [
    terminal.onScroll?.(sync),
    terminal.onResize?.(sync),
    terminal.onWriteParsed?.(sync),
    // Alt-screen enter/exit swaps a scrollable buffer for one that never overflows.
    terminal.buffer.onBufferChange?.(sync)
  ].filter((disposable): disposable is IDisposable => disposable !== undefined)

  return {
    dispose: () => {
      for (const disposable of disposables) {
        disposable.dispose()
      }
      disposables.length = 0
      if (published) {
        published = false
        element.removeAttribute(TERMINAL_SCROLLABLE_ATTRIBUTE)
      }
    }
  }
}
