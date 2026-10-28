import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ Text: 'Text', TextInput: 'TextInput' }))

import { MAX_FONT_SIZE_MULTIPLIER, Text, TextInput } from './dynamic-type-text'

function render(element: ReturnType<typeof createElement>): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined
  act(() => {
    renderer = create(element)
  })
  if (!renderer) {
    throw new Error('renderer was not created')
  }
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

  it('keeps the cap inside the range where fixed icons and rows still fit', () => {
    expect(MAX_FONT_SIZE_MULTIPLIER).toBeGreaterThanOrEqual(1.3)
    expect(MAX_FONT_SIZE_MULTIPLIER).toBeLessThanOrEqual(1.5)
  })
})
