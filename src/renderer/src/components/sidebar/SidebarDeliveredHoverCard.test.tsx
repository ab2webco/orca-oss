// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeliveredView } from './use-sidebar-delivered-view'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en'
}))

const { SidebarDeliveredHoverDetails } = await import('./SidebarDeliveredHoverCard')

const NOW = new Date(2026, 10, 15, 12, 0).getTime()
const FREED = new Date(2026, 10, 15, 6, 10).getTime()

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
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
