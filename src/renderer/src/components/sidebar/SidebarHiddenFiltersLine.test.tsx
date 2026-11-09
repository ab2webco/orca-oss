// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarHiddenFiltersLine } from './SidebarHiddenFiltersLine'

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

describe('SidebarHiddenFiltersLine', () => {
  it('draws nothing when the filters hide no worktree', async () => {
    const host = await render(<SidebarHiddenFiltersLine count={0} onShowFilters={() => {}} />)
    expect(host.querySelector('[data-sidebar-hidden-by-filters]')).toBeNull()
  })

  it('counts the hidden worktrees and opens the filters from its link', async () => {
    const onShowFilters = vi.fn()
    const host = await render(<SidebarHiddenFiltersLine count={3} onShowFilters={onShowFilters} />)
    const line = host.querySelector('[data-sidebar-hidden-by-filters]')!
    expect(line.getAttribute('data-sidebar-hidden-by-filters')).toBe('3')
    expect(line.textContent).toContain('3 hidden by filters')
    await act(async () => line.querySelector('button')!.click())
    expect(onShowFilters).toHaveBeenCalledTimes(1)
  })
})
