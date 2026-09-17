// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivePluginPanel } from '@/store/plugin-panels'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  navPanels: [] as ActivePluginPanel[]
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

// Only the nav-panel hook is faked; the surface predicates stay real so this
// suite cannot pass against a broken one.
vi.mock('@/store/plugin-panels', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePluginNavPanels: () => mocks.navPanels
}))

const { PluginNavSidebarEntries } = await import('./PluginNavSidebarEntries')

function navPanel(overrides: Partial<ActivePluginPanel> = {}): ActivePluginPanel {
  return {
    id: 'inbox',
    title: 'Inbox',
    tabKey: 'plugin:orca-samples.demo/inbox',
    surface: 'nav',
    pluginKey: 'orca-samples.demo',
    pluginName: 'Demo',
    ...overrides
  }
}

let container: HTMLDivElement
let root: Root

function render(): void {
  act(() => {
    root.render(<PluginNavSidebarEntries />)
  })
}

beforeEach(() => {
  mocks.state = {
    settings: { pluginSystemEnabled: true },
    openPluginNavPage: vi.fn(),
    activeView: 'workspaces',
    activePluginNavTabKey: null
  }
  mocks.navPanels = []
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('PluginNavSidebarEntries badge', () => {
  it('renders the plugin count next to its nav entry', () => {
    mocks.navPanels = [navPanel({ badgeCount: 4 })]
    render()
    expect(container.textContent).toContain('Inbox')
    expect(container.textContent).toContain('4')
  })

  it('renders no badge at all when the plugin declares none', () => {
    mocks.navPanels = [navPanel()]
    render()
    // Un "0" colgado seria peor que no tener contador: el usuario leeria que
    // el plugin reviso y no encontro nada, cuando en realidad no dijo nada.
    expect(container.textContent).toBe('Inbox')
  })

  it('never shows a zero or negative count that slipped past the host', () => {
    mocks.navPanels = [
      navPanel({ badgeCount: 0 }),
      navPanel({
        id: 'alerts',
        title: 'Alerts',
        tabKey: 'plugin:orca-samples.demo/alerts',
        badgeCount: -3
      })
    ]
    render()
    expect(container.textContent).toBe('InboxAlerts')
  })

  it('caps the display at 99+ instead of widening the sidebar', () => {
    mocks.navPanels = [navPanel({ badgeCount: 99 })]
    render()
    expect(container.textContent).toContain('99')
    expect(container.textContent).not.toContain('99+')

    act(() => {
      root.unmount()
    })
    root = createRoot(container)
    mocks.navPanels = [navPanel({ badgeCount: 1240 })]
    render()
    expect(container.textContent).toContain('99+')
    expect(container.textContent).not.toContain('1240')
  })
})
