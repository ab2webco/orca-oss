import { describe, expect, it } from 'vitest'
import {
  RIGHT_SIDEBAR_ABSOLUTE_FALLBACK_MAX_WIDTH,
  RIGHT_SIDEBAR_MIN_WIDTH,
  clampRightSidebarPanelWidth,
  computeMaxRightSidebarPanelWidth,
  rightSidebarOverlaysContent
} from './right-sidebar-width'

describe('right sidebar rendered width', () => {
  it('leaves the reserved non-sidebar area when persisted width is too large', () => {
    expect(clampRightSidebarPanelWidth(900, 900, 0)).toBe(580)
  })

  it('includes rendered extra width in the reservation math', () => {
    expect(computeMaxRightSidebarPanelWidth(900, 40)).toBe(540)
    expect(clampRightSidebarPanelWidth(900, 900, 40)).toBe(540)
  })

  it('preserves the minimum sidebar width on narrow windows', () => {
    expect(clampRightSidebarPanelWidth(900, 400, 40)).toBe(RIGHT_SIDEBAR_MIN_WIDTH)
  })

  it('uses the fallback max outside DOM environments', () => {
    expect(computeMaxRightSidebarPanelWidth(null, 40)).toBe(
      RIGHT_SIDEBAR_ABSOLUTE_FALLBACK_MAX_WIDTH
    )
  })
})

// ORCA-1163: at 390 both sidebars outgrew the window and the app row scrolled sideways.
describe('rightSidebarOverlaysContent', () => {
  it('overlays the content when both sidebars and the content area do not fit', () => {
    expect(
      rightSidebarOverlaysContent({ windowWidth: 390, leftSidebarWidth: 280, rightPanelWidth: 220 })
    ).toBe(true)
  })

  it('keeps its own column when everything fits', () => {
    expect(
      rightSidebarOverlaysContent({
        windowWidth: 1440,
        leftSidebarWidth: 280,
        rightPanelWidth: 360
      })
    ).toBe(false)
  })

  // Why 768 stays a column: there the terminal keeps the ~137 px it had before this rule.
  it('keeps the column at 768, where the content still has room', () => {
    expect(
      rightSidebarOverlaysContent({ windowWidth: 768, leftSidebarWidth: 280, rightPanelWidth: 350 })
    ).toBe(false)
  })

  it('counts a closed left sidebar as no width', () => {
    expect(
      rightSidebarOverlaysContent({ windowWidth: 560, leftSidebarWidth: 0, rightPanelWidth: 220 })
    ).toBe(false)
  })

  it('never overlays when the window width is unknown', () => {
    expect(
      rightSidebarOverlaysContent({
        windowWidth: null,
        leftSidebarWidth: 280,
        rightPanelWidth: 220
      })
    ).toBe(false)
  })
})
