import { describe, expect, it } from 'vitest'
import {
  resolveRightDrawerPanelWidth,
  WIDE_PANEL_MAX_WIDTH,
  NARROW_BACKDROP_GUTTER,
  rightDrawerSpansWindow
} from './right-drawer-panel-width'

describe('resolveRightDrawerPanelWidth', () => {
  it('caps to the wide max width on wide layouts', () => {
    expect(resolveRightDrawerPanelWidth(1024, true, undefined)).toBe(WIDE_PANEL_MAX_WIDTH)
  })

  it('leaves a backdrop gutter on narrow layouts', () => {
    expect(resolveRightDrawerPanelWidth(400, false, undefined)).toBe(400 - NARROW_BACKDROP_GUTTER)
  })

  it('honors an explicit widthPx but never exceeds the window width', () => {
    expect(resolveRightDrawerPanelWidth(1024, true, 320)).toBe(320)
    expect(resolveRightDrawerPanelWidth(280, false, 320)).toBe(280)
  })

  it('never returns a negative width on tiny windows', () => {
    expect(resolveRightDrawerPanelWidth(20, false, undefined)).toBe(0)
  })

  it('clamps a negative explicit widthPx to zero', () => {
    expect(resolveRightDrawerPanelWidth(400, false, -10)).toBe(0)
  })

  it('fills a phone window when asked, so nothing peeks beside the panel', () => {
    expect(resolveRightDrawerPanelWidth(320, false, undefined, true)).toBe(320)
    expect(resolveRightDrawerPanelWidth(390, false, undefined, true)).toBe(390)
  })

  it('still caps a wide layout when asked to fill phones', () => {
    expect(resolveRightDrawerPanelWidth(1024, true, undefined, true)).toBe(WIDE_PANEL_MAX_WIDTH)
  })
})

describe('rightDrawerSpansWindow', () => {
  it('is true only when the panel covers the whole window', () => {
    expect(rightDrawerSpansWindow(390, 390)).toBe(true)
    expect(rightDrawerSpansWindow(342, 390)).toBe(false)
  })
})
