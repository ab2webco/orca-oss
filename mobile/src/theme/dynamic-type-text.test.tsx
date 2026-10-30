import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

const windowDimensions = vi.hoisted(() => ({ width: 390, fontScale: 1 }))

vi.mock('react-native', () => ({
  Text: 'Text',
  TextInput: 'TextInput',
  useWindowDimensions: () => windowDimensions
}))

import {
  MAX_FONT_SIZE_MULTIPLIER,
  Text,
  TextInput,
  useCompactTextLayout
} from './dynamic-type-text'

function render(element: ReturnType<typeof createElement>): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(element)
  })
  return renderer
}

describe('dynamic type text', () => {
  it('caps Text and TextInput at the shared multiplier by default', () => {
    const text = render(createElement(Text, null, 'Welcome back'))
    const input = render(createElement(TextInput, { value: 'msg' }))

    expect(text.root.findByType('Text' as never).props.maxFontSizeMultiplier).toBe(
      MAX_FONT_SIZE_MULTIPLIER
    )
    expect(input.root.findByType('TextInput' as never).props.maxFontSizeMultiplier).toBe(
      MAX_FONT_SIZE_MULTIPLIER
    )
  })

  it('lets a caller choose its own cap or turn scaling off', () => {
    const text = render(createElement(Text, { maxFontSizeMultiplier: 1 }, 'Tab'))
    const input = render(createElement(TextInput, { allowFontScaling: false }))

    expect(text.root.findByType('Text' as never).props.maxFontSizeMultiplier).toBe(1)
    expect(input.root.findByType('TextInput' as never).props.allowFontScaling).toBe(false)
  })

  it('reports a compact text layout only when the width cannot hold the capped text side by side', () => {
    function compactAt(width: number, fontScale: number): boolean {
      windowDimensions.width = width
      windowDimensions.fontScale = fontScale
      let compact: boolean | undefined
      function Probe() {
        compact = useCompactTextLayout()
        return null
      }
      render(createElement(Probe))
      return compact === true
    }

    // Why: 320 dp at font_scale 2.0 broke "New Wor/kspace"; the scale is capped at 1.4.
    expect(compactAt(320, 2)).toBe(true)
    expect(compactAt(320, 1.3)).toBe(true)
    expect(compactAt(320, 1)).toBe(false)
    expect(compactAt(430, 3.5)).toBe(false)
  })

  it('keeps the cap inside the range where fixed icons and rows still fit', () => {
    expect(MAX_FONT_SIZE_MULTIPLIER).toBeGreaterThanOrEqual(1.3)
    expect(MAX_FONT_SIZE_MULTIPLIER).toBeLessThanOrEqual(1.5)
  })
})
