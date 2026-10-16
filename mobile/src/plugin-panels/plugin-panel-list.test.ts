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

  it('carries the panel icon name and a well-formed custom svg tree', () => {
    const iconSvg = {
      tag: 'svg',
      attributes: { viewBox: '0 0 24 24', fill: 'currentColor' },
      children: [
        { tag: 'path', attributes: { d: 'M0 0h24v24H0z', 'stroke-width': '2' }, children: [] }
      ]
    }
    const [panel] = listHostablePluginPanels([
      plugin({ panels: [{ id: 'board', title: 'Inbox', surface: 'nav', icon: 'inbox', iconSvg }] })
    ])

    expect(panel?.icon).toBe('inbox')
    expect(panel?.iconSvg).toEqual(iconSvg)
  })

  it('drops attributes outside the shared allow-list but keeps the tree', () => {
    const [panel] = listHostablePluginPanels([
      plugin({
        panels: [
          {
            id: 'board',
            title: 'Inbox',
            surface: 'nav',
            iconSvg: {
              tag: 'svg',
              attributes: { viewBox: '0 0 24 24', onPress: 'x' },
              children: [{ tag: 'circle', attributes: { r: '4', href: 'x' }, children: [] }]
            }
          }
        ]
      })
    ])

    expect(panel?.iconSvg).toEqual({
      tag: 'svg',
      attributes: { viewBox: '0 0 24 24' },
      children: [{ tag: 'circle', attributes: { r: '4' }, children: [] }]
    })
  })

  it('drops only a malformed custom svg and keeps the panel', () => {
    const malformed: unknown[] = [
      'not a tree',
      { tag: 'g', attributes: {}, children: [] },
      { tag: 'svg', attributes: {}, children: [{ tag: 'script', attributes: {}, children: [] }] },
      { tag: 'svg', attributes: { viewBox: 7 }, children: [] },
      { tag: 'svg', attributes: {}, children: 'nope' },
      { tag: 'svg', attributes: null, children: [] }
    ]
    for (const iconSvg of malformed) {
      const panels = listHostablePluginPanels([
        plugin({ panels: [{ id: 'board', title: 'Inbox', surface: 'nav', icon: '', iconSvg }] })
      ])
      expect(panels).toHaveLength(1)
      expect(panels[0]).not.toHaveProperty('iconSvg')
      expect(panels[0]).not.toHaveProperty('icon')
    }
  })
})
