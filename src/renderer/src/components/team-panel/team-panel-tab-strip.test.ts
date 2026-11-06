import { describe, expect, it } from 'vitest'
import { tabStripScrollLeftFor } from './team-panel-tab-strip'

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
