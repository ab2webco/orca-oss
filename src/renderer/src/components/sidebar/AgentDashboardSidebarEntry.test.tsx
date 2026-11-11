// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const counts = vi.hoisted(() => ({ value: { attention: 1, working: 2, done: 3, idle: 4 } }))
vi.mock('@/components/dashboard/useAgentBucketCounts', () => ({
  useAgentBucketCounts: () => counts.value
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      settings: { experimentalAgentDashboardShowIdle: true },
      agentDashboardDrawerOpen: false,
      setAgentDashboardDrawerOpen: () => {}
    })
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

const { default: Entry } = await import('./AgentDashboardSidebarEntry')

function entry(): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<Entry />)
  return host
}

afterEach(() => {
  counts.value = { attention: 1, working: 2, done: 3, idle: 4 }
})

// ORCA-1148: V30's drawNav shows who needs you and who is working, nothing else.
describe('AgentDashboardSidebarEntry', () => {
  it('shows the waiting count with the question mark and the working count with the spinner', () => {
    const host = entry()

    const waiting = host.querySelector('[aria-label="Needs You: 1"]')!
    expect(waiting.querySelector('[data-status-tone="attention"] svg')).not.toBeNull()
    const working = host.querySelector('[aria-label="Working: 2"]')!
    expect(working.querySelector('[data-agent-spinner]')).not.toBeNull()
    expect(host.querySelector('[aria-label^="Done"]')).toBeNull()
    expect(host.querySelector('[aria-label^="Idle"]')).toBeNull()
  })

  it('keeps the working count at zero and hides the waiting count when nobody waits', () => {
    counts.value = { attention: 0, working: 0, done: 2, idle: 0 }
    const host = entry()

    expect(host.querySelector('[aria-label^="Needs You"]')).toBeNull()
    expect(host.querySelector('[aria-label="Working: 0"]')).not.toBeNull()
  })
})
