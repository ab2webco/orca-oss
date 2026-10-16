import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostablePluginPanel } from './plugin-panel-list'
import HostPluginPanelsScreen from '../../app/h/[hostId]/plugins/index'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ hostId: 'desk' }),
  useRouter: () => ({ back: () => {}, push: () => {} })
}))

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  RefreshCw: 'RefreshCw'
}))

vi.mock('./PluginPanelIcon', async () => {
  const React = await import('react')
  return {
    PluginPanelIcon: (props: unknown) => React.createElement('PluginPanelIcon', props)
  }
})

vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: null, state: 'connected' })
}))

vi.mock('../transport/host-store', () => ({ loadHosts: async () => [] }))

vi.mock('../components/HostProtocolGate', () => ({
  useHostProtocolGates: () => ({ hostCapabilities: ['mobile.plugin-panels.v1'] })
}))

const panels = vi.hoisted((): HostablePluginPanel[] => [])
vi.mock('./use-host-plugin-panels', () => ({
  useHostPluginPanels: () => ({ panels, error: null, refreshing: false, refresh: () => {} })
}))

describe('Host plugin panels screen', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('shows each panel with its plugin icon', async () => {
    const iconSvg = { tag: 'svg' as const, attributes: { viewBox: '0 0 24 24' }, children: [] }
    panels.splice(
      0,
      panels.length,
      {
        pluginKey: 'demo.inbox',
        pluginName: 'Inbox',
        panelId: 'board',
        title: 'Inbox',
        surface: 'nav',
        icon: 'inbox'
      },
      {
        pluginKey: 'demo.inbox',
        pluginName: 'Inbox',
        panelId: 'config',
        title: 'Inbox settings',
        surface: 'settings',
        iconSvg
      }
    )
    await act(async () => {
      renderer = create(createElement(HostPluginPanelsScreen))
    })

    const rows = renderer!.root
      .findAllByType('Pressable')
      .filter((node) => String(node.props.accessibilityLabel).startsWith('Open '))
    expect(rows).toHaveLength(2)
    expect(rows[0]!.findByType('PluginPanelIcon').props).toMatchObject({ icon: 'inbox' })
    expect(rows[1]!.findByType('PluginPanelIcon').props).toMatchObject({ iconSvg })
  })
})
