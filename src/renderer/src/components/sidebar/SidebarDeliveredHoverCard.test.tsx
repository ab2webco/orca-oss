// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent, render as renderTl } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeliveredView } from './use-sidebar-delivered-view'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

type Slot = { children: React.ReactElement } & Record<string, unknown>
vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({ children }: { children: React.ReactNode }) => children,
  HoverCardTrigger: ({ children, onPointerEnter, onFocus }: Slot) =>
    React.cloneElement(children, { onPointerEnter, onFocus } as Record<string, unknown>),
  HoverCardContent: ({ side, collisionPadding }: Slot) => (
    <div data-card-side={String(side)} data-card-padding={String(collisionPadding)} />
  )
}))

const { SidebarDeliveredHoverCard, SidebarDeliveredHoverDetails } =
  await import('./SidebarDeliveredHoverCard')

const NOW = new Date(2026, 10, 15, 12, 0).getTime()
const FREED = new Date(2026, 10, 15, 6, 10).getTime()

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
})

const view: DeliveredView = {
  member: {
    worktreeId: 'wt-1203',
    ticket: 'ORCA-1203',
    branch: 'fabolivark/orca-1203',
    character: 'Peach',
    freedAt: FREED,
    recordedPr: { number: 1208, state: 'merged' }
  },
  pr: {
    number: 1208,
    title: 'Show which project overrides the setting',
    state: 'merged',
    ci: 'success',
    queued: false
  },
  kind: 'merged'
}

async function render(element: React.JSX.Element): Promise<HTMLElement> {
  const host = document.createElement('div')
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(element))
  return host
}

const fieldOf = (host: HTMLElement, name: string): string =>
  host.querySelector(`[data-delivered-field="${name}"]`)?.textContent ?? ''

describe('SidebarDeliveredHoverDetails', () => {
  it('names the ticket and who did it, then the PR, title, branch, lead and when it was freed', async () => {
    const host = await render(
      <SidebarDeliveredHoverDetails
        view={view}
        leadName="Alfred"
        projectName="orca-oss"
        others={[
          { ticket: 'ORCA-1149', kind: 'merged' },
          { ticket: 'ORCA-1216', kind: 'inProgress' }
        ]}
        now={NOW}
      />
    )

    expect(host.querySelector('[data-delivered-hover-header]')!.textContent).toBe(
      'ORCA-1203· Done by Peach'
    )
    expect(fieldOf(host, 'pr')).toBe('PR#1208 merged')
    expect(fieldOf(host, 'title')).toBe('TitleShow which project overrides the setting')
    expect(fieldOf(host, 'branch')).toBe('Branchfabolivark/orca-1203')
    expect(fieldOf(host, 'lead')).toBe('LeadAlfred · orca-oss')
    expect(fieldOf(host, 'freed')).toBe('Freedtoday 06:10 AM · worktree waiting')
    expect(host.querySelector('[data-delivered-also]')!.textContent).toBe(
      'Peach also: ORCA-1149 (merged), ORCA-1216 (in progress)'
    )
  })

  it('leaves out what it does not know: no character, no title, no other tickets', async () => {
    const host = await render(
      <SidebarDeliveredHoverDetails
        view={{
          ...view,
          member: { ...view.member, character: null },
          pr: { ...view.pr!, title: null }
        }}
        leadName="Alfred"
        projectName={null}
        others={[]}
        now={NOW}
      />
    )

    expect(host.querySelector('[data-delivered-hover-header]')!.textContent).toBe('ORCA-1203')
    expect(host.querySelector('[data-delivered-field="title"]')).toBeNull()
    expect(fieldOf(host, 'lead')).toBe('LeadAlfred')
    expect(host.querySelector('[data-delivered-also]')).toBeNull()
  })
})

describe('SidebarDeliveredHoverCard placement', () => {
  function sideAt(viewportWidth: number, triggerRight: number): string | null {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(viewportWidth)
    const { container } = renderTl(
      <SidebarDeliveredHoverCard view={view}>
        <button type="button" data-trigger="" />
      </SidebarDeliveredHoverCard>
    )
    const trigger = container.querySelector<HTMLElement>('[data-trigger]')!
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ right: triggerRight } as DOMRect)
    fireEvent.pointerEnter(trigger)
    const card = container.querySelector('[data-card-side]')!
    expect(card.getAttribute('data-card-padding')).toBe('8')
    return card.getAttribute('data-card-side')
  }

  it('opens beside the row while the card fits in the window', () => {
    expect(sideAt(1440, 300)).toBe('right')
  })

  it('opens under the row on a phone-width window, where it would run past the edge', () => {
    expect(sideAt(390, 380)).toBe('bottom')
    expect(sideAt(320, 312)).toBe('bottom')
  })
})
