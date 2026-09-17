import { describe, expect, it } from 'vitest'
import {
  shouldClearPluginNavRoute,
  type PluginNavRouteInput
} from './plugin-nav-route-reconciliation'

function input(overrides: Partial<PluginNavRouteInput> = {}): PluginNavRouteInput {
  return {
    pluginSystemEnabled: true,
    fetchStatus: 'ready',
    routedViews: ['plugin'],
    activeNavTabKey: 'plugin:orca-samples.demo/inbox',
    liveNavTabKeys: ['plugin:orca-samples.demo/inbox'],
    ...overrides
  }
}

describe('shouldClearPluginNavRoute', () => {
  it('keeps a route whose panel the authoritative list still offers', () => {
    expect(shouldClearPluginNavRoute(input())).toBe(false)
  })

  it('waits for a settled list before calling a panel gone', () => {
    expect(shouldClearPluginNavRoute(input({ fetchStatus: 'loading', liveNavTabKeys: [] }))).toBe(
      false
    )
  })

  it('drops the route once the list proves the panel is gone', () => {
    expect(shouldClearPluginNavRoute(input({ liveNavTabKeys: [] }))).toBe(true)
  })

  it('drops the route when the plugin system itself is switched off', () => {
    expect(
      shouldClearPluginNavRoute(input({ pluginSystemEnabled: false, fetchStatus: 'loading' }))
    ).toBe(true)
  })

  it('clears a stale back target even while another view is active', () => {
    expect(
      shouldClearPluginNavRoute(
        input({ routedViews: ['automations', 'plugin'], activeNavTabKey: null, liveNavTabKeys: [] })
      )
    ).toBe(true)
  })

  it('does nothing when no route ever pointed at a plugin page', () => {
    expect(
      shouldClearPluginNavRoute(
        input({ routedViews: ['terminal'], activeNavTabKey: null, liveNavTabKeys: [] })
      )
    ).toBe(false)
  })
})
