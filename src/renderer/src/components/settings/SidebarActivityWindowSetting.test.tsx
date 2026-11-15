// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarActivityWindowSetting } from './SidebarActivityWindowSetting'

describe('SidebarActivityWindowSetting', () => {
  afterEach(cleanup)

  it('marks the 24 h default when the profile has no value', () => {
    render(<SidebarActivityWindowSetting settings={{}} updateSettings={vi.fn()} />)
    expect(screen.getByRole('radio', { name: '24 h' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      '12 h',
      '24 h',
      '3 d',
      '7 d'
    ])
  })

  it('saves the picked window in hours', () => {
    const updateSettings = vi.fn()
    render(
      <SidebarActivityWindowSetting
        settings={{ sidebarActivityWindowHours: 24 }}
        updateSettings={updateSettings}
      />
    )
    fireEvent.click(screen.getByRole('radio', { name: '3 d' }))
    expect(updateSettings).toHaveBeenCalledWith({ sidebarActivityWindowHours: 72 })
  })
})
