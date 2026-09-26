// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivePluginPanel } from '@/store/plugin-panels'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  navPanels: [] as ActivePluginPanel[],
  closePluginNavPage: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

// Only the nav-panel hook is faked; the surface predicates and the plugin
// system enablement check stay real, matching PluginNavSidebarEntries.test.tsx.
vi.mock('@/store/plugin-panels', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePluginNavPanels: () => mocks.navPanels
}))

vi.mock('../right-sidebar/PluginPanel', () => ({
  default: ({ tabKey }: { tabKey: string }) => <div data-testid="plugin-panel">{tabKey}</div>
}))

import PluginNavPage from './PluginNavPage'

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

describe('PluginNavPage', () => {
  beforeEach(() => {
    mocks.closePluginNavPage.mockReset()
    mocks.state = {
      settings: { pluginSystemEnabled: true },
      activePluginNavTabKey: 'plugin:orca-samples.demo/inbox',
      closePluginNavPage: mocks.closePluginNavPage
    }
    mocks.navPanels = [navPanel()]
  })

  afterEach(cleanup)

  it('renders nothing when no plugin nav page is open', () => {
    mocks.state = { ...mocks.state, activePluginNavTabKey: null }
    const { container } = render(<PluginNavPage />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the panel title and the iframe host', () => {
    render(<PluginNavPage />)
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    expect(screen.getByTestId('plugin-panel')).toHaveTextContent('plugin:orca-samples.demo/inbox')
  })

  it('closes the page from the header button', () => {
    render(<PluginNavPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(mocks.closePluginNavPage).toHaveBeenCalledOnce()
  })

  it('closes the page on Escape', () => {
    render(<PluginNavPage />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(mocks.closePluginNavPage).toHaveBeenCalledOnce()
  })

  it('blurs an editable element on Escape instead of closing', () => {
    render(<PluginNavPage />)
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(document.activeElement).not.toBe(input)
    expect(mocks.closePluginNavPage).not.toHaveBeenCalled()
    input.remove()
  })

  it('renders no header title when the panel is no longer installed', () => {
    mocks.navPanels = []
    render(<PluginNavPage />)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })
})
