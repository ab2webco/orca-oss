// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { preserveDeleteSiblingPosition } from './WorktreeContextMenu'

const ROW_HEIGHT = 60

function defineScroll(element: HTMLElement, scrollHeight: number): void {
  let scrollTop = 0
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next
    }
  })
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
}

// Mirrors the sidebar: the outer root wraps the scroll viewport that holds the virtual rows.
function mountSidebar(rootMarker: string): {
  root: HTMLElement
  viewport: HTMLElement
  scope: HTMLElement
  shiftRows: (px: number) => void
} {
  const root = document.createElement('div')
  root.setAttribute(rootMarker, '')
  const viewport = document.createElement('div')
  viewport.setAttribute('data-worktree-sidebar', '')
  root.append(viewport)
  defineScroll(root, 800)
  defineScroll(viewport, 3000)
  let shift = 0
  let scope: HTMLElement | null = null
  for (let index = 0; index < 3; index++) {
    const row = document.createElement('div')
    row.setAttribute('data-worktree-virtual-row', '')
    row.setAttribute('data-worktree-virtual-row-key', `row-${index}`)
    row.getBoundingClientRect = () =>
      ({ top: index * ROW_HEIGHT + shift - viewport.scrollTop }) as DOMRect
    const card = document.createElement('div')
    row.append(card)
    viewport.append(row)
    if (index === 1) {
      scope = card
    }
  }
  document.body.append(root)
  return { root, viewport, scope: scope!, shiftRows: (px) => (shift += px) }
}

describe('preserveDeleteSiblingPosition', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  // ORCA-1093: the outer sidebar also carried data-worktree-sidebar, so the restore scrolled it, not the list.
  it('scrolls the worktree viewport back, never the sidebar root around it', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    const { root, viewport, scope, shiftRows } = mountSidebar('data-worktree-sidebar-root')
    viewport.scrollTop = 100

    const restore = preserveDeleteSiblingPosition(scope)
    shiftRows(30)
    restore()

    expect(viewport.scrollTop).toBe(130)
    expect(root.scrollTop).toBe(0)
  })
})
