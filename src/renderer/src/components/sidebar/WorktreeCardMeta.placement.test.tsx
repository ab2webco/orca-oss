// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Enter = (event: { currentTarget: { getBoundingClientRect: () => { right: number } } }) => void
const trigger = vi.hoisted(() => ({ enter: undefined as Enter | undefined }))
vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardTrigger: ({
    children,
    onPointerEnter
  }: {
    children: ReactNode
    onPointerEnter: Enter
  }) => {
    trigger.enter = onPointerEnter
    return <>{children}</>
  },
  HoverCardContent: ({
    children,
    side,
    className
  }: {
    children: ReactNode
    side: string
    className: string
  }) => (
    <div data-card="" data-side={side} className={className}>
      {children}
    </div>
  )
}))

const { WorktreeCardDetailsHover } = await import('./WorktreeCardMeta')

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() =>
    root?.render(
      <WorktreeCardDetailsHover
        workspaceTitle="cin-1145"
        issue={null}
        linearIssue={null}
        review={null}
        comment={null}
      >
        <span>card</span>
      </WorktreeCardDetailsHover>
    )
  )
  return host.querySelector<HTMLElement>('[data-card]')!
}

function enterAt(viewportWidth: number, triggerRight: number): void {
  Object.defineProperty(window, 'innerWidth', { value: viewportWidth, configurable: true })
  act(() =>
    trigger.enter?.({ currentTarget: { getBoundingClientRect: () => ({ right: triggerRight }) } })
  )
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

// Why: a 320 px card beside a row on a phone-width window ran past its right edge.
describe('WorktreeCardDetailsHover placement', () => {
  it('opens beside the row while the card fits there', () => {
    const card = render()
    enterAt(1440, 280)
    expect(card.getAttribute('data-side')).toBe('right')
  })

  it('opens under the row on a window too narrow for it beside the row', () => {
    const card = render()
    enterAt(390, 280)
    expect(card.getAttribute('data-side')).toBe('bottom')
  })

  it('never grows wider than the window', () => {
    expect(render().className).toContain('max-w-[calc(100vw-1rem)]')
  })
})
