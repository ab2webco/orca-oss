// @vitest-environment happy-dom

import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RightSidebarDrawerScrim, useRightSidebarDrawer } from './right-sidebar-drawer'

let root: Root
let host: HTMLDivElement
let setOpenFromTest: (open: boolean) => void = () => {}

function Harness({
  overlay,
  autoFocusInput = false,
  ready = true,
  restoredOpen = false
}: {
  overlay: boolean
  autoFocusInput?: boolean
  ready?: boolean
  restoredOpen?: boolean
}): React.JSX.Element {
  const [personOpen, setOpen] = useState(false)
  setOpenFromTest = setOpen
  // As hydration does: the persisted open state lands in the same render that marks the UI ready.
  const open = personOpen || restoredOpen
  const containerRef = useRef<HTMLDivElement | null>(null)
  const close = (): void => setOpen(false)
  const drawer = useRightSidebarDrawer({
    open,
    overlay,
    ready,
    containerRef,
    onDismiss: close
  })
  return (
    <div>
      {open ? null : (
        <button type="button" data-right-sidebar-toggle="" onClick={() => setOpen(true)}>
          toggle
        </button>
      )}
      <button type="button" data-testid="terminal">
        terminal
      </button>
      {drawer.showScrim ? <RightSidebarDrawerScrim onDismiss={close} /> : null}
      <div ref={containerRef} data-testid="drawer" tabIndex={drawer.tabIndex}>
        {open ? <input data-testid="drawer-input" autoFocus={autoFocusInput} /> : null}
      </div>
    </div>
  )
}

function render(
  overlay: boolean,
  autoFocusInput = false,
  hydration: { ready?: boolean; restoredOpen?: boolean } = {}
): void {
  act(() => {
    root.render(<Harness overlay={overlay} autoFocusInput={autoFocusInput} {...hydration} />)
  })
}

function query(selector: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(selector)
}

function pressEscape(target: HTMLElement): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
  })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('useRightSidebarDrawer', () => {
  it('shows a scrim only when the open panel overlays the content', () => {
    render(true)
    expect(query('[data-right-sidebar-scrim]')).toBeNull()
    act(() => setOpenFromTest(true))
    expect(query('[data-right-sidebar-scrim]')).not.toBeNull()

    act(() => setOpenFromTest(false))
    render(false)
    act(() => setOpenFromTest(true))
    expect(query('[data-right-sidebar-scrim]')).toBeNull()
  })

  it('closes the drawer from a scrim click', () => {
    render(true)
    act(() => setOpenFromTest(true))
    act(() => query('[data-right-sidebar-scrim]')!.click())
    expect(query('[data-right-sidebar-scrim]')).toBeNull()
    expect(query('[data-testid="drawer-input"]')).toBeNull()
  })

  it('closes the drawer on Escape, unless something inside already handled it', () => {
    render(true)
    act(() => setOpenFromTest(true))
    const input = query('[data-testid="drawer-input"]')!
    const handled = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    })
    handled.preventDefault()
    act(() => {
      input.dispatchEvent(handled)
    })
    expect(query('[data-testid="drawer-input"]')).not.toBeNull()

    pressEscape(input)
    expect(query('[data-testid="drawer-input"]')).toBeNull()
  })

  it('stays open when a document listener in the panel handled Escape first', () => {
    // As the source-control list does to clear its selection.
    const clearSelection = (event: KeyboardEvent): void => event.preventDefault()
    document.addEventListener('keydown', clearSelection)
    try {
      render(true)
      act(() => setOpenFromTest(true))
      pressEscape(query('[data-testid="drawer-input"]')!)
      expect(query('[data-testid="drawer-input"]')).not.toBeNull()
    } finally {
      document.removeEventListener('keydown', clearSelection)
    }
  })

  it('ignores Escape typed outside the drawer', () => {
    render(true)
    act(() => setOpenFromTest(true))
    pressEscape(query('[data-testid="terminal"]')!)
    expect(query('[data-testid="drawer-input"]')).not.toBeNull()
  })

  it('leaves Escape alone when the panel is a column', () => {
    render(false)
    act(() => setOpenFromTest(true))
    pressEscape(query('[data-testid="drawer-input"]')!)
    expect(query('[data-testid="drawer-input"]')).not.toBeNull()
  })

  it('moves focus into the drawer on open and back to the opener on close', () => {
    render(true)
    const terminal = query('[data-testid="terminal"]')!
    terminal.focus()
    act(() => setOpenFromTest(true))
    expect(query('[data-testid="drawer"]')!.contains(document.activeElement)).toBe(true)

    pressEscape(document.activeElement as HTMLElement)
    expect(document.activeElement).toBe(terminal)
  })

  it('raises no scrim and leaves focus alone when an open column starts to overlay', () => {
    // A narrower window or a wider left sidebar, with no open from the person (ORCA-1256).
    render(false)
    act(() => setOpenFromTest(true))
    const terminal = query('[data-testid="terminal"]')!
    terminal.focus()
    render(true)
    expect(query('[data-right-sidebar-scrim]')).toBeNull()
    expect(query('[data-testid="drawer"]')!.getAttribute('tabindex')).toBeNull()
    expect(document.activeElement).toBe(terminal)
    pressEscape(terminal)
    expect(query('[data-testid="drawer-input"]')).not.toBeNull()
  })

  it('raises no scrim for an open state restored at startup', () => {
    render(true, false, { ready: false })
    const terminal = query('[data-testid="terminal"]')!
    terminal.focus()
    render(true, false, { ready: true, restoredOpen: true })
    expect(query('[data-testid="drawer-input"]')).not.toBeNull()
    expect(query('[data-right-sidebar-scrim]')).toBeNull()
    expect(document.activeElement).toBe(terminal)
  })

  it('ends the drawer once the panel is a column again', () => {
    render(true)
    act(() => setOpenFromTest(true))
    render(false)
    expect(query('[data-right-sidebar-scrim]')).toBeNull()
    render(true)
    expect(query('[data-right-sidebar-scrim]')).toBeNull()
  })

  it('keeps focus that the panel already placed inside the drawer', () => {
    render(true, true)
    act(() => setOpenFromTest(true))
    expect(document.activeElement).toBe(query('[data-testid="drawer-input"]'))
  })

  it('returns focus to the panel toggle when the opener is gone', () => {
    render(true)
    const toggle = query('[data-right-sidebar-toggle]')!
    toggle.focus()
    // The toggle unmounts while the panel is open, as it does in App.
    act(() => toggle.click())
    act(() => query('[data-right-sidebar-scrim]')!.click())
    expect(document.activeElement).toBe(query('[data-right-sidebar-toggle]'))
  })
})
