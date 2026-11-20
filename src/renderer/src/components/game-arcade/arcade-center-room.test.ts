import { describe, expect, it } from 'vitest'
import { ARCADE_MIN_CENTER_WIDTH, arcadeNeedsRightPanelClosed } from './arcade-center-room'

describe('arcadeNeedsRightPanelClosed', () => {
  it('closes an open right panel when the center is narrower than the game needs', () => {
    expect(arcadeNeedsRightPanelClosed(137, true)).toBe(true)
    expect(arcadeNeedsRightPanelClosed(ARCADE_MIN_CENTER_WIDTH - 1, true)).toBe(true)
  })

  it('leaves the panel alone when the center already has room', () => {
    expect(arcadeNeedsRightPanelClosed(ARCADE_MIN_CENTER_WIDTH, true)).toBe(false)
    expect(arcadeNeedsRightPanelClosed(1100, true)).toBe(false)
  })

  it('does nothing when the panel is closed or the box is not laid out yet', () => {
    expect(arcadeNeedsRightPanelClosed(137, false)).toBe(false)
    expect(arcadeNeedsRightPanelClosed(0, true)).toBe(false)
  })
})
