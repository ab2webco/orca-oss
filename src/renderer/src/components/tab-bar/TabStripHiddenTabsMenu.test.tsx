// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabStripHiddenTabsMenu } from './TabStripHiddenTabsMenu'

const TABS = [
  { id: 'tab-2', label: 'Terminal 2' },
  { id: 'tab-3', label: 'Terminal 3' }
]

afterEach(cleanup)

// Why (ORCA-717): below 120 px the scroll chevrons hide, and the tabs past the one shown vanished with no hint.
describe('TabStripHiddenTabsMenu', () => {
  it('shows a +N badge for the hidden tabs, only in a tab bar under 120 px', () => {
    render(<TabStripHiddenTabsMenu tabs={TABS} onSelect={vi.fn()} />)

    const badge = screen.getByRole('button', { name: '2 more tabs' })
    expect(badge.textContent).toBe('+2')
    expect(badge.className).toContain('hidden')
    expect(badge.className).toContain('@max-[120px]/tab-bar:flex')
  })

  it('shows nothing when no tab is hidden', () => {
    const { container } = render(<TabStripHiddenTabsMenu tabs={[]} onSelect={vi.fn()} />)

    expect(container.innerHTML).toBe('')
  })

  it('lists the hidden tabs on click and activates the one picked', () => {
    const onSelect = vi.fn()
    render(<TabStripHiddenTabsMenu tabs={TABS} onSelect={onSelect} />)

    fireEvent.keyDown(screen.getByRole('button', { name: '2 more tabs' }), { key: 'Enter' })
    expect(screen.getAllByRole('menuitem').map((row) => row.textContent)).toEqual([
      'Terminal 2',
      'Terminal 3'
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal 3' }))

    expect(onSelect).toHaveBeenCalledWith('tab-3')
  })
})
