import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/dashboard/useAgentBucketCounts', () => ({
  useAgentBucketCounts: () => ({ attention: 1, working: 2, done: 3, idle: 4 })
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

describe('AgentDashboardSidebarEntry', () => {
  it('draws every bucket count through the shared status dot', async () => {
    const { default: Entry } = await import('./AgentDashboardSidebarEntry')
    const markup = renderToStaticMarkup(<Entry />)

    for (const tone of ['attention', 'info', 'success', 'idle']) {
      expect(markup).toContain(`data-status-tone="${tone}"`)
    }
  })
})
