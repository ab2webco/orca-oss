import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { HostablePluginPanel } from './plugin-panel-list'
import { HostPluginPanelsRow } from './HostPluginPanelsRow'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  ChevronRight: 'ChevronRight'
}))

vi.mock('./PluginPanelIcon', async () => {
  const React = await import('react')
  return {
    PluginPanelIcon: (props: unknown) => React.createElement('PluginPanelIcon', props)
  }
})

const gates = vi.hoisted(() => ({
  hostCapabilities: ['mobile.plugin-panels.v1'] as string[]
}))
vi.mock('../components/HostProtocolGate', () => ({
  useHostProtocolGates: () => gates
}))

const hook = vi.hoisted(() => ({
  panels: null as HostablePluginPanel[] | null,
  args: null as { supported: boolean; connState: string } | null
}))
vi.mock('./use-host-plugin-panels', () => ({
  useHostPluginPanels: (args: { supported: boolean; connState: string }) => {
    hook.args = args
    return {
      panels: hook.panels,
      error: null,
      refreshing: false,
      refresh: () => {}
    }
  }
}))

const client = {} as RpcClient

function panel(overrides: Partial<HostablePluginPanel>): HostablePluginPanel {
  return {
    pluginKey: 'demo.inbox',
    pluginName: 'Inbox',
    panelId: 'board',
    title: 'Inbox board',
    surface: 'nav',
    ...overrides
  }
}

describe('HostPluginPanelsRow', () => {
  // Why: a `| null` union over this type trips no-redundant-type-constituents in the root lint.
  let mounted: ReactTestRenderer[] = []
  const latest = () => mounted.at(-1)!

  beforeEach(() => {
    gates.hostCapabilities = ['mobile.plugin-panels.v1']
    hook.panels = null
    hook.args = null
  })

  afterEach(() => {
    act(() => mounted.forEach((view) => view.unmount()))
    mounted = []
  })

  function render(connState: ConnectionState = 'connected', hostId: string | undefined = 'desk') {
    const open = vi.fn()
    act(() => {
      mounted.push(
        create(
          createElement(HostPluginPanelsRow, {
            hostId,
            client,
            connState,
            open
          })
        )
      )
    })
    return open
  }

  function cards() {
    return latest()
      .root.findAllByType('Pressable')
      .filter((node) => String(node.props.accessibilityLabel).startsWith('Open '))
  }

  it('shows one card per nav panel with the plugin icon, title and plugin name', () => {
    hook.panels = [
      panel({ icon: 'inbox' }),
      panel({
        pluginKey: 'acme.crm',
        pluginName: 'CRM',
        panelId: 'a',
        title: 'Deals'
      }),
      panel({
        panelId: 'config',
        title: 'Inbox settings',
        surface: 'settings'
      })
    ]
    render()

    expect(cards().map((card) => card.props.accessibilityLabel)).toEqual([
      'Open Inbox board',
      'Open Deals'
    ])
    const first = cards()[0]!
    expect(first.props.accessibilityRole).toBe('button')
    expect(first.findByType('PluginPanelIcon').props).toMatchObject({
      icon: 'inbox'
    })
    const texts = first.findAllByType('Text').map((node) => node.props.children)
    expect(texts).toEqual(['Inbox board', 'Inbox'])
    expect(first.findAllByType('Text')[0]!.props.numberOfLines).toBe(1)
  })

  it('keeps every card at least 44pt tall', () => {
    hook.panels = [panel({})]
    render()

    const style = [cards()[0]!.props.style({ pressed: false })].flat(3)
    const minHeight = Math.max(
      ...style.map((entry: { minHeight?: number } | false) => (entry ? (entry.minHeight ?? 0) : 0))
    )
    expect(minHeight).toBeGreaterThanOrEqual(44)
  })

  it('opens the panel route and the full plugins list', () => {
    hook.panels = [
      panel({
        pluginKey: 'demo.inbox',
        panelId: 'board',
        title: 'Inbox & more'
      })
    ]
    const open = render()

    act(() => cards()[0]!.props.onPress())
    expect(open).toHaveBeenLastCalledWith(
      '/h/desk/plugins/demo.inbox/board?title=Inbox%20%26%20more'
    )

    const all = latest()
      .root.findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'All plugins')!
    act(() => all.props.onPress())
    expect(open).toHaveBeenLastCalledWith('/h/desk/plugins')
  })

  it('renders nothing when the host refuses plugin panels', () => {
    gates.hostCapabilities = []
    hook.panels = [panel({})]
    render()

    expect(latest().toJSON()).toBeNull()
    expect(hook.args?.supported).toBe(false)
  })

  it('renders nothing before the first list arrives or without any panel', () => {
    render('disconnected')
    expect(latest().toJSON()).toBeNull()

    hook.panels = []
    render()
    expect(latest().toJSON()).toBeNull()
  })

  it('keeps the All entry when only settings panels exist', () => {
    hook.panels = [panel({ surface: 'settings' })]
    const open = render()

    expect(cards()).toHaveLength(0)
    expect(latest().root.findAllByType('ScrollView')).toHaveLength(0)
    const all = latest()
      .root.findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'All plugins')!
    act(() => all.props.onPress())
    expect(open).toHaveBeenLastCalledWith('/h/desk/plugins')
  })

  it('keeps the last list while the host reconnects', () => {
    hook.panels = [panel({})]
    render('reconnecting')

    expect(cards()).toHaveLength(1)
  })
})
