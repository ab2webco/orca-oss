// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarHiddenFiltersLine } from './SidebarHiddenFiltersLine'
import type { HiddenByFiltersBreakdown } from './sidebar-filter-hidden-count'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}))

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
})

async function render(element: React.JSX.Element): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(element))
  return host
}

const BREAKDOWN: HiddenByFiltersBreakdown = {
  total: 4,
  counts: [
    { filter: 'cli', count: 1 },
    { filter: 'detached-head', count: 3 }
  ],
  hiddenIds: ['a', 'b', 'c', 'd']
}

describe('SidebarHiddenFiltersLine', () => {
  it('draws nothing when the filters hide no worktree', async () => {
    const host = await render(
      <SidebarHiddenFiltersLine
        breakdown={{ total: 0, counts: [], hiddenIds: [] }}
        revealed={false}
        onToggleReveal={() => {}}
      />
    )
    expect(host.querySelector('[data-sidebar-hidden-by-filters]')).toBeNull()
  })

  it('names each filter that hides rows, with its count, largest first', async () => {
    const host = await render(
      <SidebarHiddenFiltersLine breakdown={BREAKDOWN} revealed={false} onToggleReveal={() => {}} />
    )
    const line = host.querySelector('[data-sidebar-hidden-by-filters]')!
    expect(line.getAttribute('data-sidebar-hidden-by-filters')).toBe('4')
    expect(line.textContent).toContain('4 hidden:')
    expect(line.textContent).toContain('3 detached HEAD · 1 CLI-created')
    expect(line.querySelector('button')!.textContent).toBe('Show')
  })

  it('toggles between Show and Hide', async () => {
    const onToggleReveal = vi.fn()
    const host = await render(
      <SidebarHiddenFiltersLine
        breakdown={BREAKDOWN}
        revealed={false}
        onToggleReveal={onToggleReveal}
      />
    )
    const button = host.querySelector('button')!
    expect(button.getAttribute('aria-pressed')).toBe('false')
    await act(async () => button.click())
    expect(onToggleReveal).toHaveBeenCalledTimes(1)

    const revealedHost = await render(
      <SidebarHiddenFiltersLine breakdown={BREAKDOWN} revealed onToggleReveal={onToggleReveal} />
    )
    const revealedButton = revealedHost.querySelector('button')!
    expect(revealedButton.textContent).toBe('Hide')
    expect(revealedButton.getAttribute('aria-pressed')).toBe('true')
  })
})
