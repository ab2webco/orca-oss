import { describe, expect, it, vi } from 'vitest'
import { activateTabBarItem, tabsBesideActive } from './tab-strip-hidden-tabs'

// Why (ORCA-717): under 120 px the strip fits one tab, so the rest need a visible way back.
describe('tabsBesideActive', () => {
  it('lists every tab but the active one, in strip order, with its label', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    expect(tabsBesideActive(items, 'b', (item) => `Tab ${item.id}`)).toEqual([
      { item: { id: 'a' }, label: 'Tab a' },
      { item: { id: 'c' }, label: 'Tab c' }
    ])
  })
})

describe('activateTabBarItem', () => {
  it('activates each tab kind through its own handler', () => {
    const handlers = {
      onActivate: vi.fn(),
      onActivateFile: vi.fn(),
      onActivateBrowserTab: vi.fn()
    }

    activateTabBarItem({ type: 'terminal', id: 't1' }, handlers)
    activateTabBarItem({ type: 'browser', id: 'b1' }, handlers)
    activateTabBarItem({ type: 'editor', id: 'e1' }, handlers)
    activateTabBarItem({ type: 'simulator', id: 's1' }, handlers)

    expect(handlers.onActivate).toHaveBeenCalledWith('t1')
    expect(handlers.onActivateBrowserTab).toHaveBeenCalledWith('b1')
    expect(handlers.onActivateFile.mock.calls).toEqual([['e1'], ['s1']])
  })
})
