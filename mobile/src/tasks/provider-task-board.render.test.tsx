import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('lucide-react-native', () => ({ ChevronDown: () => createElement('span') }))

import { ProviderTaskBoard, type ProviderTaskBoardSection } from './provider-task-board'

type Card = { id: string; title: string; detail: string; state: { name: string; color: string } }

const CARD: Card = {
  id: 'issue-1',
  title: 'Extract the shared board',
  detail: 'ORCA-396 · High',
  state: { name: 'Todo', color: '#aaaaaa' }
}

const SECTIONS: ProviderTaskBoardSection<Card>[] = [
  { key: 'todo', label: 'Todo', color: '#aaaaaa', items: [CARD] },
  { key: 'done', label: 'Done', color: '#bbbbbb', items: [] }
]

function byLabel(label: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)
}

function byTestId(id: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}

describe('ProviderTaskBoard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  /** Marks which column asked for the slot, so a slot rendered in the wrong one is visible. */
  function columnSlot(kind: string, section: ProviderTaskBoardSection<Card>): ReactNode {
    return createElement('span', { 'data-testid': `${kind}-${section.key}` }, section.label)
  }

  function mount(onPressCard = vi.fn(), onPressStatus = vi.fn()): void {
    act(() => {
      root.render(
        createElement(ProviderTaskBoard<Card>, {
          sections: SECTIONS,
          bottomInset: 8,
          getItemKey: (card) => card.id,
          getTitle: (card) => card.title,
          getSubtitle: (card) => card.detail,
          getStatus: (card) => ({
            label: card.state.name,
            color: card.state.color,
            accessibilityLabel: `Change status from ${card.state.name}`
          }),
          onPressItem: onPressCard,
          onPressStatus,
          createDrawerSlot: createElement(
            'span',
            { 'data-testid': 'create-drawer-slot' },
            'Create drawer'
          ),
          writeErrorSlot: createElement(
            'span',
            { 'data-testid': 'write-error-slot' },
            'Retry write'
          ),
          renderColumnHeaderSlot: (section) => columnSlot('header-slot', section),
          renderColumnFooterSlot: (section) => columnSlot('footer-slot', section)
        })
      )
    })
  }

  it('renders columns, counts, cards, and provider-owned slots', () => {
    mount()

    expect(document.body.textContent).toContain('Todo1')
    expect(document.body.textContent).toContain('Done0')
    expect(document.body.textContent).toContain(CARD.title)
    expect(document.body.textContent).toContain(CARD.detail)
    expect(document.body.querySelector('[data-testid="create-drawer-slot"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="write-error-slot"]')).not.toBeNull()
  })

  it('opens the provider action from a card press', () => {
    const onPressCard = vi.fn()
    mount(onPressCard)

    act(() => byLabel(`Open ${CARD.title}`)!.click())

    expect(onPressCard).toHaveBeenCalledWith(CARD)
  })

  it('opens the status picker without also opening the card action', () => {
    const onPressCard = vi.fn()
    const onPressStatus = vi.fn()
    mount(onPressCard, onPressStatus)

    act(() => byLabel('Change status from Todo')!.click())

    expect(onPressStatus).toHaveBeenCalledWith(CARD)
    expect(onPressCard).not.toHaveBeenCalled()
  })

  describe('per-column slots', () => {
    it('renders each column its own slots, inside that column and no other', () => {
      mount()

      for (const section of SECTIONS) {
        const column = byTestId(`column-${section.key}`)
        expect(column).not.toBeNull()
        const header = byTestId(`header-slot-${section.key}`)
        const footer = byTestId(`footer-slot-${section.key}`)
        expect(column!.contains(header)).toBe(true)
        expect(column!.contains(footer)).toBe(true)
      }

      // The Todo slots must not have landed in Done, which an board-level slot would do.
      expect(byTestId('column-done')!.contains(byTestId('header-slot-todo'))).toBe(false)
      expect(byTestId('column-done')!.contains(byTestId('footer-slot-todo'))).toBe(false)
    })

    it('pins the footer slot below the scrolling cards, not inside them', () => {
      mount()

      const footer = byTestId('footer-slot-todo')
      const cards = byLabel(`Open ${CARD.title}`)
      expect(footer).not.toBeNull()
      // A footer moved inside the card list would scroll away with the cards.
      expect(footer!.parentElement).toBe(byTestId('column-todo'))
      expect(footer!.previousElementSibling!.contains(cards)).toBe(true)
    })

    it('leaves the column intact for a provider that passes no slots — Linear does not', () => {
      act(() => {
        root.render(
          createElement(ProviderTaskBoard<Card>, {
            sections: SECTIONS,
            bottomInset: 8,
            getItemKey: (card) => card.id,
            getTitle: (card) => card.title,
            getSubtitle: (card) => card.detail,
            onPressItem: vi.fn()
          })
        )
      })

      expect(byTestId('column-todo')).not.toBeNull()
      expect(document.body.textContent).toContain(CARD.title)
      expect(byTestId('header-slot-todo')).toBeNull()
      expect(byTestId('footer-slot-todo')).toBeNull()
    })
  })
})
