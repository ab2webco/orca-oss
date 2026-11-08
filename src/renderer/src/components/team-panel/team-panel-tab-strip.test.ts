import { describe, expect, it } from 'vitest'
import { tabStripFitFor, tabStripOverflowOf, tabStripScrollLeftFor } from './team-panel-tab-strip'

const strip = { left: 100, right: 319 }

describe('tabStripScrollLeftFor', () => {
  it('scrolls a tab clipped on the right fully into the strip', () => {
    expect(tabStripScrollLeftFor(strip, { left: 290, right: 370 }, 0)).toBe(63)
  })

  it('scrolls back to a tab clipped on the left', () => {
    expect(tabStripScrollLeftFor(strip, { left: 60, right: 120 }, 80)).toBe(28)
  })

  it('scrolls a tab that ends inside the faded edge clear of it', () => {
    expect(tabStripScrollLeftFor(strip, { left: 240, right: 310 }, 0)).toBe(3)
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

describe('tabStripFitFor', () => {
  const full = { level: 0, needs: [] }

  it('steps to shorter labels while the tabs overflow, keeping what each level needed', () => {
    const short = tabStripFitFor(full, { scrollWidth: 339, clientWidth: 279 }, 3)
    expect(short).toEqual({ level: 1, needs: [339] })
    expect(tabStripFitFor(short, { scrollWidth: 300, clientWidth: 279 }, 3)).toEqual({
      level: 2,
      needs: [339, 300]
    })
  })

  it('stays at the level that fits', () => {
    const fits = { level: 2, needs: [339, 300] }
    expect(tabStripFitFor(fits, { scrollWidth: 279, clientWidth: 279 }, 3)).toBe(fits)
  })

  it('stops at the last level, where the scroll cue takes over', () => {
    const last = { level: 3, needs: [339, 300, 250] }
    expect(tabStripFitFor(last, { scrollWidth: 240, clientWidth: 219 }, 3)).toBe(last)
  })

  it('steps back to longer labels once the strip is as wide as they need', () => {
    const tight = { level: 2, needs: [339, 300] }
    expect(tabStripFitFor(tight, { scrollWidth: 400, clientWidth: 400 }, 3)).toEqual({
      level: 1,
      needs: [339, 300]
    })
    expect(tabStripFitFor(tight, { scrollWidth: 298, clientWidth: 298 }, 3)).toBe(tight)
  })

  it('never fits a strip that has no shorter labels', () => {
    expect(tabStripFitFor(full, { scrollWidth: 339, clientWidth: 279 }, 0)).toBe(full)
  })
})
