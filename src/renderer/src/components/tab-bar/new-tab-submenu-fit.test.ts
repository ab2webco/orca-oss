// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { keepSubmenuOpenOnParentMenuFocus, submenuOffsetsInWindow } from './new-tab-submenu-fit'

const TRIGGER = { left: 510, right: 798, height: 28 }

// Why (ORCA-717): at 390 and 320 the + menu's Add member submenu opened at x -181 and -251.
describe('submenuOffsetsInWindow', () => {
  it('keeps the usual offset when the submenu fits beside its trigger', () => {
    expect(
      submenuOffsetsInWindow({ trigger: TRIGGER, width: 288, sideOffset: 6, viewportWidth: 1440 })
    ).toEqual({ sideOffset: 6, alignOffset: 0 })
  })

  it('keeps the usual offset when only the left side fits, so Radix flips it there', () => {
    expect(
      submenuOffsetsInWindow({
        trigger: { left: 346, right: 634, height: 28 },
        width: 288,
        sideOffset: 0,
        viewportWidth: 768
      })
    ).toEqual({ sideOffset: 0, alignOffset: 0 })
  })

  it('pulls the submenu into the window below its row when neither side fits', () => {
    expect(
      submenuOffsetsInWindow({
        trigger: { left: 32, right: 320, height: 28 },
        width: 288,
        sideOffset: 0,
        viewportWidth: 320
      })
    ).toEqual({ sideOffset: -296, alignOffset: 28 })
  })

  it('caps the width it reserves at the window less its margins', () => {
    expect(
      submenuOffsetsInWindow({
        trigger: { left: 200, right: 300, height: 20 },
        width: 352,
        sideOffset: 6,
        viewportWidth: 320
      })
    ).toEqual({ sideOffset: -292, alignOffset: 20 })
  })
})

function focusEventOn(target: Element): { target: Element; preventDefault: () => void } {
  return { target, preventDefault: vi.fn() }
}

describe('keepSubmenuOpenOnParentMenuFocus', () => {
  // Why: Radix focuses the parent menu itself when the pointer leaves the trigger on a path it
  // does not read as toward the submenu (a left-side or pulled-in one), which closed it.
  it('keeps the submenu open when focus lands on a menu itself', () => {
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    const event = focusEventOn(menu)

    keepSubmenuOpenOnParentMenuFocus(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('lets a focused item of the parent menu close it', () => {
    const item = document.createElement('div')
    item.setAttribute('role', 'menuitem')
    const event = focusEventOn(item)

    keepSubmenuOpenOnParentMenuFocus(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
