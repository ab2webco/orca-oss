import { describe, expect, it } from 'vitest'
import {
  MOBILE_PLUGIN_PANELS_CAPABILITY,
  arePluginPanelsSupportedByHost,
  listHostablePluginPanels
} from './plugin-panel-list'

function plugin(overrides: Record<string, unknown> = {}) {
  return {
    pluginKey: 'demo.inbox',
    name: 'Inbox',
    status: 'running',
    panels: [
      { id: 'config', title: 'Inbox settings', surface: 'settings' },
      { id: 'board', title: 'Inbox', surface: 'nav' },
      { id: 'sidebar', title: 'Context', surface: 'worktree' },
      { id: 'legacy', title: 'Legacy' }
    ],
    ...overrides
  }
}

describe('arePluginPanelsSupportedByHost', () => {
  it('requires the advertised capability', () => {
    expect(arePluginPanelsSupportedByHost([MOBILE_PLUGIN_PANELS_CAPABILITY])).toBe(true)
    expect(arePluginPanelsSupportedByHost(['mobile.tasks.v1'])).toBe(false)
    expect(arePluginPanelsSupportedByHost(undefined)).toBe(false)
  })
})

describe('listHostablePluginPanels', () => {
  it('lists nav panels first, then settings, and leaves worktree panels out', () => {
    const panels = listHostablePluginPanels([
      plugin(),
      plugin({
        pluginKey: 'acme.crm',
        name: 'CRM',
        panels: [{ id: 'a', title: 'CRM', surface: 'nav' }]
      })
    ])

    expect(panels.map((panel) => `${panel.pluginKey}/${panel.panelId}`)).toEqual([
      'acme.crm/a',
      'demo.inbox/board',
      'demo.inbox/config'
    ])
    expect(panels[1]).toEqual({
      pluginKey: 'demo.inbox',
      pluginName: 'Inbox',
      panelId: 'board',
      title: 'Inbox',
      surface: 'nav'
    })
  })

  it('shows panels only for enabled, consented plugins whose panels mount', () => {
    for (const status of ['running', 'restarting', 'idle']) {
      expect(listHostablePluginPanels([plugin({ status })])).toHaveLength(2)
    }
    for (const status of ['pending', 'disabled', 'errored', 'invalid', 'unknown']) {
      expect(listHostablePluginPanels([plugin({ status })])).toEqual([])
    }
  })

  it('drops malformed entries instead of failing the whole list', () => {
    expect(
      listHostablePluginPanels([
        null,
        'x',
        { pluginKey: 'demo.x', status: 'running', panels: 'nope' },
        plugin({
          panels: [
            { id: 7, title: 'bad', surface: 'nav' },
            { id: 'ok', title: 'Ok', surface: 'nav' }
          ]
        })
      ]).map((panel) => panel.panelId)
    ).toEqual(['ok'])
    expect(listHostablePluginPanels({ not: 'a list' })).toEqual([])
  })
})
