import { Plug } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import type { ActivePluginPanel } from '@/store/plugin-panels'
import { getPluginPanelActivityItems } from './plugin-panel-activity-items'

const panel: ActivePluginPanel = {
  id: 'dashboard',
  title: 'Dashboard',
  tabKey: 'plugin:orca-samples.demo/dashboard',
  pluginKey: 'orca-samples.demo',
  pluginName: 'Demo'
}

describe('getPluginPanelActivityItems', () => {
  it('keeps a hostile manifest icon renderable by the activity bar', () => {
    // Object / Object.prototype are not valid React element types: rendering
    // either throws past the right-sidebar boundary and blanks the whole rail.
    const item = getPluginPanelActivityItems([{ ...panel, icon: 'constructor' }])[0]!
    expect(item.icon).not.toBe(Object)
    expect(item.icon).toBe(Plug)
  })

  it('keeps a settings-surface panel out of the per-worktree activity bar', () => {
    const settingsPanel: ActivePluginPanel = {
      ...panel,
      id: 'registry',
      tabKey: 'plugin:orca-samples.demo/registry',
      surface: 'settings'
    }

    expect(getPluginPanelActivityItems([panel, settingsPanel]).map((item) => item.id)).toEqual([
      panel.tabKey
    ])
  })

  it('keeps a nav-surface panel out of the per-worktree activity bar', () => {
    const navPanel: ActivePluginPanel = {
      ...panel,
      id: 'inbox',
      tabKey: 'plugin:orca-samples.demo/inbox',
      surface: 'nav'
    }

    expect(getPluginPanelActivityItems([panel, navPanel]).map((item) => item.id)).toEqual([
      panel.tabKey
    ])
  })

  it('treats a panel without a declared surface as a worktree panel', () => {
    expect(panel.surface).toBeUndefined()
    expect(getPluginPanelActivityItems([panel]).map((item) => item.id)).toEqual([panel.tabKey])
  })

  it('projects watchdog failure into host-owned activity chrome', () => {
    expect(
      getPluginPanelActivityItems([panel], {
        'plugin:orca-samples.demo/dashboard': true
      })[0]
    ).toMatchObject({
      id: panel.tabKey,
      statusIndicator: 'failure'
    })
  })
})
