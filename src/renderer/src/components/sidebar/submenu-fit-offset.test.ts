import { describe, expect, it } from 'vitest'
import { popupSideThatFits, submenuFitSideOffset } from './submenu-fit-offset'

// ORCA-1163: at 320 the Card display submenu opened past the window's right edge.
describe('submenuFitSideOffset', () => {
  it('pulls the submenu back over its parent by exactly the overflow', () => {
    // Trigger ends at 180; a 224 px submenu plus an 8 px margin needs 412 of a 320 window.
    expect(submenuFitSideOffset({ triggerRight: 180, submenuWidth: 224, viewportWidth: 320 })).toBe(
      -92
    )
  })

  it('leaves the submenu beside its parent when it fits', () => {
    expect(
      submenuFitSideOffset({ triggerRight: 500, submenuWidth: 224, viewportWidth: 1440 })
    ).toBe(0)
  })
})

// ORCA-1163: the 288 px options menu opened to the right of a trigger at 200 in a 320 window.
describe('popupSideThatFits', () => {
  it('opens beside the trigger when the window has room', () => {
    expect(
      popupSideThatFits({ triggerRight: 220, popupWidth: 288, sideOffset: 8, viewportWidth: 1440 })
    ).toBe('right')
  })

  it('opens below the trigger when it would leave the window to the right', () => {
    expect(
      popupSideThatFits({ triggerRight: 220, popupWidth: 288, sideOffset: 8, viewportWidth: 320 })
    ).toBe('bottom')
  })
})
