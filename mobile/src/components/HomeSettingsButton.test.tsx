import { createElement } from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIN_TOUCH_TARGET } from '../theme/mobile-theme'
import { HomeSettingsButton } from './HomeSettingsButton'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles }
}))
vi.mock('lucide-react-native', () => ({ Settings: 'Settings' }))

type FlatStyle = Record<string, unknown>

function flattenStyle(style: unknown): FlatStyle {
  if (typeof style === 'function') {
    return flattenStyle(style({ pressed: false }))
  }
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle))
  }
  return style && typeof style === 'object' ? (style as FlatStyle) : {}
}

// Why: holding the renderer in a `| null` union trips the root type-aware lint, which cannot resolve its type.
const unmounts: (() => void)[] = []

function renderButton(): ReactTestInstance {
  let readRoot!: () => ReactTestInstance
  act(() => {
    const renderer = create(createElement(HomeSettingsButton, { onPress: () => {} }))
    unmounts.push(() => renderer.unmount())
    readRoot = () => renderer.root
  })
  return readRoot()
}

afterEach(() => {
  act(() => unmounts.splice(0).forEach((unmount) => unmount()))
})

describe('home settings button', () => {
  it('is a labelled 44x44 button', () => {
    const button = renderButton().find(
      (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Settings'
    )
    expect(button.props.accessibilityRole).toBe('button')
    // No hitSlop, so the declared size is the whole target.
    expect(button.props.hitSlop).toBeUndefined()
    const style = flattenStyle(button.props.style)
    expect(style.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
    expect(style.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
  })
})
