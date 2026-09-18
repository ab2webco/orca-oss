import { describe, expect, it } from 'vitest'
import {
  PANEL_CONTENT_HEIGHT_MAX_PX,
  PANEL_CONTENT_HEIGHT_MIN_PX,
  PANEL_CONTENT_HEIGHT_TYPE,
  readPanelContentHeight
} from './plugin-panel-bridge'

/** The frame is sandboxed without allow-same-origin, so this number is the one
 *  thing the host takes from the panel and turns into layout. Everything the
 *  reader lets through becomes an allocated frame height. */

describe('readPanelContentHeight', () => {
  it('accepts a measured height, rounding up to the whole pixel', () => {
    expect(readPanelContentHeight({ type: PANEL_CONTENT_HEIGHT_TYPE, height: 640 })).toBe(640)
    expect(readPanelContentHeight({ type: PANEL_CONTENT_HEIGHT_TYPE, height: 639.2 })).toBe(640)
  })

  it('clamps a height no panel can honestly have measured', () => {
    expect(readPanelContentHeight({ type: PANEL_CONTENT_HEIGHT_TYPE, height: 2_000_000 })).toBe(
      PANEL_CONTENT_HEIGHT_MAX_PX
    )
    expect(readPanelContentHeight({ type: PANEL_CONTENT_HEIGHT_TYPE, height: 1 })).toBe(
      PANEL_CONTENT_HEIGHT_MIN_PX
    )
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['zero', 0],
    ['negative', -400],
    ['string', '400'],
    ['null', null],
    ['missing', undefined]
  ])('rejects %s instead of clamping it into a height', (_label, height) => {
    expect(readPanelContentHeight({ type: PANEL_CONTENT_HEIGHT_TYPE, height })).toBeNull()
  })

  it.each([
    ['another bridge frame', { type: 'orca-panel-pong', pingId: 1, height: 400 }],
    ['an untyped object', { height: 400 }],
    ['a string', PANEL_CONTENT_HEIGHT_TYPE],
    ['a number', 400],
    ['null', null],
    ['undefined', undefined]
  ])('ignores %s', (_label, data) => {
    expect(readPanelContentHeight(data)).toBeNull()
  })
})
