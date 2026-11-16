import { describe, expect, it } from 'vitest'
import { sidebarHoverCardSide } from './sidebar-hover-card-side'

describe('sidebarHoverCardSide', () => {
  it('opens beside the row while the card fits in the window', () => {
    expect(sidebarHoverCardSide({ triggerRight: 274, viewportWidth: 1440, cardWidth: 288 })).toBe(
      'right'
    )
    expect(sidebarHoverCardSide({ triggerRight: 274, viewportWidth: 578, cardWidth: 288 })).toBe(
      'right'
    )
  })

  it('opens under the row when the card would run past the right edge', () => {
    expect(sidebarHoverCardSide({ triggerRight: 274, viewportWidth: 577, cardWidth: 288 })).toBe(
      'bottom'
    )
    expect(sidebarHoverCardSide({ triggerRight: 274, viewportWidth: 320, cardWidth: 288 })).toBe(
      'bottom'
    )
  })
})
