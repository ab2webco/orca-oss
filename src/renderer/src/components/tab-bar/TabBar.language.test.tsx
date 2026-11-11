// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n, translate } from '@/i18n/i18n'
import type { TabBarProps } from './tab-bar-props'

vi.mock('./use-tab-bar-runtime-model', () => ({
  useTabBarRuntimeModel: () => ({ resolvedGroupId: 'group-1', unpinTab: vi.fn(), pinTab: vi.fn() })
}))
vi.mock('./use-tab-bar-create-menu-controller', () => ({
  useTabBarCreateMenuController: () => ({})
}))
vi.mock('./use-tab-bar-item-projection', () => ({
  useTabBarItemProjection: () => ({
    activeVisibleTabId: null,
    tabStripLayoutKey: '',
    orderedItems: []
  })
}))
vi.mock('./tab-strip-overflow-navigation', () => ({
  useTabStripOverflowNavigation: () => ({
    scrollTabStrip: vi.fn(),
    tabStripOverflowState: { canScrollStart: false, canScrollEnd: false }
  })
}))
vi.mock('./tab-strip-drag-scroll', () => ({ useTabStripDragScrollHandlers: () => ({}) }))
vi.mock('@/runtime/use-remote-runtime-action-pending', () => ({
  useRemoteRuntimeActionPending: () => false
}))
// Why a stand-in surface: the memo boundary is what is under test, not the strip's own render.
vi.mock('./tab-bar-surface', () => ({
  renderTabBarSurface: () => (
    <button aria-label={translate('auto.components.tab.bar.TabBar.b1a132357f', 'New tab')} />
  )
}))

const { default: TabBar } = await import('./TabBar')

const noop = (): void => {}
const PROPS: TabBarProps = {
  tabs: [],
  activeTabId: null,
  worktreeId: 'wt-1',
  expandedPaneByTabId: {},
  onActivate: noop,
  onClose: noop,
  onCloseOthers: noop,
  onCloseToRight: noop,
  onCloseToLeft: noop,
  onNewTerminalTab: noop,
  onNewBrowserTab: noop,
  onSetCustomTitle: noop,
  onSetTabColor: noop,
  onTogglePaneExpand: noop
}

let root: Root | null = null

afterEach(async () => {
  await act(async () => {
    root?.unmount()
    await i18n.changeLanguage('en')
  })
  root = null
})

describe('TabBar language', () => {
  // Why (ORCA-717): the memoized tab bar kept the + labelled 'New tab' after a switch to Spanish.
  it('relabels the + when the UI language changes while it stays mounted', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<TabBar {...PROPS} />)
    })
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('New tab')

    await act(async () => {
      await i18n.changeLanguage('es')
    })

    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Nueva pestaña')
  })
})
