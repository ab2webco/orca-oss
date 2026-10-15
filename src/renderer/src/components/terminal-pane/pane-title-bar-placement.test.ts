import { describe, expect, it } from 'vitest'
import { resolvePaneTitleBarPlacement } from './pane-title-bar-placement'

const rect = { left: 10, top: 20, width: 300, height: 200 }

describe('resolvePaneTitleBarPlacement', () => {
  it('anchors a chromeless bottom strip at the pane bottom edge', () => {
    expect(
      resolvePaneTitleBarPlacement({ rect, isChromeless: true, position: 'bottom-right' })
    ).toEqual({
      top: 220,
      attributes: {
        'data-chromeless': '',
        'data-actions-edge': 'bottom',
        'data-actions-align': 'right'
      }
    })
  })

  it('keeps a chromeless top strip at the pane top edge', () => {
    expect(
      resolvePaneTitleBarPlacement({ rect, isChromeless: true, position: 'top-center' })
    ).toEqual({
      top: 20,
      attributes: {
        'data-chromeless': '',
        'data-actions-edge': 'top',
        'data-actions-align': 'center'
      }
    })
  })

  it('leaves a titled header on top without position attributes', () => {
    expect(
      resolvePaneTitleBarPlacement({ rect, isChromeless: false, position: 'bottom-left' })
    ).toEqual({ top: 20, attributes: {} })
  })
})
