import { describe, expect, it } from 'vitest'
import { tabStripOverflowOf, tabStripScrollLeftFor } from './team-panel-tab-strip'

const strip = { left: 100, right: 319 }

describe('tabStripScrollLeftFor', () => {
  it('scrolls a tab clipped on the right fully into the strip', () => {
    expect(tabStripScrollLeftFor(strip, { left: 290, right: 370 }, 0)).toBe(63)
  })

  it('scrolls back to a tab clipped on the left', () => {
    expect(tabStripScrollLeftFor(strip, { left: 60, right: 120 }, 80)).toBe(28)
  })

  it('leaves the strip alone when the tab is already whole', () => {
    expect(tabStripScrollLeftFor(strip, { left: 150, right: 200 }, 40)).toBe(40)
  })
})

describe('tabStripOverflowOf', () => {
  it('marks the end when tabs sit past the right edge', () => {
    expect(tabStripOverflowOf({ scrollLeft: 0, scrollWidth: 284, clientWidth: 219 })).toEqual({
      start: false,
      end: true
    })
  })

  it('marks the start once scrolled to the end', () => {
    expect(tabStripOverflowOf({ scrollLeft: 65, scrollWidth: 284, clientWidth: 219 })).toEqual({
      start: true,
      end: false
    })
  })

  it('marks neither when every tab fits, ignoring sub-pixel rounding', () => {
    expect(tabStripOverflowOf({ scrollLeft: 0, scrollWidth: 300.5, clientWidth: 300 })).toEqual({
      start: false,
      end: false
    })
  })
})
