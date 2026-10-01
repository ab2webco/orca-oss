// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivePluginPanel } from '@/store/plugin-panels'
import { TooltipProvider } from '../ui/tooltip'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  navPanels: [] as ActivePluginPanel[],
  closePluginNavPage: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

// Only the nav-panel hook is faked; the plugin system enablement check stays real.
vi.mock('@/store/plugin-panels', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePluginNavPanels: () => mocks.navPanels
}))

vi.mock('../right-sidebar/PluginPanel', () => ({
  default: ({ tabKey, onCloseRequested }: { tabKey: string; onCloseRequested?: () => void }) => (
    <div data-testid="plugin-panel">
      {tabKey}
      {onCloseRequested ? (
        <button type="button" onClick={onCloseRequested}>
          panel asks to close
        </button>
      ) : null}
    </div>
  )
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

function renderPage(): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <PluginNavPage />
    </TooltipProvider>
  )
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
    const { container } = renderPage()
    expect(container).toBeEmptyDOMElement()
  })

  it('titles the page with the panel it hosts', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    expect(screen.getByTestId('plugin-panel')).toHaveTextContent('plugin:orca-samples.demo/inbox')
  })

  it('closes the page from a labelled, focusable host button', () => {
    renderPage()
    const close = screen.getByRole('button', { name: 'Close Inbox' })
    close.focus()
    expect(document.activeElement).toBe(close)

    fireEvent.click(close)

    expect(mocks.closePluginNavPage).toHaveBeenCalledOnce()
  })

  it('closes the page on Escape', () => {
    renderPage()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(mocks.closePluginNavPage).toHaveBeenCalledOnce()
  })

  it('leaves Escape to an overlay that already handled it', () => {
    renderPage()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    event.preventDefault()
    window.dispatchEvent(event)
    expect(mocks.closePluginNavPage).not.toHaveBeenCalled()
  })

  it('blurs an editable element on Escape instead of closing', () => {
    renderPage()
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(document.activeElement).not.toBe(input)
    expect(mocks.closePluginNavPage).not.toHaveBeenCalled()
    input.remove()
  })

  it('lets the hosted panel close the page through panel.close', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'panel asks to close' }))
    expect(mocks.closePluginNavPage).toHaveBeenCalledOnce()
  })

  it('keeps a close button when the panel is no longer installed', () => {
    mocks.navPanels = []
    renderPage()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(mocks.closePluginNavPage).toHaveBeenCalledOnce()
  })
})
